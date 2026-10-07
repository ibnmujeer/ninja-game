/*
 * studentView (L6 teacher): tab 'student' (nav: false), opened with open('student', { studentId })
 * (DESIGN 17.4). The profile from reports.studentProfile: recent sessions, the concept table (level
 * as text plus a shape, confidence, accuracy, trend, hint use, representations, patterns), Ninja
 * Check results with the fixed comparison note, the "Automatic suggestion" next to "Your override"
 * (stored separately: an override never edits a recommendation), the override editor (live
 * filtering, inline errors with focus, the overrides it will end listed before Save), End override,
 * and "Ask for a baseline check".
 */
(function () {
  'use strict';

  NBA.define('studentView', ['util', 'catalog', 'repo', 'roster', 'teacherData', 'assessments', 'reports', 'teacherUI'],
    (util, catalog, repo, roster, teacherData, assessments, reports, ui) => {
      const { h } = ui;
      const C = catalog.CURRICULUM;
      const SELECTABLE = Object.keys(C.assignable);
      const rd = async (store, q) => (await repo.getAll(store, q)) || [];
      const view = { studentId: null, form: { conceptId: '', difficulty: 'auto', representation: 'auto', activityId: 'auto' } };

      /** The representations and activities the override editor offers for a concept (17.4, 14.8). */
      function options(c, rep) {
        const A = C.assignable[c];
        if (!A) return { levels: [], reps: [], activities: [] };
        let reps;
        if (A.mixed) {
          reps = C.matrixColumns.filter((r) => C.matrix[A.defaultDriver][r] && C.matrix[A.oddDriver][r]);
        } else {
          reps = [];
          A.activities.forEach((id) => { const r = catalog.activityById(id).representation; if (reps.indexOf(r) < 0) reps.push(r); });
          reps = C.matrixColumns.filter((r) => reps.indexOf(r) >= 0);
        }
        const acts = A.mixed ? [] : A.activities.filter((id) => !rep || rep === 'auto' || catalog.activityById(id).representation === rep);
        return { levels: A.levels.slice(), reps: reps, activities: acts };
      }
      const MSG = {
        concept_required: () => 'Choose a concept.',
        concept_not_selectable: () => 'Choose a concept from the list.',
        bad_level: () => 'Choose a level from the list.',
        unknown_representation: () => 'Choose a representation from the list.',
        activity_not_offered: () => 'Mixed practice picks the activity automatically.',
        activity_does_not_fit: (p) => reports.activityName(p.activityId) + " doesn't fit " + reports.conceptName(p.conceptId) + '.',
        no_activity_fits: (p) => 'No activity fits ' + reports.conceptName(p.conceptId) + ' with these choices.',
        level_not_available: (p, f) => 'Level ' + f.difficulty + ' is not available for ' + reports.conceptName(p.conceptId) + '.'
      };
      const FIELD = { conceptIds: 'conceptId', conceptId: 'conceptId', difficulty: 'difficulty', representation: 'representation', activityId: 'activityId' };

      function select(id, name, label, opts, value) {
        const sel = h('select', { id: id, name: name, 'data-field': name, 'data-t-change': 'ov-filter' },
          opts.map((o) => h('option', { value: o.value, text: o.text })));
        sel.value = opts.some((o) => o.value === value) ? value : opts[0].value;
        return h('div', { class: 't-field' }, [h('label', { for: id, text: label }), sel]);
      }

      function overrideForm(sid) {
        const f = view.form;
        const o = options(f.conceptId, f.representation);
        const auto = [{ value: 'auto', text: 'Auto' }];
        const mixed = !!(C.assignable[f.conceptId] && C.assignable[f.conceptId].mixed);
        return h('form', { class: 't-card', id: 't-override-form', 'data-t-submit': 'override-save', novalidate: true, 'data-id': sid }, [
          h('h3', { text: 'Set an override' }),
          h('p', { class: 't-help', text: 'An override is your choice for this student. It is kept apart from the automatic suggestion, which stays visible.' }),
          select('t-ov-concept', 'conceptId', 'Concept (required)', [{ value: '', text: 'Choose a concept' }]
            .concat(SELECTABLE.map((c) => ({ value: c, text: reports.conceptName(c) }))), f.conceptId),
          select('t-ov-level', 'difficulty', 'Level', auto.concat(o.levels.map((l) => ({ value: String(l), text: 'Level ' + l }))), String(f.difficulty)),
          select('t-ov-rep', 'representation', 'Representation', auto.concat(o.reps.map((r) => ({ value: r, text: reports.representationName(r) }))), f.representation),
          mixed ? h('p', { class: 't-help', text: 'Mixed practice alternates addition and subtraction; the activity is chosen automatically.' })
            : select('t-ov-activity', 'activityId', 'Activity', auto.concat(o.activities.map((a) => ({ value: a, text: reports.activityName(a) }))), f.activityId),
          h('div', { id: 't-ov-ends', class: 't-help', 'aria-live': 'polite' }),
          h('div', { class: 't-actions' }, [h('button', { type: 'submit', class: 't-btn t-primary', text: 'Save override' })])
        ]);
      }

      async function showEnds(sid) {
        const box = document.getElementById('t-ov-ends');
        if (!box) return;
        box.textContent = '';
        if (!view.form.conceptId) return;
        const ends = await teacherData.overridesToEndFor(sid, view.form.conceptId);
        if (ends.length) box.appendChild(h('p', { text: 'Saving ends: ' + ends.map((x) => reports.conceptName(x.conceptId) + ' (' + reports.targetText(x) + ')').join('; ') + '.' }));
      }

      async function render(root, ctx) {
        const sid = (ctx && ctx.studentId) || view.studentId;
        if (sid !== view.studentId) view.form = { conceptId: '', difficulty: 'auto', representation: 'auto', activityId: 'auto' };
        view.studentId = sid;
        const s = sid ? await roster.get(sid) : null;
        root.appendChild(h('div', { class: 't-actions t-no-print' }, [h('button', { type: 'button', class: 't-btn', 'data-t-action': 'profile-back', text: 'Back to students' })]));
        if (!s) { root.appendChild(h('h1', { text: 'Student not found' })); return; }
        const now = util.now();
        const mastery = {}, recs = {};
        (await rd('mastery', { index: 'studentId', value: sid })).forEach((m) => { mastery[m.conceptId] = m; });
        (await rd('recommendations', { index: 'studentId', value: sid })).forEach((r) => { recs[r.conceptId] = r; });
        const p = reports.studentProfile({ student: s, mastery: mastery, recommendations: recs, now: now,
          overrides: await rd('overrides', { index: 'studentId', value: sid }), sessions: await rd('sessions', { index: 'studentId', value: sid }),
          attempts: await rd('attempts', { index: 'studentId', value: sid }), assessments: await rd('assessments', { index: 'studentId', value: sid }),
          assignments: await rd('assignments') });
        root.appendChild(h('h1', { id: 't-profile-name' }, [s.name, s.localId ? h('span', { class: 't-tag', text: s.localId }) : null,
          s.status !== 'active' ? h('span', { class: 't-tag', text: 'archived' }) : null]));
        const tbl = (id, heads, rows) => h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: id }, [
          h('thead', {}, [h('tr', {}, heads.map((t) => h('th', { scope: 'col', text: t })))]), h('tbody', {}, rows)])]);

        root.appendChild(h('h2', { text: 'Recent activity' }));
        root.appendChild(p.sessions.length ? tbl('t-profile-sessions', ['Date', 'Kind', 'What', 'Questions', 'Right first time'],
          p.sessions.map((x) => h('tr', {}, [h('td', { text: x.date }), h('td', { text: x.kindText }), h('td', { text: x.label }),
            h('td', { text: String(x.questions) }), h('td', { text: String(x.firstTry) })])))
          : h('p', { class: 't-muted', text: 'No practice recorded yet.' }));
        root.appendChild(h('p', { class: 't-help', text: 'Level changes from automatic choices: ' + p.levelMoves.up + ' up, ' + p.levelMoves.down + ' down.' }));

        root.appendChild(h('h2', { text: 'Concepts' }));
        root.appendChild(p.concepts.length ? tbl('t-profile-concepts', ['Concept', 'Level', 'Answers', 'Accuracy', 'First try', 'Trend', 'Questions where a hint appeared', 'Representations', 'Patterns'],
          p.concepts.map((c) => h('tr', { 'data-concept': c.conceptId }, [
            h('th', { scope: 'row', text: c.name }),
            h('td', { class: 't-level' }, [h('span', { class: 't-shape', 'aria-hidden': 'true', text: c.level.shape }), c.level.text]),
            h('td', { text: c.attempts + ' (' + c.confidenceText + ')' }), h('td', { text: c.accuracy }), h('td', { text: c.firstAttemptAccuracy }),
            h('td', { text: c.trend }), h('td', { text: c.hintUse }),
            h('td', {}, [h('ul', { class: 't-list' }, c.representations.map((r) => h('li', { text: r.name + ': ' + r.answers + ' answers, ' + r.firstTry + ' first try' })))]),
            h('td', {}, c.patterns.length ? [h('ul', { class: 't-list' }, c.patterns.map((t) => h('li', { text: t })))] : ['None'])])))
          : h('p', { class: 't-muted', text: 'No answers yet.' }));

        root.appendChild(h('h2', { text: 'Ninja Check results' }));
        const ck = p.checks;
        const score = (x) => x.statusText + (x.score ? ': ' + x.score.correct + ' of ' + x.score.total + ' (' + x.score.percent + '%)' : '');
        root.appendChild(h('p', { id: 't-profile-baseline', text: 'Baseline: ' + score(ck.baseline) }));
        root.appendChild(h('p', { id: 't-profile-post', text: 'Post-check: ' + score(ck.post) }));
        if (ck.comparison.comparable) {
          const cmp = ck.comparison;
          root.appendChild(h('p', { id: 't-profile-change', text: 'Change between checks: ' + (cmp.absoluteImprovement >= 0 ? '+' : '') + cmp.absoluteImprovement +
            ' questions (' + (cmp.percentagePointImprovement >= 0 ? '+' : '') + cmp.percentagePointImprovement + ' percentage points).' }));
          root.appendChild(h('p', { class: 't-help', text: ck.note }));
        }
        root.appendChild(h('div', { class: 't-actions' }, [h('button', { type: 'button', class: 't-btn', 'data-t-action': 'profile-baseline', 'data-id': sid, text: 'Ask for a baseline check' })]));

        root.appendChild(h('h2', { text: 'Automatic suggestion and your override' }));
        const concepts = SELECTABLE.filter((c) => p.suggestions.some((x) => x.conceptId === c) || p.overrides.some((x) => x.conceptId === c));
        root.appendChild(concepts.length ? tbl('t-profile-next', ['Concept', 'Automatic suggestion', 'Your override'], concepts.map((c) => {
          const sg = p.suggestions.find((x) => x.conceptId === c);
          const ov = p.overrides.find((x) => x.conceptId === c);
          return h('tr', { 'data-concept': c }, [h('th', { scope: 'row', text: reports.conceptName(c) }),
            h('td', { class: 't-suggestion' }, sg ? [sg.sentence, h('br'), h('span', { class: 't-muted', text: sg.target })] : ['None yet']),
            h('td', { class: 't-override' }, ov ? [ov.target + ' (since ' + ov.date + ') ', h('button', { type: 'button', class: 't-btn', 'data-t-action': 'override-end',
              'data-id': ov.overrideId, 'aria-label': 'End override for ' + ov.name, text: 'End override' })] : ['None'])]);
        })) : h('p', { class: 't-muted', text: 'No suggestions or overrides yet.' }));
        root.appendChild(overrideForm(sid));
        await showEnds(sid);
      }

      function readForm(form) {
        const v = (n) => { const el = form.querySelector('[name="' + n + '"]'); return el ? el.value : 'auto'; };
        return { conceptId: v('conceptId'), difficulty: v('difficulty'), representation: v('representation'), activityId: v('activityId') };
      }

      ui.registerActions({
        'profile-back'() { return ui.open('classes'); },
        async 'ov-filter'(el) {
          const form = el.closest('form');
          const before = view.form.conceptId;
          view.form = readForm(form);
          if (view.form.conceptId !== before) view.form = { conceptId: view.form.conceptId, difficulty: 'auto', representation: 'auto', activityId: 'auto' };
          const fresh = overrideForm(view.studentId);
          form.replaceWith(fresh);
          const again = fresh.querySelector('[name="' + el.getAttribute('name') + '"]');
          if (again) again.focus();
          await showEnds(view.studentId);
        },
        async 'override-save'(form) {
          const f = readForm(form);
          view.form = f;
          const fields = { conceptId: f.conceptId || null, difficulty: f.difficulty === 'auto' ? null : Number(f.difficulty),
            representation: f.representation, activityId: f.activityId };
          const res = await teacherData.saveOverride(form.getAttribute('data-id'), fields);
          if (!res.ok) {
            ui.fieldErrors(form, res.problems.map((p) => ({ field: FIELD[p.field] || 'conceptId', message: (MSG[p.code] || (() => p.code))(p, fields) })));
            return;
          }
          view.form = { conceptId: '', difficulty: 'auto', representation: 'auto', activityId: 'auto' };
          await ui.open('student');
          ui.note('Override saved for ' + reports.conceptName(res.record.conceptId) + (res.ended.length ? '; ' + res.ended.length + ' earlier override ended.' : '.'));
        },
        async 'override-end'(el) {
          const ok = await ui.confirmDialog({ title: 'End override', confirmLabel: 'End override',
            lines: ['The game goes back to automatic choices for this concept. The override stays in the record as ended.'] });
          if (!ok) return;
          await teacherData.endOverride(el.getAttribute('data-id'));
          await ui.open('student');
          ui.note('Override ended.');
        },
        async 'profile-baseline'(el) {
          const r = await assessments.request(el.getAttribute('data-id'), 'baseline');
          await ui.open('student');
          ui.note(r.created ? 'A baseline Ninja Check is waiting for this student.' : 'A baseline Ninja Check is already waiting.');
        }
      });

      ui.registerTab('student', { label: 'Student', nav: false, render: render });
      return { options };
    });
}());
