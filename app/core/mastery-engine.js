/*
 * masteryEngine (L2): deterministic, explainable mastery per student and concept (DESIGN 12).
 * No LLM, no clock, no randomness, no DOM: the caller passes `now`. Levels are simple product rules
 * on recent answers (thresholds in config.mastery), never a judgement about the child.
 *
 *   empty(studentId, conceptId)            a snapshot with no attempts
 *   update(snapshot, attempt, cfg?)        a NEW snapshot (the input is never changed); attempts of
 *                                          another student or concept, or outside includeContexts,
 *                                          return the snapshot unchanged
 *   rebuild(attempts, studentId, conceptId, cfg?)  update folded over attempts sorted by timestamp, id
 *   evaluate(snapshot, cfg?, now, errorCfg?)       the DESIGN 12.4 result (level, confidence, metrics,
 *                                          patterns, reasons, evidence, recommendedAction)
 * Comparisons use exact fractions (17/20 counts as 0.85); a ratio with no data is null, never NaN.
 * Odd input (null, missing fields) gives a valid result, never a throw.
 */
(function () {
  'use strict';

  NBA.define('masteryEngine', ['config', 'errorEngine'], (config, errorEngine) => {
    const NON_SYMBOLIC = ['concrete', 'visual', 'number-line', 'word-problem'];
    const EPS = 1e-9;

    const ratio = (num, den) => (den > 0 ? num / den : null);
    /** num / den >= thr, compared without rounding error (17/20 >= 0.85). False when den is 0. */
    const atLeast = (num, den, thr) => den > 0 && num >= thr * den - EPS;
    /** num / den < thr, the exact complement of atLeast. False when den is 0. */
    const below = (num, den, thr) => den > 0 && !atLeast(num, den, thr);
    const int = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.floor(x) : 0);
    const copy = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));

    function empty(studentId, conceptId) {
      return {
        studentId: studentId || null, conceptId: conceptId || null, updatedAt: null, lastAttemptAt: null,
        total: 0, correctAttempts: 0, firstCorrect: 0, submissions: 0, correctSubmissions: 0, hinted: 0, abandoned: 0,
        byRepresentation: {}, byDifficulty: {},
        consecutiveCorrect: 0, consecutiveIncorrect: 0,
        recent: [], play: null
      };
    }

    /** A complete snapshot from possibly partial input (never throws). */
    function norm(s) {
      const e = empty(s && s.studentId, s && s.conceptId);
      if (!s || typeof s !== 'object') return e;
      const out = Object.assign(e, copy(s));
      ['total', 'correctAttempts', 'firstCorrect', 'submissions', 'correctSubmissions', 'hinted', 'abandoned',
        'consecutiveCorrect', 'consecutiveIncorrect'].forEach((k) => { out[k] = Math.max(0, int(out[k])); });
      if (!out.byRepresentation || typeof out.byRepresentation !== 'object') out.byRepresentation = {};
      if (!out.byDifficulty || typeof out.byDifficulty !== 'object') out.byDifficulty = {};
      if (!Array.isArray(out.recent)) out.recent = [];
      out.recent = out.recent.filter((r) => r && typeof r === 'object');
      if (!out.play || typeof out.play !== 'object') out.play = null;
      return out;
    }

    function update(snapshot, attempt, cfg) {
      const c = cfg || config.mastery;
      const s0 = snapshot || empty(attempt && attempt.studentId, null);
      const a = attempt;
      if (!a || typeof a !== 'object') return s0;
      if ((c.includeContexts || []).indexOf(a.context) < 0) return s0;
      if (s0.studentId && a.studentId !== s0.studentId) return s0;
      if (s0.conceptId && (!Array.isArray(a.conceptIds) || a.conceptIds.indexOf(s0.conceptId) < 0)) return s0;
      const s = norm(s0);
      const subsList = Array.isArray(a.submittedAnswers) ? a.submittedAnswers : [];
      const subs = subsList.length;
      const okSubs = subsList.filter((x) => x === a.correctAnswer).length;
      const first = a.firstAttemptCorrect === true;
      const t = int(a.timestamp);
      s.studentId = s.studentId || a.studentId || null;
      s.total++;
      if (a.correct === true) s.correctAttempts++;
      if (first) s.firstCorrect++;
      s.submissions += subs;
      s.correctSubmissions += okSubs;
      if (a.hintUsed === true) s.hinted++;
      if (a.outcome === 'abandoned') s.abandoned++;
      const rep = typeof a.representation === 'string' ? a.representation : 'unknown';
      const br = s.byRepresentation[rep] || { n: 0, first: 0, subs: 0, correctSubs: 0 };
      s.byRepresentation[rep] = { n: br.n + 1, first: br.first + (first ? 1 : 0), subs: br.subs + subs, correctSubs: br.correctSubs + okSubs };
      const dk = String(int(a.difficulty));
      const bd = s.byDifficulty[dk] || { n: 0, first: 0 };
      s.byDifficulty[dk] = { n: bd.n + 1, first: bd.first + (first ? 1 : 0) };
      if (first) { s.consecutiveCorrect++; s.consecutiveIncorrect = 0; } else { s.consecutiveIncorrect++; s.consecutiveCorrect = 0; }
      s.recent.push({
        id: a.id || null, t: t, rep: rep, diff: int(a.difficulty), act: a.activityId || null, qid: a.questionId || null,
        first: first, subs: subs, okSubs: okSubs, hint: a.hintUsed === true,
        obs: Array.isArray(a.observations) ? a.observations.slice() : []
      });
      const win = Math.max(1, int(c.recentWindow) || 10);
      if (s.recent.length > win) s.recent = s.recent.slice(s.recent.length - win);
      s.updatedAt = t;
      s.lastAttemptAt = s.lastAttemptAt === null ? t : Math.max(s.lastAttemptAt, t);
      if (a.context === 'play') {
        const p = s.play;
        const d = int(a.difficulty);
        const adaptiveHere = a.decisionSource === 'adaptive' && a.decision && a.decision.conceptId === s.conceptId;
        s.play = {
          difficulty: d, representation: rep, activityId: a.activityId || null,
          atDifficulty: p && p.difficulty === d ? p.atDifficulty + 1 : 1,
          repRun: p && p.representation === rep ? p.repRun + 1 : 1,
          lastAdaptiveDecision: adaptiveHere ? copy(a.decision) : (p ? copy(p.lastAdaptiveDecision) : null)
        };
      }
      return s;
    }

    function byTimeThenId(x, y) {
      const tx = int(x && x.timestamp), ty = int(y && y.timestamp);
      if (tx !== ty) return tx - ty;
      const ix = String(x && x.id), iy = String(y && y.id);
      return ix < iy ? -1 : (ix > iy ? 1 : 0);
    }

    function rebuild(attempts, studentId, conceptId, cfg) {
      const list = (Array.isArray(attempts) ? attempts : []).filter((a) => a && typeof a === 'object').slice().sort(byTimeThenId);
      return list.reduce((s, a) => update(s, a, cfg), empty(studentId, conceptId));
    }

    /** Older half against newer half of the recent window on first-attempt accuracy. */
    function trendOf(recent, c) {
      const tc = c.trend || {};
      if (recent.length < (tc.minRecent || 6)) return 'unknown';
      const h = Math.floor(recent.length / 2);
      const older = recent.slice(0, h), newer = recent.slice(h);
      const acc = (l) => l.filter((r) => r.first).length / l.length;
      const diff = acc(newer) - acc(older);
      if (diff >= tc.delta - EPS) return 'improving';
      if (diff <= -tc.delta + EPS) return 'declining';
      return 'steady';
    }

    function hintBandOf(h, c) {
      if (h === null) return null;
      const hb = c.hintDependence || {};
      if (h >= hb.high - EPS) return 'high';
      if (h >= hb.some - EPS) return 'some';
      return 'low';
    }

    function confidenceOf(s, c) {
      const cc = c.confidence || {};
      const reps = Object.keys(s.byRepresentation).filter((r) => s.byRepresentation[r].n > 0).length;
      if (s.total < cc.low) return 'none';
      if (s.total < cc.medium) return 'low';
      if (s.total < cc.high) return 'medium';
      return reps >= 2 ? 'high' : 'medium';
    }

    function metricsOf(s, c) {
      const rec = s.recent;
      const rSubs = rec.reduce((n, r) => n + int(r.subs), 0), rOk = rec.reduce((n, r) => n + int(r.okSubs), 0);
      const rFirst = rec.filter((r) => r.first).length;
      const coverage = {};
      Object.keys(s.byRepresentation).sort().forEach((rep) => {
        const b = s.byRepresentation[rep];
        if (b.n > 0) coverage[rep] = { n: b.n, firstAttemptAccuracy: ratio(b.first, b.n) };
      });
      const hint = ratio(s.hinted, s.total);
      return {
        fractions: { rSubs, rOk, rFirst, rN: rec.length },
        metrics: {
          totalAttempts: s.total, correctAttempts: s.correctAttempts,
          accuracy: ratio(s.correctSubmissions, s.submissions),
          firstAttemptAccuracy: ratio(s.firstCorrect, s.total),
          recentAccuracy: ratio(rOk, rSubs),
          recentFirstAttemptAccuracy: ratio(rFirst, rec.length),
          recentTrend: trendOf(rec, c),
          hintDependence: hint, hintBand: hintBandOf(hint, c),
          representationCoverage: coverage,
          consecutiveCorrect: s.consecutiveCorrect, consecutiveIncorrect: s.consecutiveIncorrect
        }
      };
    }

    /** Level rules 1 to 4 of DESIGN 12.3; the first match wins. */
    function levelOf(s, f, patterns, c) {
      const rules = [];
      const st = c.strong || {}, ns = c.needsSupport || {};
      rules.push('L1_insufficient_data');
      if (s.total < c.minAttemptsForLevel) return { level: 'insufficient_data', reasons: ['insufficient_attempts'], rules };
      rules.push('L2_needs_support');
      const reasons2 = [];
      if (below(f.rOk, f.rSubs, ns.recentAccuracyBelow)) reasons2.push('recent_low_accuracy');
      if (ns.repeatedPatternTriggers) {
        patterns.filter(errorEngine.isRepeated).forEach((p) => reasons2.push('repeated_pattern:' + p.label));
      }
      if (reasons2.length) return { level: 'needs_support', reasons: reasons2, rules };
      rules.push('L3_strong');
      if (atLeast(f.rOk, f.rSubs, st.recentAccuracy)) {
        const failed = [];
        if (s.total < st.minAttempts) failed.push('strong_needs_more_attempts');
        const firstOk = st.firstAttemptScope === 'all' ? atLeast(s.firstCorrect, s.total, st.firstAttemptAccuracy)
          : atLeast(f.rFirst, f.rN, st.firstAttemptAccuracy);
        if (!firstOk) failed.push('strong_first_attempt_low');
        const ev = st.nonSymbolicEvidence || {};
        const nonSym = NON_SYMBOLIC.some((rep) => {
          const b = s.byRepresentation[rep];
          return !!b && b.n >= ev.minAttempts && atLeast(b.first, b.n, ev.firstAttemptAccuracy);
        });
        if (!nonSym) failed.push('strong_symbolic_only');
        if (!failed.length) return { level: 'strong', reasons: ['strong_all_rules_met'], rules };
        return { level: 'developing', reasons: failed, rules };
      }
      rules.push('L4_developing');
      return { level: 'developing', reasons: ['recent_mid_accuracy'], rules };
    }

    /** The highest difficulty of the latest play attempt, or of the recent window. */
    function latestDifficulty(s) {
      if (s.play && typeof s.play.difficulty === 'number') return s.play.difficulty;
      return s.recent.reduce((m, r) => (r.diff > m ? r.diff : m), 0) || null;
    }

    /** The teacher-facing summary row of DESIGN 12.4 (the first matching row wins). */
    function actionOf(level, reasons, s) {
      if (level === 'insufficient_data') return { action: 'gather_more_practice', reasonCode: 'insufficient_attempts' };
      if (level === 'needs_support') return { action: 'step_down', reasonCode: reasons[0] };
      if (level === 'developing') {
        if (reasons.indexOf('strong_symbolic_only') >= 0) return { action: 'introduce_transfer', reasonCode: 'strong_symbolic_only' };
        return { action: 'continue', reasonCode: reasons[0] };
      }
      const d = latestDifficulty(s);
      if (d === null || d < 4) return { action: 'step_up', reasonCode: 'concept_strong' };
      const covered = NON_SYMBOLIC.filter((rep) => s.byRepresentation[rep] && s.byRepresentation[rep].n > 0).length;
      if (covered >= 2) return { action: 'next_concept', reasonCode: 'concept_strong_max' };
      return { action: 'introduce_transfer', reasonCode: 'concept_strong_narrow' };
    }

    function evaluate(snapshot, cfg, now, errorCfg) {
      const c = cfg || config.mastery;
      const s = norm(snapshot);
      const f0 = metricsOf(s, c);
      const patterns = errorEngine.patterns(s, errorCfg || config.error, c.recentWindow);
      const lv = levelOf(s, f0.fractions, patterns, c);
      return {
        studentId: s.studentId, conceptId: s.conceptId, computedAt: typeof now === 'number' && Number.isFinite(now) ? now : null,
        level: lv.level,
        confidence: confidenceOf(s, c),
        metrics: f0.metrics,
        patterns: patterns,
        reasons: lv.reasons,
        evidence: {
          window: c.recentWindow,
          recentAttemptIds: s.recent.map((r) => r.id),
          thresholds: copy({
            minAttemptsForLevel: c.minAttemptsForLevel, strong: c.strong, developing: c.developing,
            needsSupport: c.needsSupport, trend: c.trend, hintDependence: c.hintDependence, confidence: c.confidence
          }),
          rulesChecked: lv.rules
        },
        recommendedAction: actionOf(lv.level, lv.reasons, s)
      };
    }

    /**
     * P4-N1: the level rules read the Developing lower bound from needsSupport.recentAccuracyBelow
     * (rule 2 takes everything below it), so developing.recentAccuracyMin must equal it; otherwise
     * a tuned Developing key would silently change nothing. main.js shows a boot error on a problem.
     */
    function configProblems(cfg) {
      const c = cfg || config.mastery;
      const out = [];
      const dev = c.developing && c.developing.recentAccuracyMin;
      const ns = c.needsSupport && c.needsSupport.recentAccuracyBelow;
      if (typeof dev !== 'number' || typeof ns !== 'number' || Math.abs(dev - ns) > EPS) {
        out.push('config.mastery.developing.recentAccuracyMin (' + dev + ') must equal needsSupport.recentAccuracyBelow (' + ns + ')');
      }
      return out;
    }

    return { empty, update, rebuild, evaluate, norm, configProblems, NON_SYMBOLIC, LEVELS: ['needs_support', 'insufficient_data', 'developing', 'strong'] };
  });
}());
