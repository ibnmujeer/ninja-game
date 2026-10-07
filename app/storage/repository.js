/*
 * repo (L3): opens storage with the memory fallback and validates every write (DESIGN 9.3, 9.5).
 *
 * open() never rejects: IndexedDB first (upgrade steps from migrations.idbSteps), then a
 * write-and-read check on meta.schema; on any failure the whole app runs on the memory
 * adapter with a reason code (unavailable, open_threw, open_error:<name>, db_newer_than_app,
 * upgrade_failed, open_timeout, open_blocked, write_failed). Logged once (console.warn;
 * upgrade_failed: console.error). The child never sees it; teacher mode shows a banner (P6).
 *
 * mode ('indexeddb' | 'memory'), reason and state ('ok' | 'degraded' | 'closed') are getters.
 * After config.storage.degradedAfter consecutive failed writes the state is 'degraded'; one
 * console.warn per state change, never one per write. Attempts are add-only: put() on the
 * attempts store is refused. create(options) makes an independent repo (tests); the module
 * itself is the app's repo.
 */
(function () {
  'use strict';

  NBA.define('repo', ['config', 'schema', 'migrations', 'memoryAdapter', 'idbAdapter'],
    (config, schema, migrations, memoryAdapter, idbAdapter) => {
      const READABLE = {
        unavailable: 'IndexedDB is not available in this browser',
        open_threw: 'the browser refused to open storage',
        db_newer_than_app: 'this device has data from a newer version of the app; it has not been changed',
        upgrade_failed: 'the storage upgrade failed; the old data is kept',
        open_timeout: 'storage did not open in time',
        open_blocked: 'another tab of the app is still open',
        write_failed: 'the browser opened storage but refused to save'
      };

      function validationError(store, problems) {
        const e = new Error('ValidationError: ' + store + ': ' + problems.join(', '));
        e.name = 'ValidationError';
        e.problems = problems;
        return e;
      }

      /**
       * options: { name?, version?, steps?, timeoutMs?, idb? (idbAdapter.create options),
       *            forceMemory?, log?: { warn, error }, now?: () => ms }
       */
      function create(options) {
        const o = options || {};
        const log = o.log || {
          warn(m) { try { console.warn(m); } catch (e) { /* ignore */ } },
          error(m) { try { console.error(m); } catch (e) { /* ignore */ } }
        };
        const now = typeof o.now === 'function' ? o.now : () => Date.now();
        const degradedAfter = config.storage.degradedAfter;
        let adapter = null, mode = null, reason = null, state = 'ok', failures = 0, opening = null;

        function setState(next, why) {
          if (state === next) return;
          state = next;
          if (next !== 'ok') log.warn('[NBA] storage state ' + next + (why ? ' (' + why + ')' : ''));
        }

        async function useMemory(why) {
          adapter = memoryAdapter.create();
          await adapter.open({});
          mode = 'memory';
          reason = why;
          const msg = '[NBA] data is not being saved on this device (' + why + '): ' + (READABLE[why] || why) +
            '. To keep data, open the app with python tools/serve.py';
          if (why === 'upgrade_failed') log.error(msg); else log.warn(msg);
        }

        async function schemaRecord(a) {
          const old = await a.get('meta', 'schema');
          const t = now();
          return { key: 'schema', schemaVersion: schema.SCHEMA_VERSION, appVersion: schema.APP_VERSION,
            createdAt: old && typeof old.createdAt === 'number' ? old.createdAt : t, updatedAt: t };
        }

        async function doOpen() {
          if (o.forceMemory) {
            await useMemory(o.forceMemory === true ? 'unavailable' : String(o.forceMemory));
            await adapter.put('meta', await schemaRecord(adapter));
            return info();
          }
          const idb = idbAdapter.create(o.idb);
          let r;
          try {
            r = await idb.open({ name: o.name || schema.DB_NAME, version: o.version || schema.DB_VERSION,
              steps: o.steps || migrations.idbSteps, timeoutMs: o.timeoutMs || config.storage.openTimeoutMs,
              onClose: () => { if (adapter === idb) setState('closed', 'another tab upgraded the app; reload this page'); } });
          } catch (e) {
            r = { mode: 'memory', reason: 'open_error:' + ((e && e.name) || 'Error') };
          }
          if (r.mode === 'indexeddb') {
            try {
              const rec = await schemaRecord(idb);
              await idb.put('meta', rec);
              const back = await idb.get('meta', 'schema');
              if (!back || back.updatedAt !== rec.updatedAt) throw new Error('read-back mismatch');
              adapter = idb;
              mode = 'indexeddb';
              reason = null;
              return info();
            } catch (e) {
              idb.close();
              r = { mode: 'memory', reason: 'write_failed' };
            }
          }
          await useMemory(r.reason);
          try { await adapter.put('meta', await schemaRecord(adapter)); } catch (e) { /* memory never fails here */ }
          return info();
        }

        function info() { return { mode: mode, reason: reason }; }

        /** Opens once; later calls return the same result. Never rejects. */
        function open() {
          if (!opening) opening = doOpen().catch(async (e) => { await useMemory('open_error:' + ((e && e.name) || 'Error')); return info(); });
          return opening;
        }

        function need() {
          if (!adapter) throw new Error('[NBA] repo used before open()');
          return adapter;
        }

        /** Run a write and keep the consecutive-failure count (validation errors are not counted). */
        async function write(fn) {
          const a = need();
          try {
            const res = await fn(a);
            failures = 0;
            if (state === 'degraded') setState('ok');
            return res;
          } catch (e) {
            failures++;
            if (state === 'ok' && failures >= degradedAfter) setState('degraded', failures + ' writes failed');
            throw e;
          }
        }

        function check(store, record) {
          const problems = schema.validate(store, record);
          if (problems.length) throw validationError(store, problems);
        }

        const api = {
          open,
          get mode() { return mode; },
          get reason() { return reason; },
          get state() { return state; },
          get adapterKind() { return adapter ? adapter.kind : null; },
          get(store, key) { return Promise.resolve().then(() => need().get(store, key)); },
          getAll(store, query) { return Promise.resolve().then(() => need().getAll(store, query)); },
          count(store, query) { return Promise.resolve().then(() => need().count(store, query)); },
          put(store, record) {
            return Promise.resolve().then(() => {
              if (store === 'attempts') throw new Error('[NBA] attempts are add-only');
              check(store, record);
              return write((a) => a.put(store, record));
            });
          },
          add(store, record) {
            return Promise.resolve().then(() => { check(store, record); return write((a) => a.add(store, record)); });
          },
          delete(store, key) {
            return Promise.resolve().then(() => {
              if (store === 'attempts') throw new Error('[NBA] attempts are deleted only by a cascade batch');
              return write((a) => a.delete(store, key));
            });
          },
          /** ops: [{ op: 'put'|'add'|'delete', store, value|key }], validated, then ONE transaction. */
          batch(ops) {
            return Promise.resolve().then(() => {
              (ops || []).forEach((op) => {
                if (op.op === 'put' && op.store === 'attempts') throw new Error('[NBA] attempts are add-only');
                if (op.op === 'put' || op.op === 'add') check(op.store, op.value);
              });
              return write((a) => a.batch(ops || []));
            });
          },
          /** Test hook and "import into an empty database" only. */
          clearAll() { return Promise.resolve().then(() => write((a) => a.clearAll())); },
          close() { if (adapter) adapter.close(); },

          // ---------- typed helpers (P2 stores; later phases add theirs) ----------
          getStudent(id) { return api.get('students', id); },
          putStudent(rec) { return api.put('students', rec); },
          allStudents() { return api.getAll('students'); },
          worldProgressFor(studentId) { return api.getAll('worldProgress', { index: 'studentId', value: studentId }); },
          putWorldProgress(rec) { return api.put('worldProgress', rec); },
          getMeta(key) { return api.get('meta', key); }
        };
        return api;
      }

      const app = create();
      // The app's repo, plus create() for tests. Getters keep working on the frozen export.
      return Object.defineProperties({ create, READABLE }, Object.getOwnPropertyDescriptors(app));
    });
}());
