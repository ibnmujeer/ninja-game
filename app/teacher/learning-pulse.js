/*
 * pulseView (L6 teacher): tab 'pulse', the Weekly Learning Pulse (DESIGN 17.5). Generated on this
 * device from IndexedDB data by reports.weeklyPulse (pure: the same data and `now` give the same
 * Pulse). A selector picks the 7 days ending now or an earlier 7-day window; Print calls
 * window.print() (print CSS hides the navigation).
 */
(function () {
  'use strict';

  NBA.define('pulseView', ['config', 'util', 'reports', 'teacherUI', 'dashboardView'], (config, util, reports, ui, dashboard) => {
    const { h } = ui;
    const DAY = 24 * 60 * 60 * 1000;
    const view = { weeksBack: 0, last: null };

    async function render(root) {
      const now = util.now();
      const sel = await dashboard.selectedClass();
      const span = config.reports.windowDays * DAY;
      const data = await dashboard.loadClass(sel.id, now, now - (view.weeksBack + 1) * span);
      const p = reports.weeklyPulse(Object.assign({}, data, { weeksBack: view.weeksBack }));
      view.last = p;
      root.appendChild(h('h1', { text: 'Weekly Learning Pulse' }));
      const windows = [];
      for (let k = 0; k <= config.reports.pulseWeeksBack; k++) {
        const end = now - k * span;
        windows.push(h('option', { value: String(k), text: (k === 0 ? 'Last 7 days: ' : '7 days: ') + util.localDate(end - span + 1) + ' to ' + util.localDate(end) }));
      }
      const win = h('select', { id: 't-pulse-window', 'data-t-change': 'pulse-window' }, windows);
      win.value = String(view.weeksBack);
      root.appendChild(h('div', { class: 't-no-print' }, [ui.classSelect('t-pulse-class', sel.classes, sel.id, { change: 'pulse-class' }),
        h('div', { class: 't-field t-inline' }, [h('label', { for: 't-pulse-window', text: 'Week' }), win]),
        h('div', { class: 't-actions' }, [h('button', { type: 'button', class: 't-btn', 'data-t-action': 'pulse-print', text: 'Print' })])]));
      root.appendChild(h('p', { id: 't-pulse-range', text: 'From ' + p.from + ' to ' + p.to + '.' }));
      root.appendChild(h('p', { class: 't-help', text: p.note }));
      if (!p.students.length) { root.appendChild(h('p', { class: 't-muted', text: 'No active students in this class.' })); return; }
      const list = (title, items, empty) => [h('h3', { text: title }),
        items.length ? h('ul', { class: 't-list' }, items.map((t) => h('li', { text: t }))) : h('p', { class: 't-muted', text: empty })];
      p.students.forEach((s) => {
        const card = h('section', { class: 't-card t-pulse-student', 'data-student': s.studentId }, [
          h('h2', {}, [s.name, s.localId ? h('span', { class: 't-tag', text: s.localId }) : null])]);
        if (s.noActivity) card.appendChild(h('p', { class: 't-pulse-none', text: s.noActivityText }));
        else {
          list('What they practised', s.practised.map((c) => c.name + ': ' + c.answers + (c.answers === 1 ? ' answer' : ' answers')), 'Nothing.')
            .concat([h('p', { text: 'Ways of showing it: ' + s.representations.map((r) => r.name + ' (' + r.answers + ')').join(', ') + '.' }),
              h('p', { text: 'Minutes: ' + s.minutes + '. Level changes from automatic choices: ' + s.levelMoves.up + ' up, ' + s.levelMoves.down + ' down.' })])
            .forEach((x) => card.appendChild(x));
        }
        list('Concepts showing strength', s.strengths, 'None yet.').forEach((x) => card.appendChild(x));
        list('Concepts developing', s.developing, 'None.').forEach((x) => card.appendChild(x));
        list('Possible observable patterns', s.patterns, 'None.').forEach((x) => card.appendChild(x));
        card.appendChild(h('h3', { text: 'Recommended next practice' }));
        card.appendChild(s.next ? h('p', { class: 't-pulse-next' }, [h('strong', { text: s.next.label + ': ' }), s.next.name + '. ' + s.next.sentence])
          : h('p', { class: 't-muted', text: 'No suggestion yet.' }));
        root.appendChild(card);
      });
    }

    ui.registerActions({
      'pulse-class'(el) { ui.state.classId = el.value; return ui.open('pulse'); },
      'pulse-window'(el) { view.weeksBack = Math.max(0, Number(el.value) || 0); return ui.open('pulse'); },
      'pulse-print'() { window.print(); }
    });
    ui.registerTab('pulse', { label: 'Weekly Pulse', nav: true, render: render });
    return { lastPulse: () => view.last };
  });
}());
