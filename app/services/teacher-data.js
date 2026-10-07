/*
 * teacherData (L4): the teacher's overrides (DESIGN 17.4, 14.8) and assignments (17.6), validated
 * with learningEngine.validateOverride / validateAssignment (schema.validate checks them again).
 * Split from learning-service only to keep files short; nothing here reads the child's cache, which
 * gameUI.returnFromTeacher reloads when the teacher goes back to the game.
 *
 *   saveOverride(sid, fields)  one batch: the new override plus every conflicting active one ended
 *                              (same family; mixed ends addition and subtraction, and the reverse).
 *                              Overrides live in their own store: no recommendation is ever touched.
 *   endOverride(id), overridesToEndFor(sid, conceptId) (the form lists them before Save)
 *   createAssignment(fields), updateAssignment(id, fields) (once progress exists only name, dueDate
 *   and status change), closeAssignment(id), assignmentAttemptCount(id)
 *   Every write resolves { ok: true, record, ... } or { ok: false, problems: [{ field, code }] }.
 * create({ repo, now?, newId? }) makes an independent service (tests); the module itself is the app's.
 */
(function () {
  'use strict';

  NBA.define('teacherData', ['util', 'repo', 'learningEngine'], (util, appRepo, learningEngine) => {
    const LOCKED = ['classId', 'studentIds', 'conceptIds', 'activityIds', 'difficulty', 'representation', 'questionCount', 'targetMinutes'];
    const norm = (v) => (v === undefined || v === null || v === '' || v === 'auto' ? null : v);

    function create(options) {
      const o = options || {};
      const repo = o.repo || appRepo;
      const now = typeof o.now === 'function' ? o.now : () => util.now();
      const newId = typeof o.newId === 'function' ? o.newId : (p) => util.newId(p, now());

      async function activeOverridesOf(sid) {
        return ((await repo.getAll('overrides', { index: 'studentId', value: sid })) || []).filter((r) => r.status === 'active');
      }
      async function overridesToEndFor(sid, conceptId) {
        return learningEngine.overridesToEnd({ studentId: sid, conceptId: conceptId, id: null }, await activeOverridesOf(sid));
      }
      async function saveOverride(sid, fields) {
        const f = fields || {};
        const t = now();
        const rec = { id: newId('ovr'), studentId: sid, conceptId: f.conceptId, status: 'active', createdAt: t,
          difficulty: norm(f.difficulty) === null ? null : Number(f.difficulty), representation: norm(f.representation), activityId: norm(f.activityId) };
        if (typeof f.note === 'string' && f.note.trim()) rec.note = f.note.trim().slice(0, 200);
        const problems = learningEngine.validateOverride(rec);
        if (problems.length) return { ok: false, problems: problems };
        const ended = learningEngine.overridesToEnd(rec, await activeOverridesOf(sid)).map((x) => Object.assign({}, x, { status: 'ended', endedAt: t }));
        await repo.batch([{ op: 'put', store: 'overrides', value: rec }].concat(ended.map((x) => ({ op: 'put', store: 'overrides', value: x }))));
        return { ok: true, record: rec, ended: ended.map((x) => x.id) };
      }
      async function endOverride(overrideId) {
        const x = await repo.get('overrides', overrideId);
        if (!x || x.status !== 'active') return { ok: false, code: 'not_active' };
        const rec = Object.assign({}, x, { status: 'ended', endedAt: now() });
        await repo.put('overrides', rec);
        return { ok: true, record: rec };
      }

      function assignmentRecord(f, base) {
        const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
        const d = norm(f.difficulty);
        return Object.assign({}, base, {
          name: typeof f.name === 'string' ? f.name.trim() : f.name,
          classId: f.classId || null, studentIds: Array.isArray(f.studentIds) ? f.studentIds.slice() : [],
          conceptIds: Array.isArray(f.conceptIds) ? f.conceptIds.slice() : [], activityIds: Array.isArray(f.activityIds) ? f.activityIds.slice() : [],
          difficulty: d === null ? 'auto' : Number(d), representation: norm(f.representation) || 'auto',
          questionCount: num(f.questionCount), targetMinutes: num(f.targetMinutes), dueDate: f.dueDate || null
        });
      }
      /** Attempts already recorded for an assignment (any student): once there are some, most fields lock. */
      async function assignmentAttemptCount(id) { return ((await repo.getAll('attempts', { index: 'assignmentId', value: id })) || []).length; }
      async function createAssignment(fields) {
        const t = now();
        const rec = assignmentRecord(fields || {}, { id: newId('asg'), status: 'open', createdAt: t, updatedAt: t });
        const problems = learningEngine.validateAssignment(rec, { now: t, creating: true });
        if (problems.length) return { ok: false, problems: problems };
        await repo.put('assignments', rec);
        return { ok: true, record: rec };
      }
      async function updateAssignment(id, fields) {
        const old = await repo.get('assignments', id);
        if (!old) return { ok: false, problems: [{ field: 'name', code: 'not_found' }] };
        const started = (await assignmentAttemptCount(id)) > 0;
        let rec = assignmentRecord(Object.assign({}, old, fields || {}), { id: id, status: old.status, createdAt: old.createdAt, updatedAt: now() });
        if (started) LOCKED.forEach((k) => { rec[k] = old[k]; });
        if (fields && (fields.status === 'open' || fields.status === 'closed')) rec.status = fields.status;
        rec = JSON.parse(JSON.stringify(rec));
        const problems = learningEngine.validateAssignment(rec, { now: now(), creating: false });
        if (problems.length) return { ok: false, problems: problems, locked: started };
        await repo.put('assignments', rec);
        return { ok: true, record: rec, locked: started };
      }
      const closeAssignment = (id) => updateAssignment(id, { status: 'closed' });

      return { saveOverride, endOverride, overridesToEndFor, createAssignment, updateAssignment, closeAssignment, assignmentAttemptCount };
    }

    const app = create();
    return Object.assign({ create }, app);
  });
}());
