/*
 * dashboardView (L6 teacher): tab 'dashboard', the class dashboard (DESIGN 17.3). The maths is
 * reports.classDashboard; this module reads the data with index ranges (one student at a time, the
 * last 7 days of attempts) and renders it. loadClass(classId, now) is shared with the Pulse and the
 * Ninja Checks tab. Level changes count adaptive decisions only (P4-N3, in reports.levelMoves).
 */
(function () {
  'use strict';

  NBA.define('dashboardView', ['config', 'util', 'repo', 'roster', 'reports', 'teacherUI'], (config, util, repo, roster, reports, ui) => {
    const { h } = ui;
    const DAY = 24 * 60 * 60 * 1000;
    const rd = async (store, q) => (await repo.getAll(store, q)) || [];

    /** The selected class: the shared choice, else the first active class, else "No class" (''). */
    async function selectedClass() {
      const classes = await roster.classes();
      let id = ui.state.classId;
      if (id === undefined || (id !== '' && !classes.some((c) => c.id === id))) {
        const first = classes.find((c) => c.status === 'active');
        id = first ? first.id : '';
        ui.state.classId = id;
      }
      return { id: id, classes: classes };
    }

    /**
     * Everything the reports need for one class ('' = "No class"): its students, their mastery,
     * sessions, assessments, recommendations and overrides, attempts since `since`, the assignments
     * and the attempts of the open ones.
     */
    async function loadClass(classId, now, since) {
      const all = await roster.allStudents();
      const students = all.filter((s) => (s.classId || '') === (classId || ''));
      const from = typeof since === 'number' ? since : now - (config.reports.inactiveDays + 1) * DAY;
      const out = { students: students, mastery: {}, recommendations: {}, attempts: [], sessions: [], assessments: [], overrides: [], now: now };
      for (const s of students) {
        out.mastery[s.id] = {};
        (await rd('mastery', { index: 'studentId', value: s.id })).forEach((m) => { out.mastery[s.id][m.conceptId] = m; });
        out.recommendations[s.id] = {};
        (await rd('recommendations', { index: 'studentId', value: s.id })).forEach((r) => { out.recommendations[s.id][r.conceptId] = r; });
        out.attempts = out.attempts.concat(await rd('attempts', { index: 'studentTime', lower: [s.id, from], upper: [s.id, now] }));
        out.sessions = out.sessions.concat(await rd('sessions', { index: 'studentId', value: s.id }));
        out.assessments = out.assessments.concat(await rd('assessments', { index: 'studentId', value: s.id }));
        out.overrides = out.overrides.concat(await rd('overrides', { index: 'studentId', value: s.id }));
      }
      out.assignments = await rd('assignments');
      out.assignmentAttempts = [];
      for (const a of out.assignments.filter((x) => x.status === 'open')) {
        out.assignmentAttempts = out.assignmentAttempts.concat(await rd('attempts', { index: 'assignmentId', value: a.id }));
      }
      return out;
    }

    const view = { last: null };
    const table = (id, heads, rows) => h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: id }, [
      h('thead', {}, [h('tr', {}, heads.map((t) => h('th', { scope: 'col', text: t })))]), h('tbody', {}, rows)])]);
    const list = (id, items, empty) => (items.length ? h('ul', { class: 't-list', id: id }, items.map((t) => h('li', { text: t })))
      : h('p', { class: 't-muted', id: id, text: empty }));

    async function render(root) {
      const now = util.now();
      const sel = await selectedClass();
      const data = await loadClass(sel.id, now);
      const r = reports.classDashboard(data);
      view.last = r;
      root.appendChild(h('h1', { text: 'Class dashboard' }));
      root.appendChild(ui.classSelect('t-dash-class', sel.classes, sel.id, { change: 'dash-class' }));
      root.appendChild(h('p', { id: 't-dash-active' }, ['Active students: ', h('strong', { text: String(r.activeCount) })]));

      root.appendChild(h('h2', { text: 'Recent activity (last ' + r.windowDays + ' days)' }));
      root.appendChild(r.activity.length ? table('t-dash-activity', ['Student', 'Last active', 'Questions', 'Minutes', 'Level changes', ''],
        r.activity.map((a) => h('tr', { 'data-student': a.studentId }, [
          h('th', { scope: 'row' }, [a.name, a.localId ? h('span', { class: 't-tag', text: a.localId }) : null]),
          h('td', { text: a.lastActive }), h('td', { class: 't-q', text: String(a.questions) }), h('td', { class: 't-min', text: String(a.minutes) }),
          h('td', { text: a.levelMoves.up + ' up, ' + a.levelMoves.down + ' down' }),
          h('td', {}, [h('button', { type: 'button', class: 't-btn', 'data-t-action': 'dash-profile', 'data-id': a.studentId,
            'aria-label': 'Profile of ' + a.name, text: 'Profile' })])])))
        : h('p', { class: 't-muted', text: 'No active students in this class yet. Add them under Students and classes.' }));

      root.appendChild(h('h2', { text: 'Concept strengths' }));
      root.appendChild(list('t-dash-strengths', r.strengths.map((x) => x.name + ': ' + x.text), 'None yet.'));
      root.appendChild(h('h2', { text: 'Concepts needing attention' }));
      root.appendChild(list('t-dash-attention', r.attention.map((x) => x.name + ': ' + x.text), 'None at the moment.'));
      root.appendChild(h('h2', { text: 'Students with not enough data' }));
      root.appendChild(list('t-dash-insufficient', r.insufficient.map((x) => x.name + (x.localId ? ' (' + x.localId + ')' : '') + ': ' + x.text), 'None.'));

      root.appendChild(h('h2', { text: 'Ninja Checks' }));
      root.appendChild(h('p', { id: 't-dash-checks', text: 'Baseline complete: ' + r.checks.baseline.complete + ' of ' + r.checks.baseline.total +
        '. Post-check complete: ' + r.checks.post.complete + ' of ' + r.checks.post.total + '.' }));
      root.appendChild(h('h2', { text: 'Assignments' }));
      root.appendChild(r.assignments.length ? table('t-dash-assignments', ['Assignment', 'Complete', 'Due'],
        r.assignments.map((a) => h('tr', { 'data-assignment': a.assignmentId }, [h('th', { scope: 'row', text: a.name }),
          h('td', { text: a.complete + ' of ' + a.targeted }),
          h('td', {}, [a.dueDate || 'No due date', a.overdue ? h('span', { class: 't-tag', text: 'Overdue' }) : null])])))
        : h('p', { class: 't-muted', text: 'No open assignments for this class.' }));
      root.appendChild(h('p', { class: 't-help', text: 'Levels are simple rules on recent answers. They are a guide for planning, not a judgement about a child.' }));
    }

    ui.registerActions({
      'dash-class'(el) { ui.state.classId = el.value; return ui.open('dashboard'); },
      'dash-profile'(el) { return ui.open('student', { studentId: el.getAttribute('data-id') }); }
    });
    ui.registerTab('dashboard', { label: 'Dashboard', nav: true, render: render });
    return { loadClass, selectedClass, lastReport: () => view.last };
  });
}());
