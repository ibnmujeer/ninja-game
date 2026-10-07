/*
 * assessmentEngine (L2): the Ninja Check (DESIGN 15, D8). Pure: no DOM, no clock, no Math.random;
 * the caller passes seeds (seedSource), times and ids. Child text lives in child/assessment-ui.js.
 *
 *   buildItems(blueprint, form, excludeQuestionIds, seedSource)  one fresh question per blueprint cell,
 *       in cell order; a question id in excludeQuestionIds (every earlier run's) is never chosen while
 *       the cell's pool has another; when it must be reused the item says instanceReused: true
 *   newRun({ id, studentId, form, createdAt, createdBy, items, blueprintId? })  the stored run record
 *   questionFor(item, heroId)  the question an item shows (same numbers, seed and template: the same
 *       question and button order every time; heroId only names the word-problem hero)
 *   attemptParts(run, cellId, submitted)  { outcome, ctx } for learningEngine.buildAttempt: one
 *       submission, no hint, no star, context 'assessment', decisionSource 'assessment'
 *   scoreItem(item, submitted)  1 when the single submission equals the answer, else 0
 *   scoreRun(run)        { correct, total, percent, byConcept, byRepresentation } (unanswered items score 0)
 *   nextCell(run, cellId)  the first cell after cellId in blueprint order with no answer (null: none left);
 *   resumeCell(run)        the same from the start: where a run resumes (R4)
 *   pickRuns(runs)       the latest complete baseline and the latest complete post after it (N15:
 *       pending, in-progress and cancelled runs are ignored), with reason missing_baseline | missing_post
 *   compare(baseline, post)  scores and changes between two complete runs of one blueprint, or
 *       { comparable: false, reason: missing_baseline | missing_post | blueprint_mismatch }
 */
(function () {
  'use strict';

  NBA.define('assessmentEngine', ['config', 'util', 'catalog', 'generator'], (config, util, catalog, generator) => {
    const FORMS = config.assessment.forms;
    const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const round1 = (x) => Math.round(x * 10) / 10;
    const pct = (c, t) => (t > 0 ? round1(100 * c / t) : null);
    const copy = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));

    function blueprintOf(b) {
      const bp = typeof b === 'string' ? catalog.blueprintById(b) : b;
      if (!bp || !Array.isArray(bp.cells) || !bp.cells.length) throw new Error('[NBA] unknown assessment blueprint ' + String(b && b.id || b));
      return bp;
    }

    /** A seed source from one number (tests and NBA_TEST.seed give reproducible checks). */
    function seedsFrom(n) {
      const rng = util.rngFrom(n);
      return () => Math.floor(rng() * 4294967296) >>> 0;
    }

    function buildItems(blueprint, form, excludeQuestionIds, seedSource) {
      const bp = blueprintOf(blueprint);
      if (FORMS.indexOf(form) < 0) throw new Error('[NBA] unknown assessment form ' + form);
      const exclude = new Set(Array.isArray(excludeQuestionIds) || excludeQuestionIds instanceof Set ? excludeQuestionIds : []);
      const used = new Set(exclude); // also keeps two cells of one run from sharing a question
      const nextSeed = typeof seedSource === 'function' ? seedSource : util.newSeed;
      return bp.cells.map((cell) => {
        const seed = Number(nextSeed()) >>> 0;
        const q = generator.generate(cell.activityId, cell.difficulty, used, seed, { template: cell.template });
        used.add(q.questionId);
        return {
          cellId: cell.id, activityId: cell.activityId, conceptId: cell.conceptId, representation: cell.representation,
          difficulty: cell.difficulty, template: cell.template, transfer: cell.transfer === true,
          seed: q.seed, questionId: q.questionId, numbers: Object.assign({}, q.numbers), instanceReused: exclude.has(q.questionId)
        };
      });
    }

    function newRun(f) {
      return {
        id: f.id, studentId: f.studentId, form: f.form, blueprintId: f.blueprintId || config.assessment.blueprintId,
        status: 'pending', createdAt: f.createdAt, createdBy: f.createdBy === 'system' ? 'system' : 'teacher',
        startedAt: null, completedAt: null, cancelledAt: null, items: copy(f.items) || [], answers: {}, result: null
      };
    }

    function questionFor(item, heroId) {
      return generator.createQuestion(item.activityId, item.numbers, item.difficulty, item.seed, { heroId: heroId || null, template: item.template });
    }

    const itemOf = (run, cellId) => ((run && run.items) || []).find((it) => it.cellId === cellId) || null;

    function scoreItem(item, submitted) {
      if (!item || submitted === null || submitted === undefined || submitted === '') return 0;
      return Number(submitted) === questionFor(item, null).answer ? 1 : 0;
    }

    function attemptParts(run, cellId, submitted) {
      const item = itemOf(run, cellId);
      if (!item) throw new Error('[NBA] no assessment cell ' + cellId);
      const index = run.items.indexOf(item);
      return {
        item: item,
        outcome: { outcome: scoreItem(item, submitted) === 1 ? 'correct' : 'incorrect', submittedAnswers: [Number(submitted)], hintsShown: 0, starEarned: null },
        ctx: {
          context: 'assessment', assessmentId: run.id, assessmentForm: run.form, assessmentCellId: item.cellId,
          worldId: null, missionId: run.blueprintId + '.' + item.cellId, missionIndex: index,
          decisionSource: 'assessment', decision: null, mixed: false, leadConcepts: [item.conceptId], transfer: item.transfer === true
        }
      };
    }

    function bump(map, key, s) {
      if (!own(map, key)) map[key] = { correct: 0, total: 0, percent: null };
      map[key].correct += s;
      map[key].total += 1;
    }
    function finish(map) {
      Object.keys(map).forEach((k) => { map[k].percent = pct(map[k].correct, map[k].total); });
      return map;
    }

    function scoreRun(run) {
      const items = (run && Array.isArray(run.items)) ? run.items : [];
      const answers = (run && run.answers) || {};
      let correct = 0;
      const byConcept = {}, byRepresentation = {};
      items.forEach((it) => {
        const s = own(answers, it.cellId) ? scoreItem(it, answers[it.cellId].submitted) : 0;
        correct += s;
        bump(byConcept, it.conceptId, s);
        bump(byRepresentation, it.representation, s);
      });
      return { correct: correct, total: items.length, percent: pct(correct, items.length), byConcept: finish(byConcept), byRepresentation: finish(byRepresentation) };
    }

    function nextCell(run, cellId) {
      const ids = ((run && run.items) || []).map((it) => it.cellId);
      const answers = (run && run.answers) || {};
      const start = cellId ? ids.indexOf(cellId) + 1 : 0;
      for (let k = Math.max(0, start); k < ids.length; k++) if (!own(answers, ids[k])) return ids[k];
      return null;
    }
    function resumeCell(run) { return nextCell(run, null); }
    function isComplete(run) {
      const items = (run && run.items) || [];
      return items.length > 0 && items.every((it) => own(run.answers, it.cellId));
    }

    /** Latest by completedAt; equal times: the greater id counts as later. */
    function latest(list) {
      return list.slice().sort((a, b) => (b.completedAt - a.completedAt) || (a.id < b.id ? 1 : (a.id > b.id ? -1 : 0)))[0] || null;
    }

    function pickRuns(runs) {
      const done = (Array.isArray(runs) ? runs : []).filter((r) => r && r.status === 'complete' && typeof r.completedAt === 'number');
      const baseline = latest(done.filter((r) => r.form === 'baseline'));
      if (!baseline) return { baseline: null, post: null, reason: 'missing_baseline' };
      const post = latest(done.filter((r) => r.form === 'post' && r.completedAt > baseline.completedAt));
      return { baseline: baseline, post: post, reason: post ? null : 'missing_post' };
    }

    function change(b, p) {
      const out = {};
      Object.keys(b).concat(Object.keys(p).filter((k) => !own(b, k))).forEach((k) => {
        const bp = own(b, k) ? b[k].percent : null, pp = own(p, k) ? p[k].percent : null;
        out[k] = { baselinePercent: bp, postPercent: pp, pointChange: bp === null || pp === null ? null : round1(pp - bp) };
      });
      return out;
    }

    function compare(baseline, post) {
      if (!baseline || baseline.status !== 'complete') return { comparable: false, reason: 'missing_baseline' };
      if (!post || post.status !== 'complete') return { comparable: false, reason: 'missing_post' };
      if (baseline.blueprintId !== post.blueprintId) return { comparable: false, reason: 'blueprint_mismatch' };
      const b = scoreRun(baseline), p = scoreRun(post);
      const score = (s) => ({ correct: s.correct, total: s.total, percent: s.percent });
      return {
        comparable: true, reason: null, blueprintId: baseline.blueprintId, baselineRunId: baseline.id, postRunId: post.id,
        baselineScore: score(b), postScore: score(p),
        absoluteImprovement: p.correct - b.correct,
        percentagePointImprovement: b.percent === null || p.percent === null ? null : round1(p.percent - b.percent),
        conceptChange: change(b.byConcept, p.byConcept),
        representationChange: change(b.byRepresentation, p.byRepresentation)
      };
    }

    return {
      FORMS, seedsFrom, buildItems, newRun, questionFor, attemptParts, scoreItem, scoreRun,
      nextCell, resumeCell, isComplete, pickRuns, compare, round1
    };
  });
}());
