/*
 * errorEngine (L2): per-attempt observations (DESIGN 13.0, 13.1). P3 part only; the patterns over
 * a history come in P4. Pure and deterministic: observe(attempt, cfg?) reads only the attempt record
 * and returns the observable facts, in a fixed order, never a judgement about the child.
 *
 * Two v1 facts shape the rules (13.0): in choices mode every distractor is within 3 of the answer,
 * so distance is recorded only in build mode; and a hint follows every wrong answer in play, so
 * hint dependence is "solved straight after the first hint", not "a hint appeared".
 */
(function () {
  'use strict';

  NBA.define('errorEngine', ['config'], (config) => {
    const TAKE_AWAY = ['knock', 'sub-line', 'sub-sym', 'sub-word'];
    const ADDITION = ['add', 'add-line', 'add-sym', 'add-word'];
    const ORDER = ['off-by-one', 'off-by-two-three', 'ten-off', 'offered-above-start', 'result-above-start',
      'offered-below-part', 'result-below-part', 'built-wrong-way', 'quick-wrong', 'all-choices-tried', 'solved-after-hint'];

    /** True when x and y are the two digits of a 2-digit number swapped (14 and 41). */
    function reversed(x, y) {
      if (x < 10 || y < 0) return false;
      const s = String(x);
      return s.length === 2 && s[0] !== s[1] && Number(s[1] + s[0]) === y;
    }

    function observe(attempt, cfg) {
      const a = attempt || {};
      const quickMs = (cfg && cfg.quickMs) || config.error.quickMs;
      const subs = Array.isArray(a.submittedAnswers) ? a.submittedAnswers : [];
      const ans = a.correctAnswer;
      const n = a.numbers || {};
      const found = new Set();
      const wrong = subs.filter((x) => x !== ans);

      if (a.inputMode === 'build') {
        wrong.forEach((x) => {
          const d = Math.abs(x - ans);
          if (d === 1) found.add('off-by-one');
          if (d === 2 || d === 3) found.add('off-by-two-three');
          if (a.max === 20 && (d === 10 || reversed(ans, x) || reversed(x, ans))) found.add('ten-off');
        });
        if (a.activityId === 'sub-build' && subs.some((x) => x > n.a)) found.add('built-wrong-way');
        if (a.activityId === 'add-build' && subs.some((x) => x < n.a)) found.add('built-wrong-way');
      }

      if (a.inputMode === 'choices' && Array.isArray(a.choices)) {
        const first = subs.length ? subs[0] : null;
        const takeAway = TAKE_AWAY.indexOf(a.activityId) >= 0 && (a.activityId !== 'sub-word' || a.template !== 'diff');
        if (takeAway && a.choices.some((c) => c > n.a)) {
          found.add('offered-above-start');
          if (first !== null && first > n.a) found.add('result-above-start');
        }
        if (ADDITION.indexOf(a.activityId) >= 0) {
          const part = Math.max(n.a, n.b);
          if (a.choices.some((c) => c < part)) {
            found.add('offered-below-part');
            if (first !== null && first < part) found.add('result-below-part');
          }
        }
        if (a.choices.length === 3 && subs.length === 3 && subs[2] === ans && subs[0] !== ans && subs[1] !== ans) {
          found.add('all-choices-tried');
        }
      }

      if (a.speed === 1 && subs.length && subs[0] !== ans && typeof a.responseMs === 'number' && a.responseMs < quickMs) {
        found.add('quick-wrong');
      }
      if (a.wrongCount >= 1 && subs.length >= 2 && subs[1] === ans) found.add('solved-after-hint');
      return ORDER.filter((o) => found.has(o));
    }

    /* ---------- patterns over a mastery snapshot (DESIGN 13.2) ---------- */
    const LABELS = ['counting', 'calculation', 'place-value', 'operation-misunderstanding', 'guessing', 'hint-dependence',
      'word-problem-comprehension', 'representation-transition'];
    /** The per-attempt labels: only their observed status counts as a repeated error pattern. */
    const REPEATED_LABELS = LABELS.slice(0, 6);
    const EPS = 1e-9;
    const atLeast = (num, den, thr) => den > 0 && num >= thr * den - EPS;
    const atMost = (num, den, thr) => den > 0 && num <= thr * den + EPS;
    const code = (s) => String(s).replace(/-/g, '_');

    /** The distance label of one observation in one activity (DESIGN 13.1), or null. */
    function distanceLabel(o, act) {
      if (o === 'off-by-one') return 'counting';
      if (o === 'off-by-two-three') return act === 'build' ? 'counting' : 'calculation';
      if (o === 'ten-off') return 'place-value';
      return null;
    }

    /** The most frequent observation among `obsList` over `rows` (ties: OBSERVATIONS order). */
    function dominant(rows, obsList) {
      let best = null, bestN = 0;
      ORDER.forEach((o) => {
        if (obsList.indexOf(o) < 0) return;
        const n = rows.filter((r) => r.obs.indexOf(o) >= 0).length;
        if (n > bestN) { best = o; bestN = n; }
      });
      return { obs: best, n: bestN };
    }

    function make(label, status, rows, of, window, reasonCode) {
      return { label: label, status: status, count: rows.length, of: of, window: window,
        evidenceAttemptIds: rows.map((r) => r.id), reasonCode: reasonCode };
    }

    /**
     * Possible and observed patterns, in LABELS order. Every count is over snapshot.recent, except
     * the two cross-representation labels, which use snapshot.byRepresentation. cfg = config.error.
     */
    function patterns(snapshot, cfg, windowSize) {
      const c = cfg || config.error;
      const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const recent = (Array.isArray(s.recent) ? s.recent : []).filter((r) => r && typeof r === 'object')
        .map((r) => ({ id: r.id || null, act: r.act || null, first: r.first === true, obs: Array.isArray(r.obs) ? r.obs : [], rep: r.rep }));
      const win = windowSize || (config.mastery && config.mastery.recentWindow) || recent.length;
      const n = recent.length;
      const out = [];

      ['counting', 'calculation', 'place-value'].forEach((label) => {
        const rows = recent.filter((r) => r.obs.some((o) => distanceLabel(o, r.act) === label));
        if (rows.length < c.distance.possible) return;
        const d = dominant(rows, ['off-by-one', 'off-by-two-three', 'ten-off']);
        out.push(make(label, rows.length >= c.distance.observed ? 'observed' : 'possible', rows, n, win,
          'obs_' + code(d.obs) + '_x' + d.n));
      });

      (function operation() {
        const wrongWay = recent.filter((r) => r.obs.indexOf('built-wrong-way') >= 0);
        const offered = recent.filter((r) => r.obs.indexOf('offered-above-start') >= 0 || r.obs.indexOf('offered-below-part') >= 0);
        const result = recent.filter((r) => r.obs.indexOf('result-above-start') >= 0 || r.obs.indexOf('result-below-part') >= 0);
        const ww = wrongWay.length >= c.wrongWay.observed ? 'observed' : (wrongWay.length >= c.wrongWay.possible ? 'possible' : null);
        const rs = result.length >= c.result.observed && atLeast(result.length, offered.length, c.result.observedShare) ? 'observed'
          : (result.length >= c.result.possible && atLeast(result.length, offered.length, c.result.possibleShare) ? 'possible' : null);
        if (!ww && !rs) return;
        const useWrongWay = ww === 'observed' || (ww && rs !== 'observed');
        if (useWrongWay) out.push(make('operation-misunderstanding', ww, wrongWay, n, win, 'obs_built_wrong_way_x' + wrongWay.length));
        else {
          const d = dominant(result, ['result-above-start', 'result-below-part']);
          out.push(make('operation-misunderstanding', rs, result, offered.length, win, 'obs_' + code(d.obs) + '_x' + result.length));
        }
      }());

      (function guessing() {
        const rows = recent.filter((r) => r.obs.indexOf('quick-wrong') >= 0 || r.obs.indexOf('all-choices-tried') >= 0);
        if (rows.length < c.guessing.possible) return;
        const observed = rows.length >= c.guessing.observed && atLeast(rows.length, n, c.guessing.observedShare);
        const d = dominant(rows, ['quick-wrong', 'all-choices-tried']);
        out.push(make('guessing', observed ? 'observed' : 'possible', rows, n, win, 'obs_' + code(d.obs) + '_x' + d.n));
      }());

      (function hintDependence() {
        const h = c.hintDependence;
        if (n < h.possibleMin) return;
        const firstOk = recent.filter((r) => r.first).length;
        if (!atMost(firstOk, n, h.firstAccuracyMax)) return;
        const wrongFirst = recent.filter((r) => !r.first);
        const solved = wrongFirst.filter((r) => r.obs.indexOf('solved-after-hint') >= 0);
        if (!atLeast(solved.length, wrongFirst.length, h.solvedShare)) return;
        out.push(make('hint-dependence', n >= h.observedMin ? 'observed' : 'possible', solved, wrongFirst.length, win,
          'obs_solved_after_hint_x' + solved.length));
      }());

      const byRep = s.byRepresentation && typeof s.byRepresentation === 'object' ? s.byRepresentation : {};
      const rep = (k) => {
        const b = byRep[k];
        return b && b.n > 0 ? { n: b.n, first: b.first || 0 } : null;
      };
      const repRows = (keys) => recent.filter((r) => keys.indexOf(r.rep) >= 0);

      (function wordProblem() {
        const w = c.wordProblem, wp = rep('word-problem');
        if (!wp || !atMost(wp.first, wp.n, w.wordMax)) return;
        const others = ['concrete', 'visual', 'number-line', 'symbolic'].map(rep).filter((x) => x && atLeast(x.first, x.n, w.otherMin));
        const level = (min) => wp.n >= min && others.some((x) => x.n >= min);
        const status = level(w.observedMin) ? 'observed' : (level(w.possibleMin) ? 'possible' : null);
        if (status) out.push(make('word-problem-comprehension', status, repRows(['word-problem']), wp.n, win, 'rep_word_problem_gap'));
      }());

      (function transition() {
        const t = c.transition, sym = rep('symbolic');
        if (!sym || !atLeast(sym.first, sym.n, t.symbolicMin)) return;
        const tried = ['concrete', 'visual', 'number-line'].map(rep).filter((x) => x);
        if (!tried.length || !tried.every((x) => atMost(x.first, x.n, t.otherMax))) return;
        const otherN = tried.reduce((m, x) => m + x.n, 0);
        const level = (min) => sym.n >= min && otherN >= min;
        const status = level(t.observedMin) ? 'observed' : (level(t.possibleMin) ? 'possible' : null);
        if (status) out.push(make('representation-transition', status, repRows(['concrete', 'visual', 'number-line']), otherN, win, 'rep_symbolic_only_strong'));
      }());

      return out;
    }

    /** True for an observed per-attempt pattern: the "repeated error pattern" of DESIGN 12.3 and 14.3. */
    function isRepeated(p) { return !!p && p.status === 'observed' && REPEATED_LABELS.indexOf(p.label) >= 0; }

    return { observe, patterns, isRepeated, distanceLabel, OBSERVATIONS: ORDER, LABELS, REPEATED_LABELS };
  });
}());
