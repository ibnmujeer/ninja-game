/*
 * migrations (L3): IndexedDB upgrade steps and the v1 localStorage migration (DESIGN 9.4, 10).
 *
 * idbSteps = { 1: fn(db, tx) } creates every store and index of schema.STORES. repo passes it
 * to idbAdapter.open, so indexeddb.js never requires this file. A future step 2 is added here
 * together with a SCHEMA_VERSION bump.
 *
 * migrateV1({ repo, prefs, studentId, readV1?, now?, log? }) copies what v1 showed the child
 * (hero, sound, best stars, done) onto the default student. It never rejects and never writes,
 * renames or deletes the v1 key: it only reads it. Idempotent through a hash marker in
 * meta.v1Migration plus monotone merges (best = max, done = or). Returns a report whose
 * status is one of: absent, storage_unreadable, already_migrated, unreadable,
 * unsupported_version, migrated, merged_again, verify_failed, write_failed. On write_failed and
 * verify_failed the report also carries memoryOnly { heroId, worlds } (the validated v1 values,
 * which main.js shows for that session), and the first-run prefs copy runs on those paths too.
 */
(function () {
  'use strict';

  NBA.define('migrations', ['config', 'util', 'catalog', 'schema'], (config, util, catalog, schema) => {
    const { MISSIONS_PER_WORLD, STORAGE_KEY, SAVE_VERSION } = config;
    const { clamp, fnv1a32 } = util;
    const { WORLDS, heroById } = catalog;

    /** IndexedDB upgrade steps, run inside the single version-change transaction. */
    const idbSteps = {
      1(db) {
        schema.STORE_NAMES.forEach((name) => {
          const def = schema.STORES[name];
          const os = db.createObjectStore(name, { keyPath: def.keyPath });
          def.indexes.forEach((ix) => os.createIndex(ix[0], ix[1], { unique: false }));
        });
      }
    };

    /* ---------- v1 Store.validate, moved verbatim (v1 section 2) ---------- */
    function defaults() {
      const worlds = {};
      WORLDS.forEach((w) => { worlds[w.id] = { best: 0, done: false }; });
      return { v: SAVE_VERSION, heroId: null, sound: true, worlds: worlds };
    }

    /** Parse and clamp saved JSON. Anything odd falls back to its default. */
    function validateV1(raw) {
      const d = defaults();
      if (typeof raw !== 'string') return d;
      let p = null;
      try { p = JSON.parse(raw); } catch (e) { return d; }
      if (!p || typeof p !== 'object' || p.v !== SAVE_VERSION) return d;
      if (typeof p.heroId === 'string' && heroById(p.heroId)) d.heroId = p.heroId;
      if (typeof p.sound === 'boolean') d.sound = p.sound;
      const saved = (p.worlds && typeof p.worlds === 'object') ? p.worlds : {};
      WORLDS.forEach((w) => {
        const x = saved[w.id];
        if (!x || typeof x !== 'object') return;
        d.worlds[w.id] = {
          best: clamp(Math.round(Number(x.best)) || 0, 0, MISSIONS_PER_WORLD),
          done: x.done === true
        };
      });
      return d;
    }

    /** Per-field report for a parsed v1 object: migrated | invalid-defaulted | absent, plus ignored keys. */
    function fieldReport(p, v) {
      const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
      const fields = {
        heroId: !has(p, 'heroId') ? 'absent' : (v.heroId !== null ? 'migrated' : 'invalid-defaulted'),
        sound: !has(p, 'sound') ? 'absent' : (typeof p.sound === 'boolean' ? 'migrated' : 'invalid-defaulted')
      };
      const saved = (p.worlds && typeof p.worlds === 'object') ? p.worlds : {};
      WORLDS.forEach((w) => {
        const x = saved[w.id];
        if (!has(saved, w.id)) { fields['worlds.' + w.id] = 'absent'; return; }
        const doneOk = !!x && typeof x === 'object' && (x.done === undefined || typeof x.done === 'boolean');
        const n = x && typeof x === 'object' ? Number(x.best) : NaN;
        // P2-N1 (P6): a numeric best moved into range (2.6 -> 3, 12.4 -> 8, -4 -> 0) was migrated as "clamped"
        if (doneOk && n === v.worlds[w.id].best) fields['worlds.' + w.id] = 'migrated';
        else if (doneOk && typeof x.best === 'number' && Number.isFinite(n)) fields['worlds.' + w.id] = 'clamped';
        else fields['worlds.' + w.id] = 'invalid-defaulted';
      });
      const ignoredKeys = Object.keys(p).filter((k) => ['v', 'heroId', 'sound', 'worlds'].indexOf(k) < 0)
        .concat(Object.keys(saved).filter((k) => !WORLDS.some((w) => w.id === k)).map((k) => 'worlds.' + k));
      return { fields: fields, ignoredKeys: ignoredKeys };
    }

    function defaultReadV1() { return window.localStorage.getItem(STORAGE_KEY); }

    const defaultLog = {
      info(m) { try { console.info(m); } catch (e) { /* ignore */ } },
      error(m) { try { console.error(m); } catch (e) { /* ignore */ } }
    };

    /** The merged worldProgress record, or null when nothing changes (DESIGN 10.2 step 6). */
    function mergeWorld(existing, v1w, studentId, worldId, now) {
      const old = existing || { best: 0, done: false };
      const best = Math.max(old.best, v1w.best);
      const done = old.done || v1w.done;
      const raised = best > old.best || (done && !old.done);
      if (!raised) return null;
      return { studentId: studentId, worldId: worldId, best: best, done: done, updatedAt: now, source: 'v1-migration' };
    }

    async function migrateV1(args) {
      const a = args || {};
      const repo = a.repo, prefs = a.prefs, studentId = a.studentId;
      const log = a.log || defaultLog;
      const now = typeof a.now === 'function' ? a.now : () => Date.now();
      const report = { status: null, sourceHash: null, studentId: studentId, fields: {}, ignoredKeys: [], prefsCopied: false, at: now() };
      const done = (status, extra) => Object.assign(report, { status: status }, extra || {});

      // 1. Detect (read-only; the v1 key is never written).
      let raw;
      try { raw = (a.readV1 || defaultReadV1)(); } catch (e) {
        log.info('[NBA] v1 save could not be read (storage_unreadable); playing with V2 data');
        return done('storage_unreadable');
      }
      if (raw === null || raw === undefined) return done('absent');
      raw = String(raw);
      // 2. Fingerprint.
      report.sourceHash = fnv1a32(raw);
      // 3. Idempotency check.
      let marker;
      try { marker = await repo.get('meta', 'v1Migration'); } catch (e) { marker = undefined; }
      const again = !!(marker && marker.status === 'done');
      if (again && marker.sourceHash === report.sourceHash) return done('already_migrated');

      const writeFailedMarker = async (reason) => {
        try {
          await repo.put('meta', { key: 'v1Migration', status: 'failed', sourceHash: report.sourceHash, migratedAt: null,
            studentId: studentId || null, report: { status: reason, at: report.at } });
        } catch (e) { /* the report still says what happened */ }
      };
      // 4. Parse.
      let p;
      try { p = JSON.parse(raw); } catch (e) {
        log.info('[NBA] v1 save is not valid JSON (unreadable); it is kept unchanged');
        await writeFailedMarker('unreadable');
        return done('unreadable');
      }
      if (!p || typeof p !== 'object' || Array.isArray(p) || p.v !== SAVE_VERSION) {
        log.info('[NBA] v1 save has an unsupported version; it is kept unchanged');
        await writeFailedMarker('unsupported_version');
        return done('unsupported_version');
      }
      // 5. Validate with v1's own rules.
      const v = validateV1(raw);
      Object.assign(report, fieldReport(p, v));

      // 8. Preferences: only on the first V2 run (no v2 prefs key before this boot). Runs on every
      // path from here on, whatever the batch outcome, so v1 sound=off is never lost (review P2-M1).
      const copyPrefs = () => {
        if (prefs && typeof prefs.existedAtBoot === 'function' && !prefs.existedAtBoot()) {
          prefs.set('sound', v.sound);
          prefs.set('lastHeroId', v.heroId);
          report.prefsCopied = true;
        }
      };
      // When the write fails, main.js shows these validated v1 values for this session only
      // (cache and current student, nothing written); the next start retries the migration.
      const failed = (status) => {
        copyPrefs();
        report.memoryOnly = { heroId: v.heroId, worlds: JSON.parse(JSON.stringify(v.worlds)) };
        return done(status);
      };

      // 6. Merge in one batch.
      let student, existing;
      try {
        student = await repo.get('students', studentId);
        existing = await repo.getAll('worldProgress', { index: 'studentId', value: studentId });
      } catch (e) {
        log.error('[NBA] v1 migration could not read V2 data (write_failed): ' + (e && e.message));
        return failed('write_failed');
      }
      if (!student) {
        log.error('[NBA] v1 migration: no default student ' + studentId + ' (write_failed)');
        return failed('write_failed');
      }
      const t = now();
      const byWorld = {};
      existing.forEach((r) => { byWorld[r.worldId] = r; });
      const ops = [];
      const expected = {};
      const nextStudent = Object.assign({}, student);
      if (!student.heroId && v.heroId) { nextStudent.heroId = v.heroId; nextStudent.updatedAt = t; ops.push({ op: 'put', store: 'students', value: nextStudent }); }
      WORLDS.forEach((w) => {
        const merged = mergeWorld(byWorld[w.id], v.worlds[w.id], studentId, w.id, t);
        const base = byWorld[w.id] || { best: 0, done: false };
        expected[w.id] = merged ? { best: merged.best, done: merged.done } : { best: base.best, done: base.done };
        if (merged) ops.push({ op: 'put', store: 'worldProgress', value: merged });
      });
      const finalStatus = again ? 'merged_again' : 'migrated';
      const markerReport = { status: finalStatus, fields: report.fields, ignoredKeys: report.ignoredKeys, at: t };
      ops.push({ op: 'put', store: 'meta', value: { key: 'v1Migration', status: 'done', sourceHash: report.sourceHash, migratedAt: t, studentId: studentId, report: markerReport } });
      try {
        await repo.batch(ops);
      } catch (e) {
        log.error('[NBA] v1 migration write failed (write_failed); the v1 save is kept and the next start retries: ' + (e && e.message));
        report.heroId = nextStudent.heroId || null;
        return failed('write_failed');
      }
      // 7. Verify by reading back.
      let ok = false;
      try {
        const s2 = await repo.get('students', studentId);
        const rows = await repo.getAll('worldProgress', { index: 'studentId', value: studentId });
        const got = {};
        rows.forEach((r) => { got[r.worldId] = { best: r.best, done: r.done }; });
        ok = !!s2 && s2.heroId === nextStudent.heroId &&
          WORLDS.every((w) => { const g = got[w.id] || { best: 0, done: false }; return g.best === expected[w.id].best && g.done === expected[w.id].done; });
      } catch (e) { ok = false; }
      report.heroId = nextStudent.heroId || null;
      if (!ok) {
        log.error('[NBA] v1 migration read-back did not match (verify_failed); the next start retries');
        await writeFailedMarker('verify_failed');
        return failed('verify_failed');
      }
      copyPrefs();
      return done(finalStatus);
    }

    return { idbSteps, validateV1, fieldReport, migrateV1, V1_KEY: STORAGE_KEY };
  });
}());
