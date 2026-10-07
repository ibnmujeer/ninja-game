/*
 * idbAdapter (L3): the IndexedDB storage adapter (DESIGN 9.1, 9.2, 9.4, 9.5). Depends on util
 * only: the upgrade steps are injected through open({ name, version, steps, timeoutMs }), so
 * this file never requires migrations.
 *
 * create({ indexedDB?, IDBKeyRange?, setTimer?, clearTimer? }) -> adapter. The options let
 * tests inject a missing or throwing IndexedDB and a fake timer; the app passes nothing.
 *
 * open() never rejects. It resolves { mode: 'indexeddb', reason: null } on success, otherwise
 * { mode: 'memory', reason } with reason one of: unavailable, open_threw, open_error:<name>,
 * db_newer_than_app, upgrade_failed, open_timeout, open_blocked. A late onsuccess after a
 * timeout closes that connection at once. Every connection closes itself on versionchange
 * (another tab upgrading) and then reports through onClose.
 */
(function () {
  'use strict';

  NBA.define('idbAdapter', ['util'], (util) => {
    const { compareKeys } = util;

    function create(options) {
      const o = options || {};
      const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
      const clearTimer = o.clearTimer || ((t) => clearTimeout(t));
      let db = null;
      let onCloseHandler = null;

      function factory() {
        if (Object.prototype.hasOwnProperty.call(o, 'indexedDB')) return o.indexedDB;
        return globalThis.indexedDB; // may throw in some sandboxes: the caller catches
      }
      function keyRange() { return o.IDBKeyRange || globalThis.IDBKeyRange; }

      function closedError() {
        const e = new Error('InvalidStateError: the database connection is closed');
        e.name = 'InvalidStateError';
        return e;
      }

      function open(args) {
        const a = args || {};
        return new Promise((resolve) => {
          let settled = false, blocked = false, upgradeFailed = false, timer = null;
          const finish = (mode, reason) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimer(timer);
            resolve({ mode: mode, reason: reason });
          };
          let f;
          try { f = factory(); } catch (e) { finish('memory', 'unavailable'); return; }
          if (!f || typeof f.open !== 'function') { finish('memory', 'unavailable'); return; }
          onCloseHandler = typeof a.onClose === 'function' ? a.onClose : null;
          let req;
          try { req = f.open(a.name, a.version); } catch (e) { finish('memory', 'open_threw'); return; }
          timer = setTimer(() => finish('memory', blocked ? 'open_blocked' : 'open_timeout'), a.timeoutMs || 3000);
          req.onblocked = () => { blocked = true; };
          req.onupgradeneeded = (ev) => {
            const udb = req.result, tx = req.transaction;
            try {
              for (let v = (ev.oldVersion || 0) + 1; v <= a.version; v++) {
                const step = a.steps && a.steps[v];
                if (typeof step !== 'function') throw new Error('no upgrade step for version ' + v);
                step(udb, tx);
              }
            } catch (e) {
              upgradeFailed = true;
              try { tx.abort(); } catch (e2) { /* already aborting */ }
            }
          };
          req.onerror = (ev) => {
            const name = req.error && req.error.name ? req.error.name : 'UnknownError';
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            if (upgradeFailed) finish('memory', 'upgrade_failed');
            else if (name === 'VersionError') finish('memory', 'db_newer_than_app');
            else finish('memory', 'open_error:' + name);
          };
          req.onsuccess = () => {
            const conn = req.result;
            if (settled) { try { conn.close(); } catch (e) { /* ignore */ } return; } // too late: never keep it open
            db = conn;
            const lost = () => {
              if (db !== conn) return;
              db = null;
              if (onCloseHandler) onCloseHandler();
            };
            conn.onversionchange = () => { try { conn.close(); } catch (e) { /* ignore */ } lost(); };
            conn.onclose = lost;
            finish('indexeddb', null);
          };
        });
      }

      function range(q) {
        const R = keyRange();
        if (q.value !== undefined) return R.only(q.value);
        if (q.lower !== undefined && q.upper !== undefined) return R.bound(q.lower, q.upper);
        if (q.lower !== undefined) return R.lowerBound(q.lower);
        if (q.upper !== undefined) return R.upperBound(q.upper);
        return undefined;
      }
      const emptyRange = (q) => q.value === undefined && q.lower !== undefined && q.upper !== undefined &&
        compareKeys(q.lower, q.upper) > 0;

      /** A plain Error whose name and message both carry the DOMException name (same as memory). */
      function norm(e) {
        if (!e) return new Error('AbortError: transaction aborted');
        const name = e.name || 'Error';
        const msg = String(e.message || '');
        const err = new Error(msg.indexOf(name) === 0 ? msg : name + ': ' + msg);
        err.name = name;
        return err;
      }

      /** Run fn(tx) in one transaction; resolves with fn's result after the commit. */
      function inTx(storeNames, mode, fn) {
        return new Promise((resolve, rejectRaw) => {
          const reject = (e) => rejectRaw(norm(e));
          if (!db) { reject(closedError()); return; }
          let tx, result, failed = null;
          try {
            tx = db.transaction(storeNames, mode);
          } catch (e) { reject(e); return; }
          tx.oncomplete = () => { if (failed) reject(failed); else resolve(result); };
          tx.onabort = () => reject(failed || tx.error || new Error('AbortError: transaction aborted'));
          tx.onerror = (ev) => { if (!failed) failed = (ev && ev.target && ev.target.error) || tx.error; };
          try {
            result = fn(tx, (v) => { result = v; }, (err) => { failed = err; });
          } catch (e) {
            failed = e;
            try { tx.abort(); } catch (e2) { /* ignore */ }
          }
        });
      }

      function source(tx, store, q) {
        const os = tx.objectStore(store);
        return q.index !== undefined ? os.index(q.index) : os;
      }

      return {
        kind: 'indexeddb',
        open,
        get(store, key) {
          return inTx([store], 'readonly', (tx, set) => { const r = tx.objectStore(store).get(key); r.onsuccess = () => set(r.result); });
        },
        getAll(store, query) {
          const q = query || {};
          if (emptyRange(q)) return Promise.resolve([]);
          return inTx([store], 'readonly', (tx, set) => {
            const src = source(tx, store, q);
            if (q.direction === undefined && q.limit === undefined) {
              const r = src.getAll(range(q));
              r.onsuccess = () => set(r.result);
              return [];
            }
            if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1)) {
              const e = new Error('DataError: limit must be a positive integer');
              e.name = 'DataError';
              throw e;
            }
            const out = [];
            const c = src.openCursor(range(q), q.direction === 'prev' ? 'prev' : 'next');
            c.onsuccess = () => {
              const cur = c.result;
              if (!cur || (q.limit !== undefined && out.length >= q.limit)) return;
              out.push(cur.value);
              cur.continue();
            };
            return out;
          });
        },
        count(store, query) {
          const q = query || {};
          if (emptyRange(q)) return Promise.resolve(0);
          return inTx([store], 'readonly', (tx, set) => { const r = source(tx, store, q).count(range(q)); r.onsuccess = () => set(r.result); });
        },
        put(store, record) {
          return inTx([store], 'readwrite', (tx, set) => { const r = tx.objectStore(store).put(record); r.onsuccess = () => set(r.result); });
        },
        add(store, record) {
          return inTx([store], 'readwrite', (tx, set, fail) => {
            const r = tx.objectStore(store).add(record);
            r.onsuccess = () => set(r.result);
            r.onerror = (ev) => { fail(r.error); ev.preventDefault(); ev.stopPropagation(); };
          });
        },
        delete(store, key) {
          return inTx([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); }).then(() => undefined);
        },
        /** All ops in ONE transaction: all applied or none (any failing op aborts it). */
        batch(ops) {
          const list = ops || [];
          const names = Array.from(new Set(list.map((op) => op.store)));
          if (!names.length) return Promise.resolve();
          return inTx(names, 'readwrite', (tx) => {
            list.forEach((op) => {
              const os = tx.objectStore(op.store);
              if (op.op === 'put') os.put(op.value);
              else if (op.op === 'add') os.add(op.value);
              else if (op.op === 'delete') os.delete(op.key);
              else throw new Error('DataError: unknown op ' + op.op);
            });
          }).then(() => undefined);
        },
        clearAll() {
          if (!db) return Promise.reject(closedError());
          const names = Array.from(db.objectStoreNames);
          if (!names.length) return Promise.resolve();
          return inTx(names, 'readwrite', (tx) => { names.forEach((n) => tx.objectStore(n).clear()); }).then(() => undefined);
        },
        close() {
          const conn = db;
          db = null;
          if (conn) { try { conn.close(); } catch (e) { /* ignore */ } }
        },
        /** Tests only: remove a whole database (nba-test-<n>). */
        deleteDatabase(name) {
          return new Promise((resolve, reject) => {
            let f;
            try { f = factory(); } catch (e) { reject(e); return; }
            if (!f) { resolve(); return; }
            const r = f.deleteDatabase(name);
            r.onsuccess = () => resolve();
            r.onerror = () => reject(r.error);
          });
        },
        /** The open connection's store and index names (tests check the upgrade). */
        describe() {
          if (!db) return null;
          const out = {};
          const names = Array.from(db.objectStoreNames);
          if (!names.length) return out;
          const tx = db.transaction(names, 'readonly');
          names.forEach((n) => {
            const os = tx.objectStore(n);
            out[n] = { keyPath: os.keyPath, indexes: Array.from(os.indexNames).sort().map((i) => [i, os.index(i).keyPath]) };
          });
          return out;
        }
      };
    }

    return { create };
  });
}());
