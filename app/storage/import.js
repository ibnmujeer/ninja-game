/*
 * importer (L3): the JSON import pipeline of DESIGN 18.4 (D10: validate, plan, confirm; nothing is
 * overwritten silently and nothing changes before the teacher confirms).
 *
 *   read(file)               FileReader.readAsText; too_large above config.import.maxBytes
 *   validate(text, current)  parse (JSON.parse only: not_json), envelope (not_an_export, newer_schema,
 *                            upgraders for older versions, checksum_mismatch), every record through
 *                            schema.validate (invalid_records, the first 50 problems; too_many_records),
 *                            references (dangling_reference). -> { ok, bundle } | rejection
 *   isEmpty(current)         the exact empty-database definition of 18.4 step 7
 *   analyze(bundle, current) pure: per record add | same | merge (worldProgress: best = max, done = or)
 *                            | conflict; meta "skipped (device settings)"; mastery and recommendations
 *                            are never written from the file (rebuilt from answers); an attempts
 *                            conflict always keeps the device copy (N12)
 *   planOps(plan, choice, now)  the one batch for choice 'keep' | 'file': adds, merges, the file's
 *                            version of the listed conflicts only with 'file', a second default
 *                            player set to isDefault false, N14 (newest active override per student
 *                            and family, newest open run per form; the rest ended or cancelled),
 *                            mastery and recommendations rebuilt for the affected students, and
 *                            meta.lastImport (N12). Pure.
 *   apply(plan, choice)      re-reads the device and repeats the step 5 reference check (a record the
 *                            file relies on may have been deleted: dangling_reference, nothing written);
 *                            if the device changed since the plan, nothing is written and a new plan
 *                            is returned; otherwise ONE repo.batch (all or nothing)
 * Rejections are user-file problems: shown on screen, never logged as console errors.
 * create({ repo?, now? }) makes an independent importer (tests); the module itself is the app's.
 */
(function () {
  'use strict';

  NBA.define('importer', ['config', 'util', 'catalog', 'schema', 'masteryEngine', 'learningEngine', 'exporter', 'repo'],
    (config, util, catalog, schema, masteryEngine, learningEngine, exporter, appRepo) => {
      const CFG = { mastery: config.mastery, adaptive: config.adaptive, error: config.error };
      /** Stores the file may write; mastery and recommendations are rebuilt; meta is never imported. */
      const WRITTEN = ['classes', 'students', 'worldProgress', 'sessions', 'attempts', 'overrides', 'assignments', 'assessments'];
      const CACHES = ['mastery', 'recommendations'];
      const NOT_EMPTY_STORES = ['classes', 'sessions', 'attempts', 'assessments', 'assignments', 'overrides'];
      const OPEN_RUN = ['pending', 'in_progress'];
      const TYPE = {
        meta: 'Device setting', classes: 'Class', students: 'Student', worldProgress: 'World progress', sessions: 'Session',
        attempts: 'Answer', mastery: 'Concept summary', recommendations: 'Suggestion', overrides: 'Override',
        assignments: 'Assignment', assessments: 'Ninja Check'
      };
      const MESSAGES = {
        too_large: 'The file is too big to import (more than ' + Math.round(config.import.maxBytes / 1048576) + ' MB). Nothing was imported.',
        read_failed: 'The file could not be read. Nothing was imported.',
        not_json: 'This file is not a Ninja Brick Academy export (it is not valid JSON). Nothing was imported.',
        not_an_export: 'This file is not a Ninja Brick Academy export. Nothing was imported.',
        newer_schema: 'This file comes from a newer version of the app. Nothing was imported.',
        checksum_mismatch: 'The file seems damaged or was changed after export. Nothing was imported.',
        too_many_records: 'The file holds more than ' + config.import.maxRecords.toLocaleString('en-GB') + ' records. Nothing was imported.',
        invalid_records: 'Some records in the file are not valid, so nothing was imported.',
        dangling_reference: 'Some records belong to a student or class that is neither in the file nor on this device. Nothing was imported.'
      };
      /** importer.upgraders[v](bundle) -> the bundle at version v + 1. There are none yet (SCHEMA_VERSION 1). */
      const upgraders = {};

      const listOf = (data, store) => (data && Array.isArray(data[store]) ? data[store] : []);
      const keyStr = (store, r) => JSON.stringify(schema.keyOf(store, r));
      const copy = (x) => JSON.parse(JSON.stringify(x));
      const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
      const cmpStr = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
      const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

      function reject(code, problems) {
        return { ok: false, code: code, message: MESSAGES[code] || code, problems: problems || [] };
      }

      /** Deep equality of JSON values, whatever the key order. */
      function same(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
        const ka = Object.keys(a), kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => own(b, k) && same(a[k], b[k]));
      }

      /* ---------- steps 1 to 5: read, parse, envelope, records, references ---------- */
      function read(file) {
        return new Promise((resolve) => {
          if (!file || typeof file.size !== 'number') { resolve(reject('read_failed')); return; }
          if (file.size > config.import.maxBytes) { resolve(reject('too_large')); return; }
          let r;
          try { r = new FileReader(); } catch (e) { resolve(reject('read_failed')); return; }
          r.onload = () => resolve({ ok: true, text: String(r.result) });
          r.onerror = () => resolve(reject('read_failed'));
          try { r.readAsText(file); } catch (e) { resolve(reject('read_failed')); }
        });
      }

      function parse(text) {
        if (typeof text !== 'string') return reject('not_json');
        if (text.length > config.import.maxBytes) return reject('too_large');
        try { return { ok: true, value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) }; } catch (e) { return reject('not_json'); }
      }

      function envelope(b) {
        if (!isPlain(b) || b.format !== exporter.FORMAT) return reject('not_an_export', ['format: not nba-export']);
        if (typeof b.schemaVersion !== 'number' || !Number.isInteger(b.schemaVersion) || b.schemaVersion < 1) {
          return reject('not_an_export', ['schemaVersion: not a whole number from 1']);
        }
        if (b.schemaVersion > schema.SCHEMA_VERSION) return reject('newer_schema', ['schemaVersion ' + b.schemaVersion + ' > ' + schema.SCHEMA_VERSION]);
        if (!isPlain(b.data)) return reject('not_an_export', ['data: not an object']);
        if (typeof b.appVersion !== 'string' || typeof b.exportedAt !== 'string') return reject('not_an_export', ['appVersion or exportedAt missing']);
        if (typeof b.checksum !== 'string' || b.checksum !== util.fnv1a32(JSON.stringify(b.data))) return reject('checksum_mismatch');
        if (isPlain(b.counts) && Object.keys(b.counts).some((s) => Array.isArray(b.data[s]) && b.counts[s] !== b.data[s].length)) {
          return reject('checksum_mismatch', ['counts differ from the records']);
        }
        let out = b;
        for (let v = b.schemaVersion; v < schema.SCHEMA_VERSION; v++) {
          if (typeof upgraders[v] !== 'function') return reject('not_an_export', ['no upgrade from schema version ' + v]);
          out = upgraders[v](out);
        }
        return { ok: true, bundle: out };
      }

      /** 'store #index field: problem' (DESIGN 18.4 step 4). */
      function problemText(store, i, p) {
        const m = /^(unknown_field|missing_field|forbidden_key|not_json|too_deep):(.*)$/.exec(p);
        if (m) return store + ' #' + i + ' ' + m[2] + ': ' + m[1];
        const j = p.indexOf(':');
        return j > 0 ? store + ' #' + i + ' ' + p.slice(0, j) + ': ' + p.slice(j + 1) : store + ' #' + i + ': ' + p;
      }

      function records(b) {
        const stores = Object.keys(b.data);
        const unknown = stores.filter((s) => !own(schema.STORES, s) || !Array.isArray(b.data[s]));
        if (unknown.length) return reject('invalid_records', unknown.map((s) => 'data.' + s + ': ' + (own(schema.STORES, s) ? 'not_a_list' : 'unknown_store')));
        const total = stores.reduce((n, s) => n + b.data[s].length, 0);
        if (total > config.import.maxRecords) return reject('too_many_records');
        const problems = [];
        let count = 0;
        stores.forEach((s) => {
          const seen = new Set();
          b.data[s].forEach((r, i) => {
            const ps = schema.validate(s, r);
            if (!ps.length) {
              const k = keyStr(s, r);
              if (seen.has(k)) ps.push('key:duplicate_in_file');
              seen.add(k);
            }
            count += ps.length;
            ps.forEach((p) => { if (problems.length < config.import.problemsShown) problems.push(problemText(s, i, p)); });
          });
        });
        return count ? Object.assign(reject('invalid_records', problems), { problemCount: count }) : { ok: true };
      }

      function references(b, current) {
        const list = exporter.references(b.data, current);
        if (!list.length) return { ok: true };
        return Object.assign(reject('dangling_reference', list.slice(0, config.import.problemsShown)
          .map((p) => p.store + ' #' + p.index + ' ' + p.field + ': ' + p.value + ' is not in the file or on this device')), { problemCount: list.length });
      }

      /** Steps 2 to 5 on the file's text. -> { ok: true, bundle, sourceSchemaVersion } | rejection */
      function validate(text, current) {
        const p = parse(text);
        if (!p.ok) return p;
        const e = envelope(p.value);
        if (!e.ok) return e;
        const r = records(e.bundle);
        if (!r.ok) return r;
        const f = references(e.bundle, current);
        if (!f.ok) return f;
        return { ok: true, bundle: e.bundle, sourceSchemaVersion: p.value.schemaVersion };
      }

      /* ---------- steps 6 and 7: the plan ---------- */
      /** 18.4 step 7: no classes, sessions, answers, checks, assignments or overrides, and only an untouched default player. */
      function isEmpty(current) {
        if (NOT_EMPTY_STORES.some((s) => listOf(current, s).length > 0)) return false;
        if (!listOf(current, 'students').every((s) => s.isDefault === true && (s.heroId === null || s.heroId === undefined))) return false;
        return !listOf(current, 'worldProgress').some((w) => w.best > 0 || w.done === true);
      }

      const nameOf = (r) => (r && typeof r.name === 'string' ? r.name : null);

      /** Pure: classify every record of the file against the device (18.4 step 6). */
      function analyze(bundle, current, sourceSchemaVersion) {
        const mode = isEmpty(current) ? 'empty' : 'merge';
        const rows = [], adds = [], merges = [], conflicts = [], deletes = [];
        schema.STORE_NAMES.forEach((store) => {
          const file = listOf(bundle.data, store);
          const row = { store: store, type: TYPE[store], inFile: file.length, add: 0, same: 0, merge: 0, conflict: 0, skipped: 0, rebuilt: 0 };
          rows.push(row);
          if (store === 'meta') { row.skipped = file.length; return; } // "skipped (device settings)"
          if (CACHES.indexOf(store) >= 0) { row.rebuilt = file.length; return; } // rebuilt from answers
          const device = new Map();
          if (mode === 'merge') listOf(current, store).forEach((r) => device.set(keyStr(store, r), r));
          file.forEach((r) => {
            const k = keyStr(store, r);
            const d = device.get(k);
            if (!d) { row.add++; adds.push({ store: store, key: k, value: r }); return; }
            if (same(d, r)) { row.same++; return; }
            if (store === 'worldProgress') {
              const best = Math.max(d.best, r.best), done = d.done || r.done;
              if (best === d.best && done === d.done) { row.same++; return; } // the device already has as much
              row.merge++;
              merges.push({ store: store, key: k, value: Object.assign({}, d, { best: best, done: done, source: 'import' }) });
              return;
            }
            row.conflict++;
            const attempts = store === 'attempts';
            conflicts.push({ store: store, key: k, type: TYPE[store], name: nameOf(d) || nameOf(r), value: r, keepsDevice: attempts,
              note: attempts ? 'kept (answers never change)' : null });
          });
        });
        // Empty mode: the batch replaces the untouched default player and its empty records.
        if (mode === 'empty') {
          ['students', 'worldProgress', 'mastery', 'recommendations'].forEach((s) => listOf(current, s).forEach((r) => deletes.push({ store: s, key: schema.keyOf(s, r) })));
        }
        return {
          mode: mode, rows: rows, adds: adds, merges: merges, conflicts: conflicts, deletes: deletes,
          choosable: conflicts.filter((c) => !c.keepsDevice).length,
          source: { schemaVersion: sourceSchemaVersion || bundle.schemaVersion, appVersion: bundle.appVersion, exportedAt: bundle.exportedAt,
            origin: typeof bundle.sourceOrigin === 'string' ? bundle.sourceOrigin : '', scope: bundle.scope, counts: bundle.counts || {} },
          bundle: bundle, current: current
        };
      }

      const byNewest = (a, b) => (b.createdAt - a.createdAt) || cmpStr(b.id, a.id);
      const byOldest = (a, b) => (a.createdAt - b.createdAt) || cmpStr(a.id, b.id);
      const conceptName = (id) => { const c = catalog.conceptById(id); return c ? c.name : id; };
      const FORM = { baseline: 'baseline', post: 'post' };

      /**
       * Pure: the one batch for choice 'keep' (preset) or 'file' (the file's version of the listed
       * conflicts; answers are always kept as on the device). -> { ops, notes, imported, alreadyHere, keptDevice, rebuilt }
       */
      function planOps(plan, choice, now) {
        const useFile = plan.mode === 'merge' && choice === 'file';
        const device = (store) => (plan.mode === 'empty' ? [] : listOf(plan.current, store));
        const final = new Map(); // 'store|key' -> { store, value }: every record the batch writes
        const write = (store, key, value) => final.set(store + '|' + key, { store: store, value: value });
        const imported = {};
        const count = (store) => { imported[store] = (imported[store] || 0) + 1; };
        WRITTEN.forEach((s) => { imported[s] = 0; });
        plan.adds.forEach((a) => { write(a.store, a.key, copy(a.value)); count(a.store); });
        plan.merges.forEach((m) => { write(m.store, m.key, Object.assign(copy(m.value), { updatedAt: now })); count(m.store); });
        if (useFile) plan.conflicts.filter((c) => !c.keepsDevice).forEach((c) => { write(c.store, c.key, copy(c.value)); count(c.store); });
        /** The records of a store after the batch (device copies overlaid with the writes so far). */
        const after = (store) => {
          const m = new Map();
          device(store).forEach((r) => m.set(store + '|' + keyStr(store, r), r));
          final.forEach((w, k) => { if (w.store === store) m.set(k, w.value); });
          return m;
        };
        const touched = new Set(); // the students the file writes for
        final.forEach((w) => { touched.add(w.store === 'students' ? w.value.id : w.value.studentId); });
        touched.delete(undefined);
        const students = after('students');
        const studentName = (id) => { const s = students.get('students|' + JSON.stringify(id)); return s ? s.name : id; };
        const notes = [];

        // One default player: the device's own stays; another one from the file becomes an ordinary player.
        const defaults = Array.from(students.entries()).filter((e) => e[1].isDefault === true);
        if (defaults.length > 1) {
          const ownIds = device('students').filter((s) => s.isDefault === true).map((s) => s.id);
          const keep = defaults.find((e) => ownIds.indexOf(e[1].id) >= 0) || defaults.slice().sort((a, b) => byOldest(a[1], b[1]))[0];
          defaults.filter((e) => e !== keep).forEach((e) => {
            write('students', JSON.stringify(e[1].id), Object.assign(copy(e[1]), { isDefault: false }));
            notes.push(e[1].name + ' from the file is kept as an ordinary player: this device already has its own default player.');
          });
        }
        // N14: the newest active override per student and family stays; older ones in the same family end now.
        const kept = [];
        Array.from(after('overrides').values()).filter((o) => o.status === 'active' && touched.has(o.studentId)).sort(byNewest).forEach((o) => {
          if (!learningEngine.overridesToEnd(o, kept).length) { kept.push(o); return; }
          write('overrides', JSON.stringify(o.id), Object.assign(copy(o), { status: 'ended', endedAt: now }));
          notes.push('Ended an older override for ' + studentName(o.studentId) + ' (' + conceptName(o.conceptId) + '): a newer one for the same concepts is kept.');
        });
        // N14: one open Ninja Check per student and form: the newest stays (one with answers first); unstarted ones are cancelled.
        const open = {};
        Array.from(after('assessments').values()).filter((r) => OPEN_RUN.indexOf(r.status) >= 0 && touched.has(r.studentId)).forEach((r) => {
          (open[r.studentId + '|' + r.form] = open[r.studentId + '|' + r.form] || []).push(r);
        });
        Object.keys(open).forEach((k) => {
          const runs = open[k].sort((a, b) => ((b.status === 'in_progress') - (a.status === 'in_progress')) || byNewest(a, b));
          runs.slice(1).forEach((r) => {
            const what = 'the ' + FORM[r.form] + ' Ninja Check of ' + studentName(r.studentId);
            if (r.status === 'pending') {
              write('assessments', JSON.stringify(r.id), Object.assign(copy(r), { status: 'cancelled', cancelledAt: now }));
              notes.push('Cancelled an extra copy of ' + what + ' that had not started: the newest one is kept.');
            } else notes.push('Left open an older copy of ' + what + ': it already has answers, so it is not cancelled.');
          });
        });

        const ops = plan.deletes.map((d) => ({ op: 'delete', store: d.store, key: d.key }));
        final.forEach((w) => ops.push({ op: w.store === 'attempts' ? 'add' : 'put', store: w.store, value: w.value }));
        const rebuilt = rebuildOps(after, device, touched, now, ops);
        ops.push({ op: 'put', store: 'meta', value: { key: 'lastImport', at: now, sourceSchemaVersion: plan.source.schemaVersion,
          sourceAppVersion: String(plan.source.appVersion).slice(0, 20) || 'unknown', sourceExportedAt: String(plan.source.exportedAt).slice(0, 40) || 'unknown',
          sourceOrigin: String(plan.source.origin || '').slice(0, 200), counts: imported } });
        const alreadyHere = plan.rows.reduce((n, r) => n + r.same, 0);
        const keptDevice = plan.conflicts.filter((c) => c.keepsDevice || !useFile).length;
        return { ops: ops, notes: notes, imported: imported, alreadyHere: alreadyHere, keptDevice: keptDevice, rebuilt: rebuilt };
      }

      /** Mastery and recommendations rebuilt from every answer of each affected student (they are caches). */
      function rebuildOps(after, device, touched, now, ops) {
        const byStudent = {};
        after('attempts').forEach((a) => { if (touched.has(a.studentId)) (byStudent[a.studentId] = byStudent[a.studentId] || []).push(a); });
        const inc = config.mastery.includeContexts;
        const overrides = Array.from(after('overrides').values());
        let n = 0;
        Object.keys(byStudent).sort().forEach((sid) => {
          const atts = byStudent[sid];
          const concepts = [];
          atts.forEach((a) => {
            if (inc.indexOf(a.context) < 0 || !Array.isArray(a.conceptIds)) return;
            a.conceptIds.forEach((c) => { if (concepts.indexOf(c) < 0) concepts.push(c); });
          });
          if (!concepts.length) return;
          n++;
          const snaps = {};
          device('mastery').forEach((m) => { if (m.studentId === sid) snaps[m.conceptId] = m; });
          concepts.forEach((c) => {
            const s = masteryEngine.rebuild(atts, sid, c, config.mastery);
            if (!s.total) return;
            snaps[c] = s;
            ops.push({ op: 'put', store: 'mastery', value: s });
          });
          const view = { mastery: snaps, overrides: overrides.filter((o) => o.studentId === sid && o.status === 'active'),
            adaptiveEnabled: config.adaptive.enabled, now: now, runActivities: [] };
          learningEngine.recommendableAffected(concepts).forEach((c) => {
            const d = learningEngine.recommendationFor(c, view, CFG);
            if (d) ops.push({ op: 'put', store: 'recommendations', value: { studentId: sid, conceptId: c, createdAt: now, source: 'adaptive', decision: d } });
          });
        });
        return n;
      }

      /* ---------- step 9: the result ---------- */
      const WORDS = {
        classes: ['class', 'classes'], students: ['student', 'students'], worldProgress: ['world progress record', 'world progress records'],
        sessions: ['session', 'sessions'], attempts: ['answer', 'answers'], overrides: ['override', 'overrides'],
        assignments: ['assignment', 'assignments'], assessments: ['Ninja Check', 'Ninja Checks']
      };
      const num = (n) => n.toLocaleString('en-GB');
      /** "Imported 3 classes, 25 students, 4,210 answers. Already here: 40. Kept as on this device: 2. Nothing else was changed." */
      function resultText(built) {
        const parts = WRITTEN.filter((s) => built.imported[s] > 0).map((s) => num(built.imported[s]) + ' ' + WORDS[s][built.imported[s] === 1 ? 0 : 1]);
        return (parts.length ? 'Imported ' + parts.join(', ') + '.' : 'Nothing new was imported.') +
          ' Already here: ' + num(built.alreadyHere) + '. Kept as on this device: ' + num(built.keptDevice) + '.' +
          (built.notes.length ? ' ' + built.notes.join(' ') : '') + ' Nothing else was changed.';
      }
      /** What a plan would do; apply() refuses a plan when the device changed after it was made. */
      const signature = (p) => JSON.stringify([p.mode, p.rows, p.conflicts.map((c) => c.store + c.key)]);

      function create(options) {
        const o = options || {};
        const repo = o.repo || appRepo;
        const now = typeof o.now === 'function' ? o.now : () => util.now();
        const log = o.log || { error(m) { try { console.error(m); } catch (e) { /* ignore */ } } };

        async function snapshot() {
          const cur = {};
          for (const s of schema.STORE_NAMES) cur[s] = (await repo.getAll(s)) || [];
          return cur;
        }
        /** Steps 2 to 7 on the file's text: { ok: true, plan } or a rejection. Nothing is written. */
        async function check(text) {
          const current = await snapshot();
          const v = validate(text, current);
          return v.ok ? { ok: true, plan: analyze(v.bundle, current, v.sourceSchemaVersion) } : v;
        }
        /** Steps 8 and 9 after the teacher confirmed: one atomic batch, or nothing at all. */
        async function apply(plan, choice) {
          const current = await snapshot();
          // Step 5 again: a student or class the file relies on may have been deleted since the summary.
          const refs = references(plan.bundle, current);
          if (!refs.ok) return refs;
          const fresh = analyze(plan.bundle, current, plan.source.schemaVersion);
          if (signature(fresh) !== signature(plan)) {
            return { ok: false, changed: true, plan: fresh,
              message: 'The data on this device changed after the summary was made. Nothing was imported. Check the new summary and confirm again.' };
          }
          const built = planOps(fresh, choice === 'file' ? 'file' : 'keep', now());
          try {
            await repo.batch(built.ops);
          } catch (e) {
            log.error('[NBA] import failed, nothing was changed: ' + ((e && e.message) || e));
            return { ok: false, message: 'Import failed. Nothing was changed.' };
          }
          return { ok: true, message: resultText(built), imported: built.imported, alreadyHere: built.alreadyHere,
            keptDevice: built.keptDevice, notes: built.notes, rebuilt: built.rebuilt, mode: fresh.mode };
        }
        return { snapshot, check, apply };
      }

      const app = create();
      return Object.assign({
        create, read, parse, validate, isEmpty, analyze, planOps, resultText, same, upgraders, MESSAGES, TYPE, WRITTEN
      }, app);
    });
}());
