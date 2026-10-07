/*
 * adaptiveEngine (L2): deterministic adaptive rules R0 to R6 for the four matrix concepts
 * (DESIGN 14.2, 14.3, 14.7). Pure: no DOM, no clock, no randomness; every number is in
 * config.adaptive. The same input always gives the same decision.
 *
 *   decide(input, cfg?) -> Decision
 *     input = { conceptId, mastery (masteryEngine.evaluate), snapshot (12.2, with play),
 *               fallback: { difficulty, representation, activityId }, now }
 *   Decision = { action, reasonCode, source: 'adaptive' | 'default', conceptId, activityId,
 *                fromDifficulty, toDifficulty, fromRepresentation, representation,
 *                evidence: { level, recentAccuracy, consecutiveIncorrect, consecutiveCorrect, attempts },
 *                rulesChecked, template }
 *   Steps between representations use only those with an activity for the concept (matrix order
 *   concrete, visual, number-line, symbolic; word-problem steps to visual or symbolic).
 *   |toDifficulty - fromDifficulty| <= 1 on every adaptive decision (clamped, then asserted).
 * Never throws: odd input gives the R0 default decision.
 */
(function () {
  'use strict';

  NBA.define('adaptiveEngine', ['config', 'catalog', 'errorEngine'], (config, catalog, errorEngine) => {
    const C = catalog.CURRICULUM;
    const EPS = 1e-9;
    const atLeast = (num, den, thr) => den > 0 && num >= thr * den - EPS;
    const below = (num, den, thr) => den > 0 && !atLeast(num, den, thr);
    const int = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : d);
    const code = (s) => String(s).replace(/-/g, '_');

    const isMatrixConcept = (c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(C.matrix, c);
    function rowOf(c) { return isMatrixConcept(c) ? C.matrix[c] : {}; }
    /** The activity for a concept and representation, or null. */
    function activityFor(c, rep) {
      const row = rowOf(c);
      return Object.prototype.hasOwnProperty.call(row, rep) ? row[rep] : null;
    }
    /** The representation of an activity in a concept's row, or null when it is not in the row. */
    function repInRow(c, activityId) {
      const row = rowOf(c);
      return Object.keys(row).find((r) => row[r] === activityId) || null;
    }
    function templateFor(c, activityId) {
      if (!catalog.activityById(activityId) || !catalog.activityById(activityId).templates) return null;
      return C.matrixTemplates[c] || 'take';
    }

    /** One step more concrete (cfg.concretenessOrder, skipping gaps); from word-problem: visual. */
    function moreConcrete(c, rep, cfg) {
      const order = cfg.concretenessOrder;
      if (rep === 'word-problem') return activityFor(c, 'visual') ? 'visual' : null;
      const i = order.indexOf(rep);
      for (let k = i - 1; k >= 0; k--) if (activityFor(c, order[k])) return order[k];
      return null;
    }
    /** One step less concrete; from word-problem: symbolic. word-problem is never entered this way. */
    function lessConcrete(c, rep, cfg) {
      const order = cfg.concretenessOrder;
      if (rep === 'word-problem') return activityFor(c, 'symbolic') ? 'symbolic' : null;
      const i = order.indexOf(rep);
      if (i < 0) return null;
      for (let k = i + 1; k < order.length; k++) if (activityFor(c, order[k])) return order[k];
      return null;
    }
    /** The nearest representation with an activity (more concrete first), excluding `except`. */
    function nearestAvailable(c, rep, cfg, except) {
      const order = cfg.concretenessOrder.concat(['word-problem']);
      const i = order.indexOf(rep) < 0 ? 1 : order.indexOf(rep);
      const ok = (r) => r && r !== except && !!activityFor(c, r);
      if (ok(rep)) return rep;
      for (let k = 1; k < order.length; k++) {
        if (ok(order[i - k])) return order[i - k];
        if (ok(order[i + k])) return order[i + k];
      }
      return null;
    }

    /** First-attempt counts per representation from the snapshot. */
    function repStats(snapshot, rep) {
      const b = snapshot && snapshot.byRepresentation && snapshot.byRepresentation[rep];
      return b && b.n > 0 ? { n: b.n, first: b.first || 0 } : { n: 0, first: 0 };
    }

    /** R3's condition and its target representation (DESIGN 14.3). */
    function transferTarget(c, mastery, snapshot, cfg) {
      const t = cfg.transfer;
      const reasons = Array.isArray(mastery.reasons) ? mastery.reasons : [];
      const sym = repStats(snapshot, 'symbolic');
      const symStrong = sym.n >= t.symbolicMinAttempts && atLeast(sym.first, sym.n, t.symbolicMin);
      const others = ['visual', 'number-line', 'concrete', 'word-problem'].filter((r) => activityFor(c, r));
      const weak = others.filter((r) => {
        const x = repStats(snapshot, r);
        return x.n === 0 || (x.n >= t.otherMinAttempts && below(x.first, x.n, t.otherMax));
      });
      if (reasons.indexOf('strong_symbolic_only') < 0 && !(symStrong && weak.length)) return null;
      const untried = others.find((r) => repStats(snapshot, r).n === 0);
      if (untried) return untried;
      let best = null, bestAcc = 2;
      others.forEach((r) => {
        const x = repStats(snapshot, r);
        const acc = x.first / x.n;
        if (acc < bestAcc - EPS) { best = r; bestAcc = acc; }
      });
      return best;
    }

    function evidenceOf(m, snapshot) {
      const mt = (m && m.metrics) || {};
      return {
        level: m && m.level ? m.level : 'insufficient_data',
        recentAccuracy: typeof mt.recentAccuracy === 'number' ? mt.recentAccuracy : null,
        consecutiveIncorrect: int(mt.consecutiveIncorrect, 0), consecutiveCorrect: int(mt.consecutiveCorrect, 0),
        attempts: int(snapshot && snapshot.total, 0)
      };
    }

    /** The R0 decision: the slot's own v1 type at its v1 level (or the concept default). */
    function v1Default(c, fb, d, r, m, snapshot, rules, reasonCode) {
      return {
        action: 'v1_default', reasonCode: reasonCode || 'no_data', source: 'default', conceptId: c,
        activityId: fb.activityId, fromDifficulty: d, toDifficulty: fb.difficulty, fromRepresentation: r,
        representation: fb.representation, evidence: evidenceOf(m, snapshot), rulesChecked: rules.slice(),
        template: templateFor(c, fb.activityId)
      };
    }

    function normFallback(c, fallback, cfg) {
      const f = fallback && typeof fallback === 'object' ? fallback : {};
      const lv = Math.min(cfg.maxLevel, Math.max(cfg.minLevel, int(f.difficulty, 2)));
      const meta = catalog.activityById(f.activityId);
      if (meta) return { difficulty: lv, representation: meta.representation, activityId: f.activityId };
      const rep = nearestAvailable(c, typeof f.representation === 'string' ? f.representation : 'visual', cfg) || 'visual';
      return { difficulty: lv, representation: rep, activityId: activityFor(c, rep) };
    }

    function decideRules(input, cfg) {
      const c = input.conceptId;
      const m = input.mastery && typeof input.mastery === 'object' ? input.mastery : { level: 'insufficient_data', reasons: [], metrics: {}, patterns: [] };
      const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null;
      const play = snapshot && snapshot.play && typeof snapshot.play === 'object' ? snapshot.play : null;
      const fb = normFallback(c, input.fallback, cfg);
      const minL = cfg.minLevel, maxL = cfg.maxLevel;
      const d = Math.min(maxL, Math.max(minL, play ? int(play.difficulty, fb.difficulty) : fb.difficulty));
      let r = play && typeof play.representation === 'string' ? play.representation : fb.representation;
      if (r !== 'word-problem' && !activityFor(c, r)) r = nearestAvailable(c, r, cfg) || fb.representation;
      const prev = play && play.lastAdaptiveDecision && typeof play.lastAdaptiveDecision === 'object' ? play.lastAdaptiveDecision : null;
      const atDifficulty = play ? int(play.atDifficulty, 0) : 0;
      const repRun = play ? int(play.repRun, 0) : 0;
      const mt = m.metrics || {};
      const reasons = Array.isArray(m.reasons) ? m.reasons : [];
      const patterns = Array.isArray(m.patterns) ? m.patterns : [];
      const consecutiveIncorrect = int(mt.consecutiveIncorrect, 0), consecutiveCorrect = int(mt.consecutiveCorrect, 0);
      const rules = [];
      const out = (action, reasonCode, toD, toRep) => ({ action, reasonCode, toD, toRep, rules });

      rules.push('R0');
      if (!isMatrixConcept(c) || m.level === 'insufficient_data' || !m.level) return { r0: true, d, r, fb, m, snapshot, rules };

      rules.push('R1');
      const repeated = patterns.find(errorEngine.isRepeated);
      if (repeated && repRun >= 2) {
        const to = moreConcrete(c, r, cfg) || nearestAvailable(c, r, cfg, r) || r;
        return Object.assign(out('change_representation', 'repeated_pattern_' + code(repeated.label), d, to), { d, r, fb, m, snapshot });
      }

      rules.push('R2');
      if (m.level === 'needs_support' || consecutiveIncorrect >= cfg.struggleRun) {
        const why = reasons.indexOf('recent_low_accuracy') >= 0 ? 'recent_low_accuracy'
          : (consecutiveIncorrect >= cfg.struggleRun ? 'consecutive_incorrect' : 'repeated_pattern_' + code((repeated || {}).label || 'pattern'));
        const mc = moreConcrete(c, r, cfg);
        if (mc && !(prev && prev.action === 'more_concrete')) return Object.assign(out('more_concrete', why, d, mc), { d, r, fb, m, snapshot });
        if (d > minL && atDifficulty >= cfg.cooldownAttempts) return Object.assign(out('reduce_difficulty', why, d - 1, r), { d, r, fb, m, snapshot });
        return Object.assign(out('maintain', d > minL ? 'cooldown_active' : 'at_easiest_level', d, r), { d, r, fb, m, snapshot });
      }

      rules.push('R3');
      const tr = transferTarget(c, m, snapshot, cfg);
      if (tr) return Object.assign(out('introduce_transfer', 'symbolic_strong_transfer_weak', d, tr), { d, r, fb, m, snapshot });

      rules.push('R4');
      const hint = patterns.find((p) => p && p.label === 'hint-dependence' && p.status === 'possible');
      if (hint) {
        const mc = moreConcrete(c, r, cfg);
        return Object.assign(out(mc ? 'more_concrete' : 'maintain', 'solved_after_hint_pattern', d, mc || r), { d, r, fb, m, snapshot });
      }

      rules.push('R5');
      const recentFirst = typeof mt.recentFirstAttemptAccuracy === 'number' ? mt.recentFirstAttemptAccuracy : 0;
      if (m.level === 'strong' || (consecutiveCorrect >= cfg.successRun && recentFirst >= cfg.successFirstAccuracy - EPS)) {
        if (d < maxL && atDifficulty >= cfg.minAttemptsAtLevel) return Object.assign(out('increase_difficulty', 'consistent_success', d + 1, r), { d, r, fb, m, snapshot });
        const lc = d === maxL ? lessConcrete(c, r, cfg) : null;
        if (lc) return Object.assign(out('less_concrete', 'consistent_success_max_difficulty', d, lc), { d, r, fb, m, snapshot });
        return Object.assign(out('maintain', d < maxL ? 'success_building_evidence' : 'concept_strong', d, r), { d, r, fb, m, snapshot });
      }

      rules.push('R6');
      return Object.assign(out('maintain', 'developing_continue', d, r), { d, r, fb, m, snapshot });
    }

    function decide(input, cfg) {
      const a = Object.assign({}, config.adaptive, cfg || {});
      const inp = input && typeof input === 'object' ? input : {};
      const c = inp.conceptId;
      try {
        const x = decideRules(inp, a);
        if (x.r0) return v1Default(c, x.fb, x.d, x.r, x.m, x.snapshot, x.rules, 'no_data');
        let to = Math.min(a.maxLevel, Math.max(a.minLevel, x.toD));
        if (Math.abs(to - x.d) > 1) to = x.d + (to > x.d ? 1 : -1); // spec rule: at most one level per decision
        if (Math.abs(to - x.d) > 1) throw new Error('difficulty moved more than one level');
        const rep = activityFor(c, x.toRep) ? x.toRep : nearestAvailable(c, x.toRep, a);
        const act = activityFor(c, rep);
        return {
          action: x.action, reasonCode: x.reasonCode, source: 'adaptive', conceptId: c, activityId: act,
          fromDifficulty: x.d, toDifficulty: to, fromRepresentation: x.r, representation: rep,
          evidence: evidenceOf(x.m, x.snapshot), rulesChecked: x.rules.slice(), template: templateFor(c, act)
        };
      } catch (e) {
        const fb = normFallback(c, inp.fallback, a);
        return v1Default(c, fb, fb.difficulty, fb.representation, null, null, ['R0'], 'invalid_input');
      }
    }

    return { decide, activityFor, repInRow, rowOf, isMatrixConcept, moreConcrete, lessConcrete, nearestAvailable, templateFor };
  });
}());
