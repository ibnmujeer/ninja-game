/*
 * assessments (L4): Ninja Check runs (DESIGN 15.2 to 15.4, D8, N15, R3, R4). Reads and writes the
 * assessments store; the per-student cache of open runs lives in the learning service (R3), so the
 * child screens read it synchronously.
 *
 *   request(studentId, form, { createdBy }?)  a pending run with fresh items, excluding every question
 *       id of the student's earlier runs; at most one pending or in_progress run per form, else
 *       { created: false, reason: 'already_open', runId }. Resolves { created: true, runId, run }.
 *   requestForClass(classId, form)  request for every active student of a class: summary counts
 *   cancel(runId)        N15: only an open run with no answer yet; status 'cancelled' (never shown again)
 *   begin(runId)         the cached open run of the loaded student (the live record the child plays)
 *   answer(run, cellId, submitted, attempt)  the single answer: the run is updated in memory first
 *       (answers[cellId], in_progress, startedAt; the last answer also complete, completedAt, result),
 *       then ONE batch writes the attempt (add) and the run (put) through the learning queue, which
 *       retries a failed write. Resolves nothing the child waits for: { accepted, correct, complete, written }
 *   nextCell(run, cellId), resumeCell(run)  R4: the first unanswered cell after cellId / from the start
 *   openRuns()           the loaded student's open runs: baseline first, then post, oldest first
 *   isLocked(student) / lockedRun(student)  a student with baselineRequired, no complete baseline and
 *       an open baseline run plays the Ninja Check before worlds (the default player never: D8)
 *   baselineOps(studentId, want, runs?)  P6 (P5-N2, N15): the ops a student write that sets
 *       baselineRequired puts in the SAME batch (a new pending baseline, or the unanswered one cancelled)
 * create({ repo, learning, now?, newId?, seedSource? }) makes an independent service (tests).
 */
(function () {
  'use strict';

  NBA.define('assessments', ['config', 'util', 'repo', 'assessmentEngine', 'learning'],
    (config, util, appRepo, engine, appLearning) => {
      const OPEN = ['pending', 'in_progress'];
      const FORM_ORDER = ['baseline', 'post'];
      const copy = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));
      const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

      function create(options) {
        const o = options || {};
        const repo = o.repo || appRepo;
        const learning = o.learning || appLearning;
        const now = typeof o.now === 'function' ? o.now : () => util.now();
        const newId = typeof o.newId === 'function' ? o.newId : (p) => util.newId(p, now());
        const seedSource = typeof o.seedSource === 'function' ? o.seedSource : () => util.newSeed();

        async function runsOf(studentId) {
          return (await repo.getAll('assessments', { index: 'studentId', value: studentId })) || [];
        }

        /** A new pending run with fresh items (every question id of the student's earlier runs excluded). */
        function freshRun(studentId, form, runs, createdBy) {
          const exclude = [];
          runs.forEach((r) => (r.items || []).forEach((it) => exclude.push(it.questionId)));
          return engine.newRun({
            id: newId('asm'), studentId: studentId, form: form, createdAt: now(), createdBy: createdBy === 'system' ? 'system' : 'teacher',
            items: engine.buildItems(config.assessment.blueprintId, form, exclude, seedSource)
          });
        }

        async function request(studentId, form, opts) {
          if (engine.FORMS.indexOf(form) < 0) return { created: false, reason: 'bad_form' };
          const runs = await runsOf(studentId);
          const open = runs.find((r) => r.form === form && OPEN.indexOf(r.status) >= 0);
          if (open) return { created: false, reason: 'already_open', runId: open.id };
          const run = freshRun(studentId, form, runs, opts && opts.createdBy);
          await repo.put('assessments', run);
          learning.noteCheck(run);
          return { created: true, runId: run.id, run: copy(run) };
        }

        /**
         * P5-N2 / N15 (P6): the assessments ops that go in the SAME batch as a student write that sets
         * baselineRequired to `want`: ticked with no open or complete baseline -> a new pending baseline;
         * unticked -> an unanswered pending baseline is cancelled. Nothing is written here.
         */
        async function baselineOps(studentId, want, known) {
          const runs = Array.isArray(known) ? known : await runsOf(studentId);
          const base = runs.filter((r) => r.form === 'baseline');
          const open = base.find((r) => OPEN.indexOf(r.status) >= 0);
          if (want) {
            if (open || base.some((r) => r.status === 'complete')) return [];
            return [{ op: 'put', store: 'assessments', value: freshRun(studentId, 'baseline', runs, 'teacher') }];
          }
          if (open && open.status === 'pending' && !Object.keys(open.answers || {}).length) {
            return [{ op: 'put', store: 'assessments', value: Object.assign(copy(open), { status: 'cancelled', cancelledAt: now() }) }];
          }
          return [];
        }

        async function requestForClass(classId, form) {
          const students = ((await repo.getAll('students', { index: 'classId', value: classId })) || []).filter((s) => s.status === 'active');
          const out = { total: students.length, created: 0, alreadyOpen: 0, failed: 0, runIds: [] };
          for (const s of students) {
            try {
              const r = await request(s.id, form);
              if (r.created) { out.created++; out.runIds.push(r.runId); } else if (r.reason === 'already_open') out.alreadyOpen++; else out.failed++;
            } catch (e) { out.failed++; }
          }
          return out;
        }

        async function cancel(runId) {
          const run = learning.openCheck(runId) || await repo.get('assessments', runId);
          if (!run) return { cancelled: false, reason: 'not_found' };
          if (OPEN.indexOf(run.status) < 0) return { cancelled: false, reason: 'not_open' };
          if (Object.keys(run.answers || {}).length) return { cancelled: false, reason: 'has_answers' };
          const rec = Object.assign(copy(run), { status: 'cancelled', cancelledAt: now() });
          await repo.put('assessments', rec);
          learning.noteCheck(rec);
          return { cancelled: true, runId: runId };
        }

        function begin(runId) { return learning.openCheck(runId); }

        function answer(run, cellId, submitted, attempt) {
          const item = run && Array.isArray(run.items) ? run.items.find((it) => it.cellId === cellId) : null;
          if (!item || OPEN.indexOf(run.status) < 0) return { accepted: false, reason: 'not_open' };
          if (has(run.answers, cellId)) return { accepted: false, reason: 'already_answered' };
          const correct = engine.scoreItem(item, submitted) === 1;
          const t = now();
          run.answers[cellId] = { attemptId: attempt.id, submitted: Number(submitted), correct: correct };
          if (run.startedAt === null || run.startedAt === undefined) run.startedAt = t;
          run.status = 'in_progress';
          if (engine.isComplete(run)) {
            run.status = 'complete';
            run.completedAt = t;
            run.result = engine.scoreRun(run);
          }
          learning.noteCheck(run);
          const written = learning.recordAttempt(attempt, [{ op: 'put', store: 'assessments', value: copy(run) }]);
          return { accepted: true, correct: correct, complete: run.status === 'complete', written: written };
        }

        function openRuns() {
          return learning.openChecks().sort((a, b) => (FORM_ORDER.indexOf(a.form) - FORM_ORDER.indexOf(b.form)) ||
            (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1));
        }

        function lockedRun(student) {
          if (!student || student.baselineRequired !== true || student.id !== learning.currentStudentId() || learning.baselineDone()) return null;
          return openRuns().find((r) => r.form === 'baseline') || null;
        }

        return {
          request, requestForClass, cancel, begin, answer, openRuns, lockedRun, baselineOps,
          isLocked: (student) => !!lockedRun(student),
          nextCell: engine.nextCell, resumeCell: engine.resumeCell,
          runsOf: async (studentId) => copy(await runsOf(studentId))
        };
      }

      const app = create();
      return Object.assign({ create }, app);
    });
}());
