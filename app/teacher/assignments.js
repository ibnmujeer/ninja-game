/*
 * assignmentsView (L6 teacher): tab 'assignments' (DESIGN 17.6). Create, edit and close assignments.
 * The rules are learningEngine.validateAssignment (form and schema): every failure is shown next to
 * its field with focus moved there. Once students have started an assignment, only the name, due
 * date and status can change ("Locked because students have started this"). An assignment appears
 * to its students as its own "Special mission" on Home and is played when they tap it.
 */
(function () {
  'use strict';

  NBA.define('assignmentsView', ['config', 'util', 'catalog', 'repo', 'roster', 'teacherData', 'learningEngine', 'reports', 'teacherUI'],
    (config, util, catalog, repo, roster, teacherData, learningEngine, reports, ui) => {
      const { h } = ui;
      const C = catalog.CURRICULUM;
      const SELECTABLE = Object.keys(C.assignable);
      const ACTIVITIES = [];
      SELECTABLE.forEach((c) => C.assignable[c].activities.forEach((a) => { if (ACTIVITIES.indexOf(a) < 0) ACTIVITIES.push(a); }));
      const LIM = config.teacher.assignment;
      const blank = () => ({ id: null, name: '', classId: undefined, whole: true, studentIds: [], conceptIds: [], activityIds: [], difficulty: 'auto',
        representation: 'auto', mode: 'count', questionCount: '10', targetMinutes: '10', dueDate: '', locked: false });
      const view = { form: null };
      const MSG = {
        name_required: () => 'Enter a name.', name_too_long: () => 'Use at most 60 characters.',
        concepts_required: () => 'Choose at least one concept.', concept_not_selectable: () => 'Choose concepts from the list.',
        activity_does_not_fit: (p) => reports.activityName(p.activityId) + " doesn't fit any chosen concept",
        no_activity_fits: (p) => 'No activity fits ' + reports.conceptName(p.conceptId) + ' with these choices',
        level_not_available: (p, r) => 'Level ' + r.difficulty + ' is not available for ' + reports.conceptName(p.conceptId),
        bad_level: () => 'Choose a level from the list.', unknown_representation: () => 'Choose a representation from the list.',
        one_target_required: () => 'Choose a number of questions or a number of minutes.',
        count_out_of_range: () => 'Use ' + LIM.minCount + ' to ' + LIM.maxCount + ' questions.',
        minutes_out_of_range: () => 'Use ' + LIM.minMinutes + ' to ' + LIM.maxMinutes + ' minutes.',
        bad_due_date: () => 'Enter a real date (YYYY-MM-DD).', due_date_past: () => 'The due date cannot be before today.',
        who_required: () => 'Choose the whole class or at least one student.', not_found: () => 'This assignment no longer exists.'
      };

      const checks = (name, legend, items, chosen, disabled) => h('fieldset', { class: 't-fieldset', 'data-field': name, tabindex: '-1' },
        [h('legend', { text: legend })].concat(items.map((it) => h('div', { class: 't-check' }, [
          h('input', { type: 'checkbox', id: 't-asg-' + name + '-' + it.value, name: name, value: it.value, checked: chosen.indexOf(it.value) >= 0, disabled: disabled }),
          h('label', { for: 't-asg-' + name + '-' + it.value, text: it.text })]))));
      function select(id, name, label, opts, value, disabled, change) {
        const sel = h('select', { id: id, name: name, 'data-field': name, disabled: disabled, 'data-t-change': change || null },
          opts.map((o) => h('option', { value: o.value, text: o.text })));
        sel.value = value;
        return h('div', { class: 't-field' }, [h('label', { for: id, text: label }), sel]);
      }

      function form(f, classes, students) {
        const lock = f.locked;
        const pool = students.filter((s) => s.status === 'active' && (s.classId || '') === (f.classId || ''));
        const radio = (name, value, text, on, dis) => h('div', { class: 't-check' }, [
          h('input', { type: 'radio', id: 't-asg-' + name + '-' + value, name: name, value: value, checked: on, disabled: dis, 'data-t-change': 'asg-refresh' }),
          h('label', { for: 't-asg-' + name + '-' + value, text: text })]);
        return h('form', { class: 't-card', id: 't-asg-form', 'data-t-submit': 'asg-save', novalidate: true }, [
          h('h2', { text: f.id ? 'Edit assignment' : 'New assignment' }),
          lock ? h('p', { class: 't-help', id: 't-asg-locked', text: 'Locked because students have started this. Only the name, due date and status can change.' }) : null,
          h('div', { class: 't-field' }, [h('label', { for: 't-asg-name', text: 'Name' }),
            h('input', { id: 't-asg-name', name: 'name', 'data-field': 'name', type: 'text', maxlength: '80', autocomplete: 'off', value: f.name })]),
          h('fieldset', { class: 't-fieldset', 'data-field': 'studentIds', tabindex: '-1' }, [h('legend', { text: 'Who' }),
            (function () { const c = ui.classSelect('t-asg-class', classes.filter((x) => x.status === 'active'), f.classId || '', { change: 'asg-refresh' });
              c.querySelector('select').disabled = lock; return c; }()),
            f.classId ? radio('whole', 'yes', 'The whole class', f.whole, lock) : null,
            f.classId ? radio('whole', 'no', 'Chosen students', !f.whole, lock) : null,
            (!f.classId || !f.whole) ? (pool.length ? h('div', {}, pool.map((s) => h('div', { class: 't-check' }, [
              h('input', { type: 'checkbox', id: 't-asg-stu-' + s.id, name: 'studentIds', value: s.id, checked: f.studentIds.indexOf(s.id) >= 0, disabled: lock }),
              h('label', { for: 't-asg-stu-' + s.id, text: s.name + (s.localId ? ' (' + s.localId + ')' : '') })])))
              : h('p', { class: 't-muted', text: 'No active students here.' })) : null]),
          checks('conceptIds', 'Concepts', SELECTABLE.map((c) => ({ value: c, text: reports.conceptName(c) })), f.conceptIds, lock),
          checks('activityIds', 'Activities (none ticked: any activity that fits)', ACTIVITIES.map((a) => ({ value: a, text: reports.activityName(a) })), f.activityIds, lock),
          select('t-asg-level', 'difficulty', 'Level', [{ value: 'auto', text: 'Auto' }].concat([1, 2, 3, 4].map((l) => ({ value: String(l), text: 'Level ' + l }))), String(f.difficulty), lock),
          select('t-asg-rep', 'representation', 'Representation', [{ value: 'auto', text: 'Auto' }]
            .concat(C.matrixColumns.map((r) => ({ value: r, text: reports.representationName(r) }))), f.representation, lock),
          h('fieldset', { class: 't-fieldset' }, [h('legend', { text: 'How much' }),
            radio('mode', 'count', 'A number of questions', f.mode === 'count', lock), radio('mode', 'minutes', 'A number of minutes', f.mode === 'minutes', lock),
            f.mode === 'count'
              ? h('div', { class: 't-field' }, [h('label', { for: 't-asg-count', text: 'Questions (' + LIM.minCount + ' to ' + LIM.maxCount + ')' }),
                h('input', { id: 't-asg-count', name: 'questionCount', 'data-field': 'questionCount', type: 'number', min: String(LIM.minCount), max: String(LIM.maxCount), value: f.questionCount, disabled: lock })])
              : h('div', { class: 't-field' }, [h('label', { for: 't-asg-minutes', text: 'Minutes (' + LIM.minMinutes + ' to ' + LIM.maxMinutes + ')' }),
                h('input', { id: 't-asg-minutes', name: 'targetMinutes', 'data-field': 'targetMinutes', type: 'number', min: String(LIM.minMinutes), max: String(LIM.maxMinutes), value: f.targetMinutes, disabled: lock })])]),
          h('div', { class: 't-field' }, [h('label', { for: 't-asg-due', text: 'Due date (optional, YYYY-MM-DD)' }),
            h('input', { id: 't-asg-due', name: 'dueDate', 'data-field': 'dueDate', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: f.dueDate })]),
          h('div', { class: 't-actions' }, [h('button', { type: 'submit', class: 't-btn t-primary', text: f.id ? 'Save' : 'Create assignment' }),
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'asg-cancel', text: 'Cancel' })])
        ]);
      }

      /** The form's current values (kept across re-renders when the class or the mode changes). */
      function read(el) {
        const f = Object.assign({}, view.form);
        const val = (n) => { const x = el.querySelector('[name="' + n + '"]'); return x ? x.value : undefined; };
        const ticked = (n) => Array.from(el.querySelectorAll('input[name="' + n + '"]:checked')).map((x) => x.value);
        f.name = val('name');
        const cls = val('classId');
        if (cls !== undefined) f.classId = cls;
        const w = el.querySelector('input[name="whole"]:checked');
        f.whole = w ? w.value === 'yes' : true;
        if (el.querySelector('input[name="studentIds"]')) f.studentIds = ticked('studentIds');
        f.conceptIds = ticked('conceptIds');
        f.activityIds = ticked('activityIds');
        f.difficulty = val('difficulty');
        f.representation = val('representation');
        const m = el.querySelector('input[name="mode"]:checked');
        f.mode = m ? m.value : f.mode;
        if (val('questionCount') !== undefined) f.questionCount = val('questionCount');
        if (val('targetMinutes') !== undefined) f.targetMinutes = val('targetMinutes');
        f.dueDate = (val('dueDate') || '').trim();
        return f;
      }
      function toFields(f) {
        const int = (v) => (/^\s*-?\d+\s*$/.test(String(v)) ? Number(v) : (v === '' ? null : NaN));
        return {
          name: f.name, classId: f.classId || null, studentIds: f.classId && f.whole ? [] : f.studentIds,
          conceptIds: f.conceptIds, activityIds: f.activityIds, difficulty: f.difficulty === 'auto' ? 'auto' : Number(f.difficulty),
          representation: f.representation, questionCount: f.mode === 'count' ? int(f.questionCount) : null,
          targetMinutes: f.mode === 'minutes' ? int(f.targetMinutes) : null, dueDate: f.dueDate || null
        };
      }

      async function render(root) {
        const now = util.now();
        const classes = await roster.classes();
        const students = await roster.allStudents();
        const all = ((await repo.getAll('assignments')) || []).sort((a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? -1 : 1));
        const atts = [];
        for (const a of all) (await repo.getAll('attempts', { index: 'assignmentId', value: a.id })).forEach((x) => atts.push(x));
        const prog = reports.assignmentProgress(atts);
        const today = util.localDate(now);
        root.appendChild(h('h1', { text: 'Assignments' }));
        root.appendChild(h('p', { class: 't-help', text: 'Each open assignment appears on its students\' Home screen as a special mission, before the worlds.' }));
        root.appendChild(h('div', { class: 't-actions' }, [h('button', { type: 'button', class: 't-btn t-primary', 'data-t-action': 'asg-new', text: 'New assignment' })]));
        if (view.form) root.appendChild(form(view.form, classes, students));
        const who = (a) => {
          if ((a.studentIds || []).length) return a.studentIds.map((id) => { const s = students.find((x) => x.id === id); return s ? s.name : 'removed student'; }).join(', ');
          const c = classes.find((x) => x.id === a.classId);
          return c ? 'Whole class ' + c.name : 'Nobody';
        };
        root.appendChild(all.length ? h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-asg-list' }, [
          h('thead', {}, [h('tr', {}, ['Assignment', 'For', 'Concepts', 'Target', 'Due', 'Status', 'Complete', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))]),
          h('tbody', {}, all.map((a) => {
            const target = reports.targetedIds(a, students);
            const complete = target.filter((sid) => learningEngine.assignmentComplete(a, prog[a.id] && prog[a.id][sid])).length;
            return h('tr', { 'data-assignment': a.id }, [h('th', { scope: 'row', text: a.name }), h('td', { text: who(a) }),
              h('td', { text: a.conceptIds.map(reports.conceptName).join(', ') }),
              h('td', { text: a.questionCount ? a.questionCount + ' questions' : a.targetMinutes + ' minutes' }),
              h('td', {}, [a.dueDate || 'None', a.status === 'open' && a.dueDate && a.dueDate < today ? h('span', { class: 't-tag', text: 'Overdue' }) : null]),
              h('td', { text: a.status === 'open' ? 'Open' : 'Closed' }), h('td', { text: complete + ' of ' + target.length }),
              h('td', {}, [h('div', { class: 't-row-actions' }, [
                h('button', { type: 'button', class: 't-btn', 'data-t-action': 'asg-edit', 'data-id': a.id, 'aria-label': 'Edit ' + a.name, text: 'Edit' }),
                a.status === 'open' ? h('button', { type: 'button', class: 't-btn', 'data-t-action': 'asg-close', 'data-id': a.id, 'aria-label': 'Close ' + a.name, text: 'Close' })
                  : h('button', { type: 'button', class: 't-btn', 'data-t-action': 'asg-reopen', 'data-id': a.id, 'aria-label': 'Reopen ' + a.name, text: 'Reopen' })])])]);
          }))])]) : h('p', { class: 't-muted', text: 'No assignments yet.' }));
      }

      async function startEdit(id) {
        const a = await repo.get('assignments', id);
        if (!a) return;
        view.form = Object.assign(blank(), { id: a.id, name: a.name, classId: a.classId || '', whole: !(a.studentIds || []).length, studentIds: (a.studentIds || []).slice(),
          conceptIds: a.conceptIds.slice(), activityIds: a.activityIds.slice(), difficulty: String(a.difficulty), representation: a.representation,
          mode: a.questionCount ? 'count' : 'minutes', questionCount: String(a.questionCount || 10), targetMinutes: String(a.targetMinutes || 10),
          dueDate: a.dueDate || '', locked: (await teacherData.assignmentAttemptCount(a.id)) > 0 });
        await ui.open('assignments');
        const n = document.getElementById('t-asg-name');
        if (n) n.focus();
      }

      ui.registerActions({
        async 'asg-new'() {
          const sel = ui.state.classId;
          view.form = Object.assign(blank(), { classId: typeof sel === 'string' ? sel : '' });
          await ui.open('assignments');
          const n = document.getElementById('t-asg-name');
          if (n) n.focus();
        },
        'asg-edit'(el) { return startEdit(el.getAttribute('data-id')); },
        'asg-cancel'() { view.form = null; return ui.open('assignments'); },
        async 'asg-refresh'(el) {
          const f = el.closest('form');
          view.form = read(f);
          const name = el.getAttribute('name'), value = el.value;
          await ui.open('assignments');
          const again = document.querySelector('#t-asg-form [name="' + name + '"][value="' + value + '"]') || document.querySelector('#t-asg-form [name="' + name + '"]');
          if (again) again.focus();
        },
        async 'asg-save'(el) {
          const f = read(el);
          view.form = f;
          const fields = toFields(f);
          const res = f.id ? await teacherData.updateAssignment(f.id, f.locked ? { name: fields.name, dueDate: fields.dueDate } : fields)
            : await teacherData.createAssignment(fields);
          if (!res.ok) {
            ui.fieldErrors(el, res.problems.map((p) => ({ field: p.field, message: (MSG[p.code] || (() => p.code))(p, fields) })));
            return;
          }
          view.form = null;
          await ui.open('assignments');
          ui.note((f.id ? 'Saved ' : 'Created ') + res.record.name + '.');
        },
        async 'asg-close'(el) {
          const ok = await ui.confirmDialog({ title: 'Close assignment', confirmLabel: 'Close assignment',
            lines: ['Closing removes the special mission from the students\' Home screens. Their answers are kept.'] });
          if (!ok) return;
          const res = await teacherData.closeAssignment(el.getAttribute('data-id'));
          await ui.open('assignments');
          ui.note(res.ok ? 'Closed ' + res.record.name + '.' : 'Nothing was changed.', !res.ok);
        },
        async 'asg-reopen'(el) {
          const res = await teacherData.updateAssignment(el.getAttribute('data-id'), { status: 'open' });
          await ui.open('assignments');
          // a closed assignment can list nobody (its only student was deleted): say what is missing
          const p = !res.ok && res.problems && res.problems[0];
          ui.note(res.ok ? 'Reopened ' + res.record.name + '.' : 'Nothing was changed.' + (p && MSG[p.code] ? ' ' + MSG[p.code](p, {}) : ''), !res.ok);
        }
      });

      ui.registerTab('assignments', { label: 'Assignments', nav: true, render: render });
      return { toFields };
    });
}());
