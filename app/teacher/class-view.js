/*
 * classView (L6 teacher): tab 'classes', "Students and classes" (DESIGN 17.2, D10, N16 c).
 * Classes: create, rename, archive (its students too), restore, delete (archived classes only; the
 * students and all their learning data are kept under "No class"). Students: create (with the
 * pending baseline in the same batch when "Start with a Ninja Check" is ticked: P5-N2), edit (the
 * default player's name too), archive, restore, delete (exact counts, the name typed exactly, and
 * P7: "Export <name>'s data first", the student-scope JSON export, inside the dialog).
 * Every change is confirmed first and reported; every user-entered string is set as text (h()).
 */
(function () {
  'use strict';

  NBA.define('classView', ['roster', 'assessments', 'exporter', 'learning', 'teacherUI'], (roster, assessments, exporter, learning, ui) => {
    const { h } = ui;
    const view = { classFilter: '*', editing: null, classEditing: null };
    const MSG = {
      required: 'Enter a name.',
      control_characters: 'Remove the special control characters.',
      name_taken: 'An active class already has this name.',
      bad_local_id: 'Use at most 20 letters, digits, spaces, - or _.',
      unknown_class: 'Choose a class from the list.',
      not_found: 'This record no longer exists.'
    };
    const message = (p) => (p.code === 'too_long' ? 'Use at most ' + p.max + ' characters.' : (MSG[p.code] || p.code));
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    async function render(root) {
      const classes = await roster.classes();
      const students = await roster.allStudents();
      const className = (id) => { const c = classes.find((x) => x.id === id); return c ? c.name : 'No class'; };
      root.appendChild(h('h1', { text: 'Students and classes' }));

      // ----- classes -----
      const editing = view.classEditing ? classes.find((c) => c.id === view.classEditing) : null;
      root.appendChild(h('h2', { text: 'Classes' }));
      root.appendChild(h('form', { class: 't-card', 'data-t-submit': 'class-save', novalidate: true }, [
        h('div', { class: 't-field' }, [h('label', { for: 't-class-name', text: editing ? 'New name for ' + editing.name : 'New class name' }),
          h('input', { id: 't-class-name', name: 'name', 'data-field': 'name', type: 'text', maxlength: '60', autocomplete: 'off', value: editing ? editing.name : '' })]),
        h('div', { class: 't-actions' }, [h('button', { type: 'submit', class: 't-btn t-primary', text: editing ? 'Save name' : 'Add class' }),
          editing ? h('button', { type: 'button', class: 't-btn', 'data-t-action': 'class-cancel', text: 'Cancel' }) : null])
      ]));
      if (!classes.length) root.appendChild(h('p', { class: 't-muted', text: 'No classes yet. Students can also be kept under "No class".' }));
      else {
        root.appendChild(h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-classes' }, [
          h('thead', {}, [h('tr', {}, ['Class', 'Status', 'Students', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))]),
          h('tbody', {}, classes.map((c) => {
            const n = students.filter((s) => s.classId === c.id).length;
            const act = c.status === 'active'
              ? [btn('Rename', 'class-rename', c.id, 'Rename ' + c.name), btn('Archive', 'class-archive', c.id, 'Archive ' + c.name)]
              : [btn('Restore', 'class-restore', c.id, 'Restore ' + c.name), btn('Delete', 'class-delete', c.id, 'Delete ' + c.name)];
            return h('tr', { 'data-class': c.id }, [h('th', { scope: 'row', text: c.name }), h('td', { text: c.status === 'active' ? 'Active' : 'Archived' }),
              h('td', { text: String(n) }), h('td', {}, [h('div', { class: 't-row-actions' }, act)])]);
          }))])]));
      }

      // ----- students -----
      root.appendChild(h('h2', { text: 'Students' }));
      root.appendChild(ui.classSelect('t-student-filter', classes, view.classFilter, { all: true, label: 'Show', change: 'student-filter' }));
      root.appendChild(h('div', { class: 't-actions' }, [h('button', { type: 'button', class: 't-btn t-primary', 'data-t-action': 'student-new', text: 'Add student' })]));
      if (view.editing) root.appendChild(studentForm(view.editing === 'new' ? null : students.find((s) => s.id === view.editing), classes));
      const shown = students.filter((s) => view.classFilter === '*' || (s.classId || '') === view.classFilter);
      root.appendChild(h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-students' }, [
        h('thead', {}, [h('tr', {}, ['Name', 'Local id', 'Class', 'Status', 'Ninja Check first', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))]),
        h('tbody', {}, shown.map((s) => h('tr', { 'data-student': s.id }, [
          h('th', { scope: 'row' }, [s.name, s.isDefault ? h('span', { class: 't-tag', text: 'default player' }) : null]),
          h('td', { text: s.localId || '' }), h('td', { text: className(s.classId) }),
          h('td', { text: s.status === 'active' ? 'Active' : 'Archived' }), h('td', { text: s.baselineRequired ? 'Yes' : 'No' }),
          h('td', {}, [h('div', { class: 't-row-actions' }, [
            btn('Profile', 'student-profile', s.id, 'Profile of ' + s.name), btn('Edit', 'student-edit', s.id, 'Edit ' + s.name),
            s.status === 'active' ? btn('Archive', 'student-archive', s.id, 'Archive ' + s.name) : btn('Restore', 'student-restore', s.id, 'Restore ' + s.name),
            btn('Delete', 'student-delete', s.id, 'Delete ' + s.name)])])])))])]));
      if (!shown.length) root.appendChild(h('p', { class: 't-muted', text: 'No students here yet.' }));
    }

    function btn(text, action, id, label) {
      return h('button', { type: 'button', class: 't-btn', 'data-t-action': action, 'data-id': id, 'aria-label': label, text: text });
    }

    function studentForm(s, classes) {
      const isNew = !s;
      const active = classes.filter((c) => c.status === 'active' || (s && c.id === s.classId));
      return h('form', { class: 't-card', id: 't-student-form', 'data-t-submit': 'student-save', novalidate: true, 'data-id': s ? s.id : '' }, [
        h('h3', { text: isNew ? 'New student' : 'Edit ' + s.name }),
        h('div', { class: 't-field' }, [h('label', { for: 't-stu-name', text: 'Name' }),
          h('input', { id: 't-stu-name', name: 'name', 'data-field': 'name', type: 'text', maxlength: '60', autocomplete: 'off', value: s ? s.name : '', 'aria-describedby': 't-stu-name-hint' }),
          h('p', { class: 't-help', id: 't-stu-name-hint', text: 'Use a first name or nickname only.' })]),
        h('div', { class: 't-field' }, [h('label', { for: 't-stu-local', text: 'Local id (optional)' }),
          h('input', { id: 't-stu-local', name: 'localId', 'data-field': 'localId', type: 'text', maxlength: '40', autocomplete: 'off', value: s ? s.localId || '' : '' })]),
        ui.classSelect('t-stu-class', active, s ? s.classId : (view.classFilter !== '*' ? view.classFilter : '')),
        h('div', { class: 't-check' }, [h('input', { id: 't-stu-baseline', name: 'baselineRequired', type: 'checkbox', checked: isNew ? true : s.baselineRequired === true }),
          h('label', { for: 't-stu-baseline', text: 'Start with a Ninja Check' })]),
        h('div', { class: 't-actions' }, [h('button', { type: 'submit', class: 't-btn t-primary', text: isNew ? 'Add student' : 'Save' }),
          h('button', { type: 'button', class: 't-btn', 'data-t-action': 'student-cancel', text: 'Cancel' })])
      ]);
    }

    const rerender = () => ui.open('classes');
    async function guarded(work, failText) {
      try { return await work(); } catch (e) {
        try { console.error('[NBA] ' + failText + ': ' + ((e && e.message) || e)); } catch (x) { /* ignore */ }
        ui.note(failText + '.', true);
        return null;
      }
    }

    ui.registerActions({
      async 'class-save'(form) {
        const name = form.querySelector('[name="name"]').value;
        const res = view.classEditing ? await roster.renameClass(view.classEditing, name) : await roster.createClass(name);
        if (!res.ok) { ui.fieldErrors(form, res.problems.map((p) => ({ field: p.field, message: message(p) }))); return; }
        view.classEditing = null;
        await rerender();
        ui.note('Saved class ' + res.record.name + '.');
      },
      'class-rename'(el) { view.classEditing = el.getAttribute('data-id'); return rerender(); },
      'class-cancel'() { view.classEditing = null; return rerender(); },
      async 'class-archive'(el) {
        const sum = await roster.classSummary(el.getAttribute('data-id'));
        if (!sum) return;
        const ok = await ui.confirmDialog({ title: 'Archive class', confirmLabel: 'Archive class',
          lines: ['Archive class ' + sum.record.name + '? Its ' + plural(sum.activeStudents, 'student', 'students') +
            ' will be archived too. All data is kept and you can restore it.'] });
        if (!ok) return;
        const res = await guarded(() => roster.archiveClass(sum.record.id), 'Nothing was changed');
        if (res) { await rerender(); ui.note('Archived class ' + sum.record.name + ' and ' + plural(res.students, 'student', 'students') + '.'); }
      },
      async 'class-restore'(el) {
        const sum = await roster.classSummary(el.getAttribute('data-id'));
        if (!sum) return;
        const ok = await ui.confirmDialog({ title: 'Restore class', confirmLabel: 'Restore class',
          lines: ['Restore class ' + sum.record.name + '? The ' + plural(sum.archivedWithClass, 'student', 'students') + ' archived with it become active again.'] });
        if (!ok) return;
        const res = await guarded(() => roster.restoreClass(sum.record.id), 'Nothing was changed');
        if (res) { await rerender(); ui.note('Restored class ' + sum.record.name + '.'); }
      },
      async 'class-delete'(el) {
        const sum = await roster.classSummary(el.getAttribute('data-id'));
        if (!sum) return;
        const ok = await ui.confirmDialog({ title: 'Delete class', confirmLabel: 'Delete class', danger: true,
          lines: ['The class ' + sum.record.name + ' will be removed. Its ' + plural(sum.students, 'student', 'students') +
            ' and all their learning data will be kept and moved to \'No class\'. Assignments for this class will stay, listed under those students.',
          sum.closesAssignments ? plural(sum.closesAssignments, 'open assignment', 'open assignments') + ' for this class will be closed, because the class has no students.' : null]
            .filter(Boolean) });
        if (!ok) return;
        const res = await guarded(() => roster.deleteClass(sum.record.id), 'Nothing was deleted');
        if (res && res.ok) { await rerender(); ui.note('Deleted class ' + sum.record.name + '. Its students are now under "No class".'); }
      },
      'student-filter'(el) { view.classFilter = el.value; return rerender(); },
      'student-new'() { view.editing = 'new'; return rerender().then(() => { const n = document.getElementById('t-stu-name'); if (n) n.focus(); }); },
      'student-edit'(el) { view.editing = el.getAttribute('data-id'); return rerender().then(() => { const n = document.getElementById('t-stu-name'); if (n) n.focus(); }); },
      'student-cancel'() { view.editing = null; return rerender(); },
      'student-profile'(el) { return ui.open('student', { studentId: el.getAttribute('data-id') }); },
      async 'student-save'(form) {
        const id = form.getAttribute('data-id');
        const fields = { name: form.querySelector('[name="name"]').value, localId: form.querySelector('[name="localId"]').value,
          classId: form.querySelector('[name="classId"]').value || null, baselineRequired: form.querySelector('[name="baselineRequired"]').checked };
        // P5-N2: the flag and the pending baseline are written together, never one without the other
        const res = id
          ? await roster.updateStudent(id, fields, (sid, rec, old) => (rec.baselineRequired || rec.baselineRequired !== old.baselineRequired
            ? assessments.baselineOps(sid, rec.baselineRequired) : []))
          : await roster.createStudent(fields, (sid) => (fields.baselineRequired ? assessments.baselineOps(sid, true, []) : []));
        if (!res.ok) { ui.fieldErrors(form, res.problems.map((p) => ({ field: p.field, message: message(p) }))); return; }
        view.editing = null;
        await rerender();
        ui.note((id ? 'Saved ' : 'Added ') + res.record.name + '.' + (res.record.baselineRequired && !id ? ' A Ninja Check is waiting for them.' : ''));
      },
      async 'student-archive'(el) {
        const s = await roster.get(el.getAttribute('data-id'));
        if (!s) return;
        const ok = await ui.confirmDialog({ title: 'Archive student', confirmLabel: 'Archive', lines: [s.name + ' will be hidden from the game. All data is kept.'] });
        if (!ok) return;
        const res = await guarded(() => roster.archiveStudent(s.id), 'Nothing was changed');
        if (res) { await rerender(); ui.note('Archived ' + s.name + '.'); }
      },
      async 'student-restore'(el) {
        const s = await roster.get(el.getAttribute('data-id'));
        if (!s) return;
        const ok = await ui.confirmDialog({ title: 'Restore student', confirmLabel: 'Restore', lines: [s.name + ' will be shown in the game again.'] });
        if (!ok) return;
        const res = await guarded(() => roster.restoreStudent(s.id), 'Nothing was changed');
        if (res) { await rerender(); ui.note('Restored ' + s.name + '.'); }
      },
      /** The student-scope JSON export (their records, class and assignments); the dialog stays open. */
      async 'student-export'(el) {
        await learning.flush();
        const r = await exporter.exportJson({ scope: 'student', studentId: el.getAttribute('data-id') });
        const d = r.ok ? exporter.download(r.name, r.text, r.mime) : r;
        const msg = document.getElementById('t-delete-export-msg');
        if (msg) msg.textContent = d.ok ? 'Saved ' + r.name + '.' : d.message;
      },
      async 'student-delete'(el) {
        const s = await roster.get(el.getAttribute('data-id'));
        if (!s) return;
        const n = await roster.countStudentData(s.id);
        // DESIGN 17.2 (P7): offer a JSON bundle of this student's data before the irreversible delete
        const exportFirst = h('div', { class: 't-actions' }, [
          h('button', { type: 'button', class: 't-btn', id: 't-delete-export', 'data-t-action': 'student-export', 'data-id': s.id, text: 'Export ' + s.name + '\'s data first' }),
          h('p', { id: 't-delete-export-msg', role: 'status', 'aria-live': 'polite' })]);
        const ok = await ui.confirmDialog({ title: 'Delete student', confirmLabel: 'Delete', danger: true, typeToConfirm: s.name, extra: exportFirst,
          lines: ['This permanently removes ' + s.name + ': ' + plural(n.answers, 'answer', 'answers') + ', ' + plural(n.sessions, 'session', 'sessions') + ', ' +
            plural(n.checks, 'Ninja Check', 'Ninja Checks') + ', ' + plural(n.overrides, 'override', 'overrides') + ', progress in ' + plural(n.worlds, 'world', 'worlds') + '.',
          n.closesAssignments ? plural(n.closesAssignments, 'open assignment', 'open assignments') + ' set only for ' + s.name + ' will be closed.' : null,
          'This cannot be undone. Archive keeps all data and hides the student instead.'].filter(Boolean) });
        if (!ok) return;
        const res = await guarded(() => roster.deleteStudent(s.id), 'Nothing was deleted');
        if (res && res.ok) {
          view.editing = null;
          await rerender();
          ui.note('Deleted ' + s.name + ' and all of their data.' + (res.closedAssignments ? ' Closed ' + plural(res.closedAssignments, 'assignment', 'assignments') + ' set only for them.' : ''));
        }
      }
    });

    ui.registerTab('classes', { label: 'Students and classes', nav: true, render: render });
    return { view };
  });
}());
