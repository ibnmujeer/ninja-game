/*
 * learning (L4): the per-student cache, sessions, attempt recording and the write queue
 * (DESIGN 9.5, 11, 16.5, N17). P4 adds mastery, recommendations and slot decisions here.
 *
 *   loadStudent(studentId)     fills the cache: the student's 5 worldProgress records and the
 *                              question ids of their newest config.attempt.recentLimit attempts
 *   worldRecord(worldId)       { best, done } for the loaded student (synchronous)
 *   applyUnsaved(sid, worlds)  show values for this session without writing them (P2-M1)
 *   saveWorldResult(studentId, worldId, { stars, done })
 *                              applied to the cache at once (best = max, done = or), then written
 *                              through the retry queue; the child flow never waits for storage
 *   startSession({ studentId, kind, worldId?, assignmentId?, assessmentId? }) -> session id
 *                              (the first question of a run; written through the queue)
 *   endSession()               endedAt and attemptCount (World Complete, Home, change of student,
 *                              pagehide); a session left open by a closed tab keeps endedAt null
 *   recordAttempt(rec)         P4 (DESIGN 14.5): updates the cached mastery snapshot of every credited
 *                              concept, remembers the question id, refreshes the recommendations it
 *                              affects, then writes attempt (add), mastery, recommendations and the
 *                              session (put) in one batch through the queue
 *   loadStudent also caches mastery snapshots, recommendations, active overrides and open assignments;
 *   decideSlotFor(run, i) decides a world slot from that cache only (learningEngine.decideSlot);
 *   recentExclude(activityId), isAdaptive()/setAdaptive(bool) (N6), lastDecisions() (test hook).
 *   recordAttempt(rec, extraOps?)  P5: extra batch ops (a Ninja Check answer's run put) join the batch
 *   openChecks(), openCheck(runId), noteCheck(run), baselineDone()  R3 (P5): the student's open Ninja
 *                              Check runs from the assessments studentId index (cancelled runs never)
 *   P6 (R3, 17.6): the student's open assignments (listed by id, or their whole class) and
 *   assignmentProgress(id) { count, totalMs } from the assignmentId index (this student only), updated
 *   synchronously in recordAttempt; homeAssignments() (open and not complete), assignment(id),
 *   decideAssignmentFor(run, i). Teacher writes (overrides, assignments) live in teacher-data.js.
 *   flush()                    retry queued writes (main.js: visibilitychange hidden and pagehide)
 *
 * The queue keeps at most config.storage.retryMax items (the oldest are dropped and counted). A
 * newer write for the same key replaces a queued older one, and writes run one at a time in order,
 * so a retried older value never lands after a newer one. A record the schema refuses is a bug: it
 * is dropped with one console.error instead of blocking the queue; an attempt already stored
 * (ConstraintError on retry) counts as written.
 * create({ repo, now?, newId? }) makes an independent service (tests); the module itself is the app's.
 */
(function () {
  'use strict';

  NBA.define('learning', ['config', 'util', 'catalog', 'repo', 'masteryEngine', 'learningEngine'],
    (config, util, catalog, appRepo, masteryEngine, learningEngine) => {
    const { WORLDS } = catalog;
    const CFG = { mastery: config.mastery, adaptive: config.adaptive, error: config.error };
    const copy = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));

    function create(options) {
      const o = options || {};
      const repo = o.repo || appRepo;
      const now = typeof o.now === 'function' ? o.now : () => util.now();
      const newId = typeof o.newId === 'function' ? o.newId : (p) => util.newId(p, now());
      const retryMax = o.retryMax || config.storage.retryMax;
      const recentLimit = config.attempt.recentLimit;
      const log = o.log || { error(m) { try { console.error(m); } catch (e) { /* ignore */ } } };
      let adaptiveEnabled = typeof o.adaptive === 'boolean' ? o.adaptive : config.adaptive.enabled;

      let studentId = null;
      let worlds = {};      // worldId -> { best, done }
      let recent = [];      // newest first: { activityId, questionId }
      let session = null;   // the open session record
      // P4 per-student cache (DESIGN 14.5, 20): every slot decision reads only these
      let mastery = {};     // conceptId -> mastery snapshot (12.2)
      let recs = {};        // conceptId -> recommendations record
      let overrides = [];   // the student's active overrides
      let assignments = []; // open assignments (teacher mode writes them in P6)
      let checks = [];      // R3 (P5): the student's open Ninja Check runs (pending, in_progress), live records
      let baselineDone = false; // the student has a complete baseline run
      let progress = {};    // R3 (P6): assignmentId -> { count, totalMs } of this student's attempts
      let lastDecision = {}; // conceptId -> the decision of the latest attempt on it
      let decisionLog = []; // the newest slot decisions of this page (test hook), at most 100
      const queue = [];     // { keyStr, store?, record?, ops? }
      let dropped = 0;
      let flushing = null, again = false;

      function emptyWorlds() {
        const w = {};
        WORLDS.forEach((x) => { w[x.id] = { best: 0, done: false }; });
        return w;
      }

      function clearCache() {
        mastery = {}; recs = {}; overrides = []; assignments = []; lastDecision = {}; checks = []; baselineDone = false; progress = {};
      }

      /** An assignment targets the student: listed by id, or the whole class (no ids listed). */
      function aimsAt(a, student) {
        const ids = a.studentIds || [];
        return ids.length ? ids.indexOf(student.id) >= 0 : (!!a.classId && !!student.classId && a.classId === student.classId);
      }

      const OPEN_CHECK = ['pending', 'in_progress'];
      /**
       * Keep the Ninja Check cache in step with a run record of the loaded student (the assessment
       * service calls this after every change): open runs are kept (the given object becomes the
       * cached one), others removed (N15: cancelled runs never show); a complete baseline is noted.
       */
      function noteCheck(run) {
        if (!run || run.studentId !== studentId) return;
        const i = checks.findIndex((r) => r.id === run.id);
        if (OPEN_CHECK.indexOf(run.status) >= 0) { if (i >= 0) checks[i] = run; else checks.push(run); }
        else if (i >= 0) checks.splice(i, 1);
        if (run.form === 'baseline' && run.status === 'complete') baselineDone = true;
      }

      async function loadStudent(id) {
        studentId = id;
        worlds = emptyWorlds();
        recent = [];
        clearCache();
        const read = async (store, q) => { try { return (await repo.getAll(store, q)) || []; } catch (e) { return []; } };
        const rows = await read('worldProgress', { index: 'studentId', value: id });
        const atts = await read('attempts', { index: 'studentTime', lower: [id, 0], upper: [id, Infinity], direction: 'prev', limit: recentLimit });
        const snaps = await read('mastery', { index: 'studentId', value: id });
        const recRows = await read('recommendations', { index: 'studentId', value: id });
        const ovRows = await read('overrides', { index: 'studentId', value: id });
        const asgRows = await read('assignments', { index: 'status', value: 'open' });
        const asmRows = await read('assessments', { index: 'studentId', value: id });
        let student = null;
        try { student = await repo.get('students', id); } catch (e) { student = null; }
        const mine = asgRows.filter((a) => aimsAt(a, student || { id: id, classId: null }));
        // R3 (P6): progress per open assignment from the assignmentId index, this student's records only
        const prog = {};
        for (const a of mine) {
          const rowsA = (await read('attempts', { index: 'assignmentId', value: a.id })).filter((x) => x.studentId === id);
          prog[a.id] = { count: rowsA.length, totalMs: rowsA.reduce((n, x) => n + (typeof x.totalMs === 'number' ? x.totalMs : 0), 0) };
        }
        if (studentId !== id) return; // another student was loaded meanwhile
        progress = prog;
        asmRows.forEach(noteCheck);
        rows.forEach((r) => { worlds[r.worldId] = { best: r.best, done: r.done }; });
        recent = atts.map((a) => ({ activityId: a.activityId, questionId: a.questionId }));
        snaps.forEach((s) => { mastery[s.conceptId] = s; });
        recRows.forEach((r) => { recs[r.conceptId] = r; });
        overrides = ovRows.filter((r) => r.status === 'active');
        await rebuildStale(id, atts);
        if (studentId !== id) return;
        // named students, or the whole class of this student (P6)
        assignments = mine.sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1));
        atts.slice().reverse().forEach((a) => { if (a.decision && a.decision.conceptId) lastDecision[a.decision.conceptId] = a.decision; });
      }

      /**
       * The mastery store is a cache of the attempts (DESIGN 9.2, 12.2). A concept whose snapshot is
       * missing or older than its newest stored attempt (attempts written without the play path, for
       * example imported or planted ones) is rebuilt from all of the student's attempts, once, and the
       * rebuilt snapshot and its recommendations are written back through the queue.
       */
      async function rebuildStale(id, newest) {
        const inc = config.mastery.includeContexts;
        const latest = {};
        newest.forEach((a) => {
          if (inc.indexOf(a.context) < 0 || !Array.isArray(a.conceptIds)) return;
          a.conceptIds.forEach((c) => { latest[c] = Math.max(latest[c] || 0, a.timestamp || 0); });
        });
        const stale = Object.keys(latest).filter((c) => !mastery[c] || (mastery[c].lastAttemptAt || 0) < latest[c]);
        if (!stale.length) return;
        let all = [];
        try { all = (await repo.getAll('attempts', { index: 'studentId', value: id })) || []; } catch (e) { return; }
        if (studentId !== id) return;
        stale.forEach((c) => {
          mastery[c] = masteryEngine.rebuild(all, id, c, config.mastery);
          enqueue({ keyStr: 'mastery|' + id + '|' + c, store: 'mastery', record: mastery[c] });
        });
        const view = cacheView([]);
        learningEngine.recommendableAffected(stale).forEach((c) => {
          const d = learningEngine.recommendationFor(c, view, CFG);
          if (!d) return;
          recs[c] = { studentId: id, conceptId: c, createdAt: now(), source: 'adaptive', decision: d };
          enqueue({ keyStr: 'recommendations|' + id + '|' + c, store: 'recommendations', record: recs[c] });
        });
        flush();
      }

      /** The cache contents a pure slot decision reads (DESIGN 14.5). */
      function cacheView(runActivities) {
        return { mastery: mastery, overrides: overrides, adaptiveEnabled: adaptiveEnabled, now: now(), runActivities: runActivities || [] };
      }

      /** Decide slot i of a world run from the cache only (run = { worldId, plan, activities }). */
      function decideSlotFor(run, i) {
        const d = learningEngine.decideSlot({ worldId: run.worldId, missionIndex: i, label: run.plan[i] }, cacheView(run.activities), CFG);
        decisionLog.push({ worldId: run.worldId, missionIndex: i, label: run.plan[i], decisionSource: d.decisionSource,
          activityId: d.activityId, difficulty: d.difficulty, decision: copy(d.decision) });
        if (decisionLog.length > 100) decisionLog = decisionLog.slice(-100);
        return d;
      }

      /** The question keys generation should avoid for this activity (N16 e: newest 20 of the cached 200). */
      function recentExclude(activityId) {
        return new Set(learningEngine.recentQuestionIds(recent, activityId, config.adaptive.recentQuestionWindow));
      }

      /** Show validated values for this session without writing them: best = max, done = or (P2-M1). */
      function applyUnsaved(sid, byWorld) {
        if (sid !== studentId || !byWorld) return;
        Object.keys(byWorld).forEach((worldId) => {
          const x = byWorld[worldId], rec = worldRecord(worldId);
          if (!x) return;
          rec.best = Math.max(rec.best, Number(x.best) || 0);
          rec.done = rec.done || x.done === true;
        });
      }

      /** The record for one world, created on first use (v1 Store.world). */
      function worldRecord(worldId) {
        if (!worlds[worldId]) worlds[worldId] = { best: 0, done: false };
        return worlds[worldId];
      }

      function enqueue(item) {
        const i = queue.findIndex((q) => q.keyStr === item.keyStr);
        if (i >= 0) queue.splice(i, 1);
        queue.push(item);
        if (queue.length > retryMax) dropped += queue.splice(0, queue.length - retryMax).length;
      }

      function runItem(item) { return item.ops ? repo.batch(item.ops) : repo.put(item.store, item.record); }

      /** Write queued items in order, one at a time; stop at the first failure (kept for retry). */
      function flush() {
        if (flushing) { again = true; return flushing; }
        flushing = (async () => {
          let failed = false;
          do {
            again = false;
            for (const item of queue.slice()) {
              try {
                await runItem(item);
              } catch (e) {
                const name = e && e.name;
                if (name === 'ValidationError') {
                  log.error('[NBA] a record was refused by the schema and dropped: ' + (e && e.message));
                } else if (!(name === 'ConstraintError' && item.ops)) {
                  failed = true;
                  break;
                }
              }
              const i = queue.indexOf(item);
              if (i >= 0) queue.splice(i, 1);
            }
          } while (again && !failed);
          return !failed;
        })().finally(() => { flushing = null; });
        return flushing;
      }

      /**
       * Best stars and completion after a mission or World Complete. Resolves true when the
       * write (and any queued older ones) reached storage, false when it stays queued.
       */
      function saveWorldResult(sid, worldId, result) {
        if (sid !== studentId) return Promise.resolve(false); // only the loaded student plays
        const r = result || {};
        const rec = worldRecord(worldId);
        rec.best = Math.max(rec.best, Number(r.stars) || 0);
        rec.done = rec.done || r.done === true;
        enqueue({ keyStr: 'worldProgress|' + sid + '|' + worldId, store: 'worldProgress',
          record: { studentId: sid, worldId: worldId, best: rec.best, done: rec.done, updatedAt: now(), source: 'play' } });
        return flush();
      }

      const sessionCopy = () => Object.assign({}, session);

      /** Open a session for the first question of a run (ends any open one first). */
      function startSession(args) {
        const a = args || {};
        if (session) endSession();
        session = { id: newId('ses'), studentId: a.studentId, kind: a.kind || 'play', startedAt: now(), endedAt: null,
          worldId: a.worldId || null, assignmentId: a.assignmentId || null, assessmentId: a.assessmentId || null, attemptCount: 0 };
        enqueue({ keyStr: 'sessions|' + session.id, store: 'sessions', record: sessionCopy() });
        flush();
        return session.id;
      }

      /** Close the open session (no-op when none is open). */
      function endSession() {
        if (!session) return Promise.resolve(true);
        session.endedAt = now();
        enqueue({ keyStr: 'sessions|' + session.id, store: 'sessions', record: sessionCopy() });
        session = null;
        return flush();
      }

      /**
       * Store one attempt record (built by learningEngine.buildAttempt). The UI never awaits this.
       * For the loaded student, synchronously and in this order (DESIGN 14.5): 1. mastery update for
       * every credited concept, 2. the question id, 3. recommendations for every recommendable concept
       * affected, 4. one batch (attempts add, mastery put, recommendations put, session put).
       */
      function recordAttempt(rec, extraOps) {
        const ops = [{ op: 'add', store: 'attempts', value: rec }];
        if (rec.studentId === studentId) {
          const credited = Array.isArray(rec.conceptIds) ? rec.conceptIds : [];
          credited.forEach((c) => {
            const before = mastery[c] || masteryEngine.empty(studentId, c);
            const after = masteryEngine.update(before, rec, config.mastery);
            if (after !== before) { mastery[c] = after; ops.push({ op: 'put', store: 'mastery', value: after }); }
          });
          recent.unshift({ activityId: rec.activityId, questionId: rec.questionId });
          if (recent.length > recentLimit) recent.length = recentLimit;
          const view = cacheView([]);
          learningEngine.recommendableAffected(credited).forEach((c) => {
            const d = learningEngine.recommendationFor(c, view, CFG);
            if (!d) return;
            recs[c] = { studentId: studentId, conceptId: c, createdAt: now(), source: 'adaptive', decision: d };
            ops.push({ op: 'put', store: 'recommendations', value: recs[c] });
          });
          if (rec.decision && rec.decision.conceptId) lastDecision[rec.decision.conceptId] = rec.decision;
          // R3 (P6): the assignment's progress, synchronously (Home tiles and the start index read it)
          if (rec.assignmentId) {
            const p = progress[rec.assignmentId] || (progress[rec.assignmentId] = { count: 0, totalMs: 0 });
            p.count++;
            p.totalMs += typeof rec.totalMs === 'number' ? rec.totalMs : 0;
          }
        }
        if (session && session.id === rec.sessionId) {
          session.attemptCount++;
          ops.push({ op: 'put', store: 'sessions', value: sessionCopy() });
        }
        // P5 (DESIGN 15.4): a Ninja Check answer saves its run in the same batch
        (Array.isArray(extraOps) ? extraOps : []).forEach((x) => ops.push(x));
        enqueue({ keyStr: 'attempts|' + rec.id, ops: ops });
        return flush();
      }

      /* ---------- P6: assignment runs (child) ---------- */
      const progressOf = (id) => Object.assign({ count: 0, totalMs: 0 }, progress[id] || {});
      /** Open assignments of the loaded student that are not complete yet (the Home tiles, oldest first). */
      function homeAssignments() {
        return copy(assignments.filter((a) => a.status === 'open' && !learningEngine.assignmentComplete(a, progressOf(a.id))));
      }
      const cachedAssignment = (id) => assignments.find((a) => a.id === id) || null;
      /** Question i of an assignment run (run = { assignmentId, activities }), from the cache only. */
      function decideAssignmentFor(run, i) {
        const a = cachedAssignment(run.assignmentId);
        const d = learningEngine.decideSlot({ assignment: a, index: i }, cacheView(run.activities), CFG);
        decisionLog.push({ assignmentId: run.assignmentId, missionIndex: i, decisionSource: d.decisionSource,
          activityId: d.activityId, difficulty: d.difficulty, decision: copy(d.decision) });
        if (decisionLog.length > 100) decisionLog = decisionLog.slice(-100);
        return d;
      }

      /** Test hook: forget the cache, the open session and the queue (resetSave). */
      function reset() {
        studentId = null;
        worlds = emptyWorlds();
        recent = [];
        session = null;
        queue.length = 0;
        dropped = 0;
        clearCache();
        decisionLog = [];
      }

      return {
        loadStudent, worldRecord, applyUnsaved, saveWorldResult, startSession, endSession, recordAttempt, flush, reset,
        decideSlotFor, recentExclude,
        /** N6: the run-time adaptation switch (config.adaptive.enabled at start; test mode may change it). */
        isAdaptive: () => adaptiveEnabled,
        setAdaptive(on) { adaptiveEnabled = on !== false; return adaptiveEnabled; },
        snapshot: (c) => copy(mastery[c] || null),
        recommendation: (c) => copy(recs[c] || null),
        latestDecision: (c) => copy(lastDecision[c] || null),
        activeOverrides: () => copy(overrides),
        openAssignments: () => copy(assignments),
        /** R3 (P5): the open Ninja Check runs (copies), the live cached record of one, and baselineDone. */
        openChecks: () => copy(checks),
        openCheck: (runId) => checks.find((r) => r.id === runId) || null,
        noteCheck, baselineDone: () => baselineDone,
        /** R3 (P6): { count, totalMs } of the loaded student's attempts on an assignment (synchronous). */
        assignmentProgress: progressOf, homeAssignments, assignment: (id) => copy(cachedAssignment(id)), decideAssignmentFor,
        lastDecisions: () => copy(decisionLog),
        currentStudentId: () => studentId,
        currentSessionId: () => (session ? session.id : null),
        recentQuestions: () => recent.map((r) => Object.assign({}, r)),
        pendingWrites: () => queue.length,
        droppedWrites: () => dropped
      };
    }

    const app = create();
    return Object.assign({ create }, app);
  });
}());
