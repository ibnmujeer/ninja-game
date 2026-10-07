/*
 * checksView (L6 teacher): tab 'checks', Ninja Checks (DESIGN 17.7, 15.5, N15). For the selected
 * class: each student's baseline and post-check status and score and the change between them, with
 * the fixed note that the change does not show its cause. Actions per student and for the whole
 * class: "Ask for baseline check", "Start post-check"; "Cancel check" while a run has no answer (a
 * required baseline is cancelled together with the student's flag, in one batch: P5-N2). A run
 * detail lists every cell (concept, representation, level, right or not) and reused questions.
 */
(function () {
  'use strict';

  NBA.define('checksView', ['repo', 'roster', 'assessments', 'assessmentEngine', 'reports', 'teacherUI', 'dashboardView'],
    (repo, roster, assessments, assessmentEngine, reports, ui, dashboard) => {
      const { h } = ui;
      const view = { runId: null };
      const OPEN = ['pending', 'in_progress'];

      function stateText(runs, form) {
        const mine = runs.filter((r) => r.form === form && r.status !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt);
        const done = mine.filter((r) => r.status === 'complete').sort((a, b) => b.completedAt - a.completedAt)[0];
        const open = mine.find((r) => OPEN.indexOf(r.status) >= 0);
        const parts = [];
        if (done) { const s = assessmentEngine.scoreRun(done); parts.push('Complete: ' + s.correct + ' of ' + s.total + ' (' + s.percent + '%)'); }
        if (open) parts.push(open.status === 'pending' ? 'Waiting' : 'Started (' + Object.keys(open.answers || {}).length + ' of ' + open.items.length + ')');
        return { text: parts.length ? parts.join('; ') : 'Not asked', open: open || null, done: done || null };
      }

      async function render(root, ctx) {
        if (ctx && ctx.runId) return renderRun(root, ctx.runId);
        const sel = await dashboard.selectedClass();
        const students = (await roster.allStudents()).filter((s) => s.status === 'active' && (s.classId || '') === (sel.id || ''));
        root.appendChild(h('h1', { text: 'Ninja Checks' }));
        root.appendChild(ui.classSelect('t-checks-class', sel.classes, sel.id, { change: 'checks-class' }));
        root.appendChild(h('p', { class: 't-help', text: 'A Ninja Check is 12 short questions with one answer each. The child sees no score.' }));
        if (sel.id) {
          root.appendChild(h('div', { class: 't-actions' }, [
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-class-request', 'data-form': 'baseline', text: 'Ask the whole class for a baseline check' }),
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-class-request', 'data-form': 'post', text: 'Start a post-check for the whole class' })]));
        }
        if (!students.length) { root.appendChild(h('p', { class: 't-muted', text: 'No active students in this class.' })); return; }
        const rows = [];
        for (const s of students) {
          const runs = (await repo.getAll('assessments', { index: 'studentId', value: s.id })) || [];
          const b = stateText(runs, 'baseline'), p = stateText(runs, 'post');
          const picked = assessmentEngine.pickRuns(runs);
          const cmp = assessmentEngine.compare(picked.baseline, picked.post);
          const change = cmp.comparable ? (cmp.absoluteImprovement >= 0 ? '+' : '') + cmp.absoluteImprovement + ' questions (' +
            (cmp.percentagePointImprovement >= 0 ? '+' : '') + cmp.percentagePointImprovement + ' points)' : 'Not yet';
          const acts = [
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-request', 'data-id': s.id, 'data-form': 'baseline', 'aria-label': 'Ask ' + s.name + ' for a baseline check', text: 'Ask for baseline check' }),
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-request', 'data-id': s.id, 'data-form': 'post', 'aria-label': 'Start a post-check for ' + s.name, text: 'Start post-check' })];
          [b.open, p.open].forEach((r) => {
            if (r && !Object.keys(r.answers || {}).length) {
              acts.push(h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-cancel', 'data-run': r.id, 'data-id': s.id,
                'aria-label': 'Cancel the ' + (r.form === 'baseline' ? 'baseline' : 'post') + ' check for ' + s.name, text: 'Cancel ' + (r.form === 'baseline' ? 'baseline' : 'post-check') }));
            }
          });
          runs.filter((r) => r.status !== 'cancelled' && r.status !== 'pending').forEach((r) => {
            acts.push(h('button', { type: 'button', class: 't-link', 'data-t-action': 'checks-detail', 'data-run': r.id,
              text: 'Details: ' + (r.form === 'baseline' ? 'baseline' : 'post-check') + ' ' + ui.dateText(r.createdAt) }));
          });
          rows.push(h('tr', { 'data-student': s.id }, [h('th', { scope: 'row' }, [s.name, s.localId ? h('span', { class: 't-tag', text: s.localId }) : null]),
            h('td', { class: 't-baseline', text: b.text }), h('td', { class: 't-post', text: p.text }), h('td', { class: 't-change', text: change }),
            h('td', {}, [h('div', { class: 't-row-actions' }, acts)])]));
        }
        root.appendChild(h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-checks' }, [
          h('thead', {}, [h('tr', {}, ['Student', 'Baseline', 'Post-check', 'Change between checks', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))]),
          h('tbody', {}, rows)])]));
        root.appendChild(h('p', { class: 't-help', id: 't-checks-note', text: reports.COMPARISON_NOTE }));
      }

      async function renderRun(root, runId) {
        const r = await repo.get('assessments', runId);
        root.appendChild(h('div', { class: 't-actions t-no-print' }, [h('button', { type: 'button', class: 't-btn', 'data-t-action': 'checks-back', text: 'Back to Ninja Checks' })]));
        if (!r) { root.appendChild(h('h1', { text: 'Check not found' })); return; }
        const s = await roster.get(r.studentId);
        root.appendChild(h('h1', { text: 'Ninja Check: ' + (r.form === 'baseline' ? 'baseline' : 'post-check') }));
        root.appendChild(h('p', { text: (s ? s.name : 'Removed student') + ', asked ' + ui.dateText(r.createdAt) + (r.completedAt ? ', finished ' + ui.dateText(r.completedAt) : '') + '.' }));
        if (r.result) root.appendChild(h('p', { text: 'Score: ' + r.result.correct + ' of ' + r.result.total + ' (' + r.result.percent + '%).' }));
        root.appendChild(h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-check-run' }, [
          h('thead', {}, [h('tr', {}, ['Question', 'Concept', 'Representation', 'Level', 'Result', 'Note'].map((t) => h('th', { scope: 'col', text: t })))]),
          h('tbody', {}, r.items.map((it) => {
            const a = r.answers[it.cellId];
            return h('tr', { 'data-cell': it.cellId }, [h('th', { scope: 'row', text: it.cellId }), h('td', { text: reports.conceptName(it.conceptId) }),
              h('td', { text: reports.representationName(it.representation) }), h('td', { text: 'Level ' + it.difficulty }),
              h('td', { text: a ? (a.correct ? 'Right' : 'Not right') : 'Not answered' }),
              h('td', { text: it.instanceReused ? 'Question reused from an earlier check' : '' })]);
          }))])]));
      }

      ui.registerActions({
        'checks-class'(el) { ui.state.classId = el.value; return ui.open('checks'); },
        'checks-back'() { return ui.open('checks'); },
        'checks-detail'(el) { return ui.open('checks', { runId: el.getAttribute('data-run') }); },
        async 'checks-request'(el) {
          const form = el.getAttribute('data-form');
          const r = await assessments.request(el.getAttribute('data-id'), form);
          await ui.open('checks');
          ui.note(r.created ? (form === 'baseline' ? 'A baseline check is waiting.' : 'A post-check is waiting.') : 'One is already waiting for this student.');
        },
        async 'checks-class-request'(el) {
          const form = el.getAttribute('data-form');
          const r = await assessments.requestForClass(ui.state.classId, form);
          await ui.open('checks');
          ui.note('Asked ' + r.created + ' of ' + r.total + ' students' + (r.alreadyOpen ? '; ' + r.alreadyOpen + ' already had one waiting' : '') + '.');
        },
        async 'checks-cancel'(el) {
          const runId = el.getAttribute('data-run'), sid = el.getAttribute('data-id');
          const ok = await ui.confirmDialog({ title: 'Cancel check', confirmLabel: 'Cancel check', lines: ['This check has no answers yet. It will not be shown to the student.'] });
          if (!ok) return;
          const run = await repo.get('assessments', runId);
          const s = await roster.get(sid);
          let done;
          if (run && run.form === 'baseline' && s && s.baselineRequired) {
            // the flag and its waiting baseline go together (P5-N2, N15): one batch
            const res = await roster.updateStudent(sid, { baselineRequired: false }, () => assessments.baselineOps(sid, false));
            done = res.ok;
          } else done = (await assessments.cancel(runId)).cancelled;
          await ui.open('checks');
          ui.note(done ? 'The check was cancelled.' : 'Nothing was changed: the check has answers or is finished.', !done);
        }
      });

      ui.registerTab('checks', { label: 'Ninja Checks', nav: true, render: render });
      return { stateText };
    });
}());
