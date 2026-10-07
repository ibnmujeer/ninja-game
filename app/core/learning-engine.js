/*
 * learningEngine (L2): the attempt record builder (DESIGN 11, 6.3). P3 part; P4 adds decideSlot and
 * assignmentQuestion. Pure: the caller passes the time, the ids and the speed in ctx.
 *
 *   creditedConcepts(question, ctx)  [primary, ...]: the question's concept first (DESIGN 6.3, P3:
 *                       the activity's primaryConcept, with the tier for symbolic and the template
 *                       for sub-word), then the range concept by operation and tier, then
 *                       addsub.mixed in a world 5 add/sub slot (ctx.mixed). A test-given question
 *                       (R6) is passed with mixed false, so it gets primary plus range only.
 *   buildAttempt(question, outcome, ctx)  every field of the attempt record, never undefined.
 *     outcome: { outcome: 'correct'|'incorrect'|'abandoned', submittedAnswers, hintsShown, shownAt,
 *                responseMs, totalMs, starEarned }
 *     ctx: { id, now, studentId, sessionId, context, assignmentId?, assessmentId?, assessmentForm?,
 *            assessmentCellId?, worldId, missionId, missionIndex, decisionSource, decision, mixed,
 *            speed, maxResponseMs? }
 */
(function () {
  'use strict';

  NBA.define('learningEngine', ['config', 'catalog', 'questionTypes', 'errorEngine', 'masteryEngine', 'adaptiveEngine', 'targets'],
    (config, catalog, questionTypes, errorEngine, masteryEngine, adaptiveEngine, targets) => {
    const SCHEMA_VERSION = 1;
    const ADD_SUB = ['addition', 'subtraction'];

    /**
     * DESIGN 6.3 with R1: the slot decision's lead concepts first (the slot concept, or the override's
     * or assignment's concept and then its driver), then the question's own concept (the activity's
     * primaryConcept, tier-aware for symbolic, sub.difference for the diff template), then the range
     * concept, addsub.mixed (ctx.mixed) and rep.transition after an introduce_transfer decision.
     */
    function creditedConcepts(q, ctx) {
      const T = questionTypes.get(q.typeId);
      const out = [];
      const add = (c) => { if (c && out.indexOf(c) < 0 && catalog.conceptById(c)) out.push(c); };
      ((ctx && ctx.leadConcepts) || []).forEach(add);
      add(q.conceptId || T.conceptId);
      if (ADD_SUB.indexOf(T.operation) >= 0) {
        add(catalog.rangeConcept(T.operation, q.max));
        if (ctx && ctx.mixed) add('addsub.mixed');
      }
      // rep.transition: after an introduce_transfer decision, or on a blueprint cell marked transfer (P5)
      if (ctx && ((ctx.decision && ctx.decision.action === 'introduce_transfer') || ctx.transfer === true)) add('rep.transition');
      return out;
    }

    /** A time in ms as a non-negative integer, or null when unknown, hidden or too long. */
    function ms(x, max) {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > max) return null;
      return Math.round(x);
    }
    const orNull = (x) => (x === undefined ? null : x);

    /**
     * Response times from performance.now() marks (DESIGN 11). responseMs (input accepted to the
     * first answer) is null only when there was no answer or the page was hidden before it;
     * totalMs (to the last answer) is null when the page was hidden at any point (review P3-N1).
     */
    function responseTimes(t) {
      const ready = t.readyPerf;
      return {
        responseMs: t.hiddenBeforeFirst || t.firstPerf === null || t.firstPerf === undefined ? null : Math.max(0, t.firstPerf - ready),
        totalMs: t.hidden ? null : Math.max(0, t.nowPerf - ready)
      };
    }

    function buildAttempt(q, outcome, ctx) {
      const o = outcome || {};
      const c = ctx || {};
      const T = questionTypes.get(q.typeId);
      const maxMs = c.maxResponseMs || config.attempt.maxResponseMs;
      const subs = (o.submittedAnswers || []).map(Number);
      const kind = o.outcome === 'correct' || o.outcome === 'incorrect' ? o.outcome : 'abandoned';
      const conceptIds = creditedConcepts(q, c);
      const wrongCount = subs.filter((x) => x !== q.answer).length;
      const assessment = c.context === 'assessment';
      const hintsShown = assessment ? 0 : Math.max(0, Math.floor(Number(o.hintsShown) || 0));
      const rec = {
        id: c.id,
        schemaVersion: SCHEMA_VERSION,
        timestamp: c.now,
        shownAt: typeof o.shownAt === 'number' ? o.shownAt : c.now,
        studentId: c.studentId,
        sessionId: c.sessionId,
        context: c.context || 'play',
        assignmentId: orNull(c.assignmentId),
        assessmentId: orNull(c.assessmentId),
        assessmentForm: orNull(c.assessmentForm),
        assessmentCellId: orNull(c.assessmentCellId),
        worldId: orNull(c.worldId),
        missionId: c.missionId,
        missionIndex: c.missionIndex,
        activityId: q.typeId,
        questionType: q.typeId,
        operation: T.operation,
        conceptId: conceptIds[0],
        conceptIds: conceptIds,
        difficulty: q.difficulty,
        max: q.max,
        representation: T.representation,
        questionId: q.questionId || q.key,
        seed: q.seed >>> 0,
        numbers: Object.assign({}, q.numbers),
        template: orNull(q.template),
        correctAnswer: q.answer,
        choices: Array.isArray(q.choices) ? q.choices.slice() : null,
        submittedAnswers: subs,
        submittedAnswer: subs.length ? subs[subs.length - 1] : null,
        correct: kind === 'correct',
        outcome: kind,
        firstAttemptCorrect: subs.length > 0 && subs[0] === q.answer,
        wrongCount: wrongCount,
        hintUsed: hintsShown > 0,
        hintsShown: hintsShown,
        responseMs: ms(o.responseMs, maxMs),
        totalMs: ms(o.totalMs, maxMs),
        decisionSource: c.decisionSource || 'default',
        decision: c.decision ? JSON.parse(JSON.stringify(c.decision)) : null,
        inputMode: T.inputMode,
        observations: [],
        starEarned: c.context === 'play' || !c.context ? (typeof o.starEarned === 'boolean' ? o.starEarned : null) : null,
        speed: typeof c.speed === 'number' && c.speed > 0 ? c.speed : 1
      };
      rec.observations = errorEngine.observe(rec);
      return rec;
    }

    /* ---------- slot decisions (DESIGN 14.4, 14.5, 14.8), pure ---------- */
    const C = catalog.CURRICULUM;
    const cfgOf = (cfg) => Object.assign({ mastery: config.mastery, adaptive: config.adaptive, error: config.error }, cfg || {});
    const repOf = (id) => { const a = catalog.activityById(id); return a ? a.representation : null; };
    const copy = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));

    function evaluateIn(cache, c, cfg) {
      const snap = cache && cache.mastery ? cache.mastery[c] || null : null;
      return { snap, m: masteryEngine.evaluate(snap || masteryEngine.empty(null, c), cfg.mastery, cache && cache.now, cfg.error) };
    }

    /** 14.4: the slot family's concepts by level priority, then curriculum order. */
    function slotConcept(concepts, cache, cfg) {
      if (concepts.length === 1) return concepts[0];
      const rank = (c) => C.levelPriority.indexOf(evaluateIn(cache, c, cfg).m.level);
      return concepts.slice().sort((a, b) => (rank(a) - rank(b)) || (C.conceptOrder.indexOf(a) - C.conceptOrder.indexOf(b)))[0];
    }

    /** The one active override that applies to a slot of this family (addition or subtraction, or mixed). */
    function overrideFor(family, overrides) {
      const list = (Array.isArray(overrides) ? overrides : []).filter((o) => o && o.status === 'active' &&
        (targets.familyOf(o.conceptId) === family || targets.familyOf(o.conceptId) === 'mixed'));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (a.id < b.id ? -1 : 1));
      return list[0] || null;
    }

    /** How many slots at the end of the run already show this activity. */
    function trailing(runActivities, activityId) {
      const l = Array.isArray(runActivities) ? runActivities : [];
      let n = 0;
      for (let k = l.length - 1; k >= 0 && l[k] === activityId; k--) n++;
      return n;
    }

    /** Concreteness rank (0 = most concrete); word-problem sits just below visual (DESIGN 7, 14.3). */
    function concreteRank(rep, cfg) {
      if (rep === 'word-problem') return cfg.adaptive.concretenessOrder.indexOf('visual') + 0.5;
      const i = cfg.adaptive.concretenessOrder.indexOf(rep);
      return i < 0 ? Infinity : i;
    }

    /** P4-N2: R2 (struggle) and R4 (hint pattern) decisions; variety never makes them less concrete. */
    function struggleFloor(dec) {
      const rules = dec && Array.isArray(dec.rulesChecked) ? dec.rulesChecked : [];
      const last = rules[rules.length - 1];
      return (last === 'R2' || last === 'R4') && typeof dec.fromRepresentation === 'string' ? dec.fromRepresentation : null;
    }

    /**
     * 14.4 variety rule: a third slot in a row with the same activity takes the nearest other
     * representation of the concept's row (more concrete first, word-problem only from word-problem).
     * floorRep (P4-N2): when set, only representations at least as concrete as it qualify; with none
     * left the decided activity stays.
     */
    function varied(c, activityId, runActivities, cfg, floorRep) {
      if (trailing(runActivities, activityId) < cfg.adaptive.maxSameActivityRun) return null;
      const rep = repOf(activityId);
      const order = cfg.adaptive.concretenessOrder.concat(rep === 'word-problem' ? ['word-problem'] : []);
      const i = order.indexOf(rep) < 0 ? order.length - 1 : order.indexOf(rep);
      const floor = floorRep ? concreteRank(floorRep, cfg) : Infinity;
      const ok = (r) => r && r !== rep && adaptiveEngine.activityFor(c, r) && concreteRank(r, cfg) <= floor;
      for (let k = 1; k < order.length + 1; k++) {
        if (ok(order[i - k])) return order[i - k];
        if (ok(order[i + k])) return order[i + k];
      }
      return null;
    }

    function targetDecision(action, t, extra) {
      const a = t.adaptive;
      return Object.assign({
        action: action, reasonCode: a ? a.reasonCode : 'no_data', source: action, conceptId: t.conceptId,
        driverConceptId: t.driverConceptId, activityId: t.activityId,
        fromDifficulty: a ? a.fromDifficulty : null, toDifficulty: t.difficulty, representation: t.representation,
        template: t.template, clamped: t.clamped, adaptiveAction: a ? a.action : null
      }, extra);
    }

    /**
     * Decide one world slot. slot = { worldId, missionIndex, label (the v1 plan label) } or
     * { assignment, index }. cache = { mastery, overrides, adaptiveEnabled, now, runActivities }.
     * Returns { decisionSource, decision, activityId, difficulty, template, mixed, leadConcepts, slotConceptId }.
     * Order: assignment, override, adaptive, v1 default (D6).
     */
    function decideSlot(slot, cache, cfg0) {
      const cfg = cfgOf(cfg0);
      const s = slot || {};
      const k = cache || {};
      if (s.assignment) return assignmentQuestion(s.assignment, s.index, k, cfg);
      const i = Math.max(0, Math.min(config.MISSIONS_PER_WORLD - 1, Math.floor(Number(s.missionIndex) || 0)));
      const v1 = { activityId: s.label, difficulty: catalog.DIFFICULTY.v1Default[i] };
      const fam = catalog.slotFamily(s.worldId, s.label);
      const base = { activityId: v1.activityId, difficulty: v1.difficulty, template: null, mixed: !!(fam && fam.mixed), leadConcepts: [], slotConceptId: null };
      if (!fam || !fam.adaptive) return Object.assign(base, { decisionSource: 'default', decision: null });
      const sc = slotConcept(fam.concepts, k, cfg);
      base.slotConceptId = sc;
      // 2. override
      const ov = overrideFor(fam.family, k.overrides);
      const t = ov ? targets.resolveTarget(ov.conceptId, ov, { kind: 'slot', slotConceptId: sc, v1Default: v1 }, k, cfg) : null;
      if (t) {
        return Object.assign(base, {
          decisionSource: 'override', activityId: t.activityId, difficulty: t.difficulty, template: t.template,
          leadConcepts: [t.conceptId, t.driverConceptId],
          decision: targetDecision('override', t, { overrideId: ov.id, slotConceptId: sc })
        });
      }
      // 3. adaptive (R0 falls through to the v1 default)
      const enabled = k.adaptiveEnabled !== false;
      const rep = repOf(v1.activityId);
      if (enabled) {
        const e = evaluateIn(k, sc, cfg);
        let dec = adaptiveEngine.decide({ conceptId: sc, mastery: e.m, snapshot: e.snap, now: k.now,
          fallback: { activityId: v1.activityId, difficulty: v1.difficulty, representation: rep } }, cfg.adaptive);
        if (dec.action !== 'v1_default') {
          const alt = varied(sc, dec.activityId, k.runActivities, cfg, struggleFloor(dec));
          if (alt) {
            const act = adaptiveEngine.activityFor(sc, alt);
            dec = Object.assign(copy(dec), { representation: alt, activityId: act, template: adaptiveEngine.templateFor(sc, act), reasonCode: dec.reasonCode + '+variety' });
          }
          return Object.assign(base, { decisionSource: 'adaptive', activityId: dec.activityId, difficulty: dec.toDifficulty,
            template: dec.template, leadConcepts: [sc], decision: dec });
        }
        return Object.assign(base, { decisionSource: 'default', leadConcepts: [sc], decision: dec });
      }
      // 4. v1 default with adaptation switched off (R9 a: adaptive_off wins even without data)
      return Object.assign(base, {
        decisionSource: 'default', leadConcepts: [sc],
        decision: { action: 'v1_default', reasonCode: 'adaptive_off', source: 'default', conceptId: sc, activityId: v1.activityId,
          fromDifficulty: v1.difficulty, toDifficulty: v1.difficulty, fromRepresentation: rep, representation: rep,
          evidence: null, rulesChecked: [], template: null }
      });
    }

    /** True when an assignment practises both operations (its attempts credit addsub.mixed, 6.3). */
    function bothOperations(conceptIds) {
      const fams = (conceptIds || []).map(targets.familyOf);
      return fams.indexOf('mixed') >= 0 || (fams.indexOf('addition') >= 0 && fams.indexOf('subtraction') >= 0);
    }

    /**
     * Assignment question i (14.8): concept conceptIds[i % n], occurrence j = floor(i / n), rotation
     * j (floor(j / 2) for addsub.mixed). The variety rule applies only when both the activity and the
     * representation are Auto (R9 b). cache.runActivities lists the activities of this sitting.
     */
    function assignmentQuestion(assignment, i, cache, cfg0) {
      const cfg = cfgOf(cfg0);
      const a = assignment || {};
      const ids = Array.isArray(a.conceptIds) && a.conceptIds.length ? a.conceptIds : ['add.combine'];
      const n = ids.length, ii = Math.max(0, Math.floor(Number(i) || 0));
      const c = ids[ii % n], j = Math.floor(ii / n);
      const rot = c === 'addsub.mixed' ? Math.floor(j / 2) : j;
      const fixed = targets.normFixed(a);
      let t = targets.resolveTarget(c, fixed, { kind: 'assignment', j: j, rot: rot }, cache || {}, cfg);
      if (!t) t = { conceptId: c, driverConceptId: c, activityId: 'add', representation: 'visual', difficulty: 2, template: null, clamped: false, adaptive: null };
      let variety = false;
      if (!fixed.activityIds.length && !fixed.representation) {
        const alt = varied(t.driverConceptId, t.activityId, cache && cache.runActivities, cfg, struggleFloor(t.adaptive));
        if (alt) {
          const act = adaptiveEngine.activityFor(t.driverConceptId, alt);
          t = Object.assign({}, t, { activityId: act, representation: alt, template: adaptiveEngine.templateFor(t.driverConceptId, act) });
          variety = true;
        }
      }
      const decision = targetDecision('assignment', t, { assignmentId: a.id || null, occurrence: j });
      if (variety) decision.reasonCode += '+variety';
      return {
        decisionSource: 'assignment', decision: decision, activityId: t.activityId, difficulty: t.difficulty, template: t.template,
        mixed: bothOperations(ids), leadConcepts: [t.conceptId, t.driverConceptId], slotConceptId: null
      };
    }

    /**
     * The automatic recommendation for one concept (14.5, 14.8): decide on a matrix concept itself
     * (fallback = its table default), resolveTarget with every field Auto and j = 0 for a range or
     * mixed concept; null for rep.transition and tracking-only concepts.
     */
    function recommendationFor(c, cache, cfg0) {
      const cfg = cfgOf(cfg0);
      const A = C.assignable[c];
      if (!A || !Object.prototype.hasOwnProperty.call(C.assignable, c)) return null;
      if (adaptiveEngine.isMatrixConcept(c)) {
        const e = evaluateIn(cache, c, cfg);
        return adaptiveEngine.decide({ conceptId: c, mastery: e.m, snapshot: e.snap, now: cache && cache.now,
          fallback: { activityId: A.default.activityId, difficulty: A.default.difficulty, representation: repOf(A.default.activityId) } }, cfg.adaptive);
      }
      const t = targets.resolveTarget(c, {}, { kind: 'assignment', j: 0, rot: 0 }, cache, cfg);
      return t ? targetDecision('adaptive', t, { action: t.adaptive ? t.adaptive.action : 'concept_default' }) : null;
    }

    /** 14.5: every credited selectable concept, plus range and mixed concepts whose driver was credited. */
    function recommendableAffected(conceptIds) {
      const credited = conceptIds || [];
      return targets.SELECTABLE.filter((c) => {
        if (credited.indexOf(c) >= 0) return true;
        const A = C.assignable[c];
        if (adaptiveEngine.isMatrixConcept(c)) return false;
        return credited.indexOf(A.defaultDriver) >= 0 || (A.oddDriver && credited.indexOf(A.oddDriver) >= 0);
      });
    }

    /** N16 e: the newest `n` question ids of an activity within the cached recent list (newest first). */
    function recentQuestionIds(recent, activityId, n) {
      const out = [];
      (recent || []).forEach((r) => { if (r && r.activityId === activityId && out.length < n) out.push(r.questionId); });
      return out;
    }

    return {
      buildAttempt, creditedConcepts, responseTimes, decideSlot, assignmentQuestion, recommendationFor,
      recommendableAffected, recentQuestionIds, slotConcept,
      resolveTarget: targets.resolveTarget, candidateList: targets.candidateList,
      validateAssignment: targets.validateAssignment, validateOverride: targets.validateOverride, familyOf: targets.familyOf,
      overridesToEnd: targets.overridesToEnd, assignmentComplete: targets.assignmentComplete,
      SCHEMA_VERSION
    };
  });
}());
