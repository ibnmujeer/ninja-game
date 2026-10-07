/*
 * roster (L4): classes, students and the automatic default player (DESIGN 9.3, 17.2, D4, D10).
 *
 * The default player is found by its isDefault flag, never by its name. It is created once
 * ("Player 1"; the teacher can rename it), so every attempt has a studentId even with no
 * teacher setup at all.
 *
 * P6 (17.2), every change one batch: class create/rename/archive (its active students are archived
 * with archivedWithClass)/restore/delete (archived classes only; students and their data are kept
 * and moved to "No class"; whole-class assignments list those students); student create (extra ops,
 * for example a pending baseline, join the same batch: P5-N2)/update/archive/restore/delete (one
 * cascading batch over every store with that studentId, exact counts from countStudentData).
 * An assignment that would list nobody after a delete is closed with no class and no students; it
 * never becomes a whole-class assignment (review P6-2).
 * Validation returns [{ field, code }]; nothing is written while there is a problem.
 * ensurePlayer(currentId): the last-active fallback (17.1, 17.2): the game always has a player.
 *
 * create({ repo, now? }) makes an independent roster (tests); the module itself is the app's.
 */
(function () {
  'use strict';

  NBA.define('roster', ['util', 'repo'], (util, appRepo) => {
    const DEFAULT_NAME = 'Player 1';
    // eslint-disable-next-line no-control-regex
    const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
    const LOCAL_ID = /^[A-Za-z0-9 _-]{0,20}$/;
    /** Stores whose records belong to one student (the cascade delete covers each). */
    const STUDENT_STORES = ['worldProgress', 'sessions', 'attempts', 'mastery', 'recommendations', 'overrides', 'assessments'];

    function create(options) {
      const o = options || {};
      const repo = o.repo || appRepo;
      const now = typeof o.now === 'function' ? o.now : () => util.now();
      let ensuring = null;

      function newStudent(fields) {
        const t = now();
        return Object.assign({
          id: util.newId('stu', t), name: DEFAULT_NAME, classId: null, status: 'active', isDefault: false,
          heroId: null, baselineRequired: false, archivedWithClass: null, createdAt: t, updatedAt: t
        }, fields || {});
      }

      const byAge = (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
      const byName = (a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()) || byAge(a, b);

      /**
       * The default student (isDefault: true), created if missing. Idempotent: concurrent calls
       * share one promise, and an existing default is never replaced. If the read fails, an unsaved
       * default is returned and nothing is added (P2-L1); if the write fails, the new record is still
       * returned. Either way the game stays playable for this session.
       */
      function ensureDefaultStudent() {
        if (!ensuring) {
          ensuring = (async () => {
            let all;
            try { all = await repo.getAll('students'); } catch (e) { return newStudent({ isDefault: true }); }
            const found = all.filter((s) => s.isDefault === true).sort(byAge)[0];
            if (found) return found;
            const rec = newStudent({ isDefault: true });
            try { await repo.add('students', rec); } catch (e) { /* repo counts the failure; play goes on */ }
            return rec;
          })().finally(() => { ensuring = null; });
        }
        return ensuring;
      }

      function get(id) { return repo.get('students', id); }
      async function allStudents() { return ((await repo.getAll('students')) || []).sort(byName); }
      async function classes() { return ((await repo.getAll('classes')) || []).sort(byName); }

      /** Active students, oldest first. An archived student is never offered to the child. */
      async function activeStudents() {
        const all = await repo.getAll('students', { index: 'status', value: 'active' });
        return all.sort(byAge);
      }

      /** The last-used active student if there is one, otherwise the default student. */
      async function chooseStudent(lastStudentId, defaultStudent) {
        if (lastStudentId && lastStudentId !== defaultStudent.id) {
          try {
            const s = await repo.get('students', lastStudentId);
            if (s && s.status === 'active') return s;
          } catch (e) { /* fall back to the default */ }
        }
        return defaultStudent;
      }

      /** The "Who's playing?" picker is shown only with 2 or more active students (D4). */
      async function needsPlayerPicker() {
        try { return (await activeStudents()).length >= 2; } catch (e) { return false; }
      }

      /** Store the hero on the student record (resolves false when the write failed). */
      async function setHero(studentId, heroId) {
        try {
          const s = await repo.get('students', studentId);
          if (!s) return false;
          await repo.put('students', Object.assign({}, s, { heroId: heroId, updatedAt: now() }));
          return true;
        } catch (e) {
          return false;
        }
      }

      /**
       * 17.1/17.2 fallback: the current student when still active; else another active student (the
       * default first); with none active, the default is reactivated, or a new default is created.
       */
      async function ensurePlayer(currentId) {
        const all = (await repo.getAll('students')) || [];
        const cur = all.find((s) => s.id === currentId);
        if (cur && cur.status === 'active') return cur;
        const active = all.filter((s) => s.status === 'active').sort(byAge);
        if (active.length) return active.find((s) => s.isDefault) || active[0];
        const def = all.filter((s) => s.isDefault === true).sort(byAge)[0];
        if (def) {
          const back = Object.assign({}, def, { status: 'active', archivedWithClass: null, updatedAt: now() });
          await repo.put('students', back);
          return back;
        }
        return ensureDefaultStudent();
      }

      /* ---------- validation (17.2): [{ field, code }] ---------- */
      function textProblems(field, value, max) {
        if (typeof value !== 'string' || !value.trim()) return [{ field: field, code: 'required' }];
        if (CONTROL.test(value)) return [{ field: field, code: 'control_characters' }];
        if (value.trim().length > max) return [{ field: field, code: 'too_long', max: max }];
        return [];
      }
      async function classProblems(name, exceptId) {
        const out = textProblems('name', name, 40);
        if (out.length) return out;
        const key = name.trim().toLowerCase();
        const taken = (await classes()).some((c) => c.status === 'active' && c.id !== exceptId && c.name.trim().toLowerCase() === key);
        return taken ? [{ field: 'name', code: 'name_taken' }] : [];
      }
      async function studentProblems(f) {
        const out = textProblems('name', f.name, 30);
        if (f.localId !== undefined && f.localId !== null && !(typeof f.localId === 'string' && LOCAL_ID.test(f.localId.trim()))) {
          out.push({ field: 'localId', code: 'bad_local_id' });
        }
        if (f.classId) {
          const c = await repo.get('classes', f.classId);
          if (!c) out.push({ field: 'classId', code: 'unknown_class' });
        }
        return out;
      }

      /* ---------- classes ---------- */
      async function createClass(name) {
        const problems = await classProblems(name, null);
        if (problems.length) return { ok: false, problems };
        const t = now();
        const rec = { id: util.newId('cls', t), name: name.trim(), status: 'active', createdAt: t, updatedAt: t };
        await repo.put('classes', rec);
        return { ok: true, record: rec };
      }
      async function renameClass(id, name) {
        const c = await repo.get('classes', id);
        if (!c) return { ok: false, problems: [{ field: 'name', code: 'not_found' }] };
        const problems = await classProblems(name, id);
        if (problems.length) return { ok: false, problems };
        const rec = Object.assign({}, c, { name: name.trim(), updatedAt: now() });
        await repo.put('classes', rec);
        return { ok: true, record: rec };
      }
      async function studentsOf(classId) { return (await repo.getAll('students', { index: 'classId', value: classId })) || []; }

      /** What archiving, restoring or deleting a class touches (the dialogs state these counts). */
      async function classSummary(id) {
        const c = await repo.get('classes', id);
        if (!c) return null;
        const studs = await studentsOf(id);
        const asg = (await repo.getAll('assignments', { index: 'classId', value: id })) || [];
        return { record: c, students: studs.length, activeStudents: studs.filter((s) => s.status === 'active').length,
          archivedWithClass: studs.filter((s) => s.archivedWithClass === id).length, assignments: asg.length,
          closesAssignments: studs.length ? 0 : asg.filter((a) => a.status === 'open' && !(a.studentIds || []).length).length };
      }
      async function archiveClass(id) {
        const c = await repo.get('classes', id);
        if (!c || c.status !== 'active') return { ok: false, code: 'not_active' };
        const t = now();
        const studs = (await studentsOf(id)).filter((s) => s.status === 'active');
        const ops = [{ op: 'put', store: 'classes', value: Object.assign({}, c, { status: 'archived', updatedAt: t }) }]
          .concat(studs.map((s) => ({ op: 'put', store: 'students', value: Object.assign({}, s, { status: 'archived', archivedWithClass: id, updatedAt: t }) })));
        await repo.batch(ops);
        return { ok: true, students: studs.length };
      }
      async function restoreClass(id) {
        const c = await repo.get('classes', id);
        if (!c || c.status !== 'archived') return { ok: false, code: 'not_archived' };
        const t = now();
        const studs = (await studentsOf(id)).filter((s) => s.archivedWithClass === id);
        const ops = [{ op: 'put', store: 'classes', value: Object.assign({}, c, { status: 'active', updatedAt: t }) }]
          .concat(studs.map((s) => ({ op: 'put', store: 'students', value: Object.assign({}, s, { status: 'active', archivedWithClass: null, updatedAt: t }) })));
        await repo.batch(ops);
        return { ok: true, students: studs.length };
      }
      /** Archived classes only. Students and all their learning data are kept ("No class"). */
      async function deleteClass(id) {
        const c = await repo.get('classes', id);
        if (!c) return { ok: false, code: 'not_found' };
        if (c.status !== 'archived') return { ok: false, code: 'archive_first' };
        const t = now();
        const studs = await studentsOf(id);
        const asg = (await repo.getAll('assignments', { index: 'classId', value: id })) || [];
        // A whole-class assignment of a class with no students would list nobody: it is closed (review P6-2).
        const ids = (a) => ((a.studentIds || []).length ? a.studentIds.slice() : studs.map((s) => s.id));
        const ops = [{ op: 'delete', store: 'classes', key: id }]
          .concat(studs.map((s) => ({ op: 'put', store: 'students', value: Object.assign({}, s, { classId: null, archivedWithClass: null, updatedAt: t }) })))
          .concat(asg.map((a) => ({ op: 'put', store: 'assignments', value: Object.assign({}, a, { classId: null, studentIds: ids(a), updatedAt: t },
            ids(a).length ? {} : { status: 'closed' }) })));
        await repo.batch(ops);
        return { ok: true, students: studs.length, assignments: asg.length, closedAssignments: asg.filter((a) => a.status === 'open' && !ids(a).length).length };
      }

      /* ---------- students ---------- */
      function studentFields(f) {
        const out = {};
        if (f.name !== undefined) out.name = String(f.name).trim();
        if (f.localId !== undefined) out.localId = f.localId === null ? '' : String(f.localId).trim();
        if (f.classId !== undefined) out.classId = f.classId || null;
        if (f.baselineRequired !== undefined) out.baselineRequired = f.baselineRequired === true;
        return out;
      }
      /** extraOpsFor(studentId) -> ops (or a Promise of them) written in the SAME batch (P5-N2). */
      async function createStudent(fields, extraOpsFor) {
        const f = fields || {};
        const problems = await studentProblems(f);
        if (problems.length) return { ok: false, problems };
        const rec = newStudent(studentFields(Object.assign({ localId: '', classId: null, baselineRequired: false }, f)));
        const extra = typeof extraOpsFor === 'function' ? (await extraOpsFor(rec.id, rec)) || [] : [];
        await repo.batch([{ op: 'put', store: 'students', value: rec }].concat(extra));
        return { ok: true, record: rec };
      }
      async function updateStudent(id, fields, extraOpsFor) {
        const s = await repo.get('students', id);
        if (!s) return { ok: false, problems: [{ field: 'name', code: 'not_found' }] };
        const f = Object.assign({ name: s.name }, fields || {});
        const problems = await studentProblems(f);
        if (problems.length) return { ok: false, problems };
        const rec = Object.assign({}, s, studentFields(f), { updatedAt: now() });
        const extra = typeof extraOpsFor === 'function' ? (await extraOpsFor(id, rec, s)) || [] : [];
        await repo.batch([{ op: 'put', store: 'students', value: rec }].concat(extra));
        return { ok: true, record: rec };
      }
      async function setStudentStatus(id, status) {
        const s = await repo.get('students', id);
        if (!s) return { ok: false, code: 'not_found' };
        const rec = Object.assign({}, s, { status: status, archivedWithClass: null, updatedAt: now() });
        await repo.put('students', rec);
        return { ok: true, record: rec };
      }
      const archiveStudent = (id) => setStudentStatus(id, 'archived');
      const restoreStudent = (id) => setStudentStatus(id, 'active');

      async function studentRecords(id) {
        const out = {};
        for (const store of STUDENT_STORES) out[store] = (await repo.getAll(store, { index: 'studentId', value: id })) || [];
        return out;
      }
      /** The exact counts the delete dialog states (17.2); closesAssignments: open ones listing only this student. */
      async function countStudentData(id) {
        const r = await studentRecords(id);
        const asg = ((await repo.getAll('assignments')) || []).filter((a) => a.status === 'open' && (a.studentIds || []).length === 1 && a.studentIds[0] === id);
        return { answers: r.attempts.length, sessions: r.sessions.length, checks: r.assessments.length, overrides: r.overrides.length,
          worlds: r.worldProgress.filter((w) => w.best > 0 || w.done).length, worldRecords: r.worldProgress.length,
          mastery: r.mastery.length, recommendations: r.recommendations.length, closesAssignments: asg.length };
      }
      /** Irreversible: ONE batch deletes the student and every record with that studentId (17.2). */
      async function deleteStudent(id) {
        const s = await repo.get('students', id);
        if (!s) return { ok: false, code: 'not_found' };
        const r = await studentRecords(id);
        const keys = { worldProgress: (x) => [x.studentId, x.worldId], mastery: (x) => [x.studentId, x.conceptId],
          recommendations: (x) => [x.studentId, x.conceptId] };
        const ops = [{ op: 'delete', store: 'students', key: id }];
        STUDENT_STORES.forEach((store) => r[store].forEach((x) => ops.push({ op: 'delete', store: store, key: keys[store] ? keys[store](x) : x.id })));
        // The id leaves each assignment's studentIds. When nobody would be left, the assignment is closed
        // with classId null and no students instead: an empty list with a class means the whole class,
        // so a listed assignment never widens (review P6-2).
        const t = now();
        let closed = 0;
        ((await repo.getAll('assignments')) || []).filter((a) => (a.studentIds || []).indexOf(id) >= 0).forEach((a) => {
          const left = a.studentIds.filter((x) => x !== id);
          if (!left.length && a.status === 'open') closed++;
          ops.push({ op: 'put', store: 'assignments', value: Object.assign({}, a, left.length ? { studentIds: left, updatedAt: t }
            : { studentIds: [], classId: null, status: 'closed', updatedAt: t }) });
        });
        await repo.batch(ops);
        const counts = {};
        STUDENT_STORES.forEach((store) => { counts[store] = r[store].length; });
        return { ok: true, counts: counts, closedAssignments: closed };
      }

      return {
        ensureDefaultStudent, get, allStudents, classes, activeStudents, chooseStudent, needsPlayerPicker, setHero, newStudent, ensurePlayer,
        createClass, renameClass, classSummary, archiveClass, restoreClass, deleteClass, studentsOf,
        createStudent, updateStudent, archiveStudent, restoreStudent, countStudentData, deleteStudent,
        DEFAULT_NAME, STUDENT_STORES
      };
    }

    const app = create();
    return Object.assign({ create }, app);
  });
}());
