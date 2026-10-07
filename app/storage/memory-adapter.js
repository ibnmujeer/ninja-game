/*
 * memoryAdapter (L3): the in-memory storage adapter (DESIGN 9.1, 9.5). Same promise-based
 * interface as the IndexedDB adapter, with IndexedDB's key ordering (numbers before strings,
 * arrays element by element; ties on an index broken by primary key), so both return the
 * same records in the same order. Records are copied in and out (JSON round trip), so a
 * caller can never change stored state by accident. Used when IndexedDB is unavailable or
 * fails to open: the game keeps working, but nothing is kept after the page closes.
 *
 * create() -> adapter. Every adapter is independent (tests make many).
 */
(function () {
  'use strict';

  NBA.define('memoryAdapter', ['util', 'schema'], (util, schema) => {
    const { compareKeys, isValidKey } = util;

    function storageError(name, message) {
      const e = new Error(name + ': ' + message);
      e.name = name;
      return e;
    }

    const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

    /** Value at a key path (a string or an array of strings) of a record. */
    function keyAt(record, keyPath) {
      if (Array.isArray(keyPath)) return keyPath.map((p) => record[p]);
      return record[keyPath];
    }

    /** True when key k is inside the query's value / lower / upper range. */
    function inRange(k, q) {
      if (q.value !== undefined) return compareKeys(k, q.value) === 0;
      if (q.lower !== undefined && compareKeys(k, q.lower) < 0) return false;
      if (q.upper !== undefined && compareKeys(k, q.upper) > 0) return false;
      return true;
    }

    function create() {
      let stores = null;  // name -> Map(JSON key -> { key, value })
      let defs = null;    // name -> { keyPath, indexes: Map(name -> keyPath) }
      let closed = false;

      function needStore(name) {
        if (closed) throw storageError('InvalidStateError', 'the adapter is closed');
        if (!stores) throw storageError('InvalidStateError', 'the adapter is not open');
        if (!stores.has(name)) throw storageError('NotFoundError', 'no store ' + name);
        return stores.get(name);
      }

      /** [{ key, indexKey, value }] matching the query, in IndexedDB order. */
      function select(name, query) {
        const map = needStore(name);
        const q = query || {};
        let keyPathOfIndex = null;
        if (q.index !== undefined) {
          if (!defs[name].indexes.has(q.index)) throw storageError('NotFoundError', 'no index ' + q.index + ' on ' + name);
          keyPathOfIndex = defs[name].indexes.get(q.index);
        }
        const rows = [];
        map.forEach((entry) => {
          const ik = keyPathOfIndex === null ? entry.key : keyAt(entry.value, keyPathOfIndex);
          if (!isValidKey(ik)) return; // sparse index: records without a valid key are left out
          if (inRange(ik, q)) rows.push({ key: entry.key, indexKey: ik, value: entry.value });
        });
        rows.sort((a, b) => compareKeys(a.indexKey, b.indexKey) || compareKeys(a.key, b.key));
        if (q.direction === 'prev') rows.reverse();
        if (q.limit !== undefined) {
          if (!Number.isInteger(q.limit) || q.limit < 1) throw storageError('DataError', 'limit must be a positive integer');
          return rows.slice(0, q.limit);
        }
        return rows;
      }

      /** Apply one write to a store map (throws on a bad key or an add over an existing key). */
      function apply(map, name, op) {
        if (op.op === 'delete') {
          if (!isValidKey(op.key)) throw storageError('DataError', 'bad key for delete on ' + name);
          map.delete(JSON.stringify(op.key));
          return op.key;
        }
        const value = copy(op.value);
        if (!value || typeof value !== 'object') throw storageError('DataError', 'a record must be an object');
        const key = keyAt(value, defs[name].keyPath);
        if (!isValidKey(key)) throw storageError('DataError', 'the record has no valid key for ' + name);
        const k = JSON.stringify(key);
        if (op.op === 'add' && map.has(k)) throw storageError('ConstraintError', 'key already exists in ' + name);
        if (op.op !== 'add' && op.op !== 'put') throw storageError('DataError', 'unknown op ' + op.op);
        map.set(k, { key: key, value: value });
        return key;
      }

      const run = (fn) => new Promise((resolve) => resolve(fn()));

      return {
        kind: 'memory',
        /** Creates every store of schema.STORES; steps and timeouts do not apply in memory. */
        open() {
          return run(() => {
            stores = new Map();
            defs = {};
            schema.STORE_NAMES.forEach((n) => {
              const d = schema.STORES[n];
              stores.set(n, new Map());
              defs[n] = { keyPath: d.keyPath, indexes: new Map(d.indexes.map((x) => [x[0], x[1]])) };
            });
            closed = false;
            return { mode: 'memory', reason: null };
          });
        },
        get(store, key) {
          return run(() => {
            const e = needStore(store).get(JSON.stringify(key));
            return e ? copy(e.value) : undefined;
          });
        },
        getAll(store, query) { return run(() => select(store, query).map((r) => copy(r.value))); },
        count(store, query) {
          return run(() => {
            const q = Object.assign({}, query || {});
            delete q.direction;
            delete q.limit;
            return select(store, q).length;
          });
        },
        put(store, record) { return run(() => apply(needStore(store), store, { op: 'put', value: record })); },
        add(store, record) { return run(() => apply(needStore(store), store, { op: 'add', value: record })); },
        delete(store, key) { return run(() => { apply(needStore(store), store, { op: 'delete', key: key }); }); },
        /** All ops in one step: on any failure nothing is changed. */
        batch(ops) {
          return run(() => {
            const work = new Map();
            (ops || []).forEach((op) => {
              if (!work.has(op.store)) work.set(op.store, new Map(needStore(op.store)));
              apply(work.get(op.store), op.store, op);
            });
            work.forEach((map, name) => stores.set(name, map));
          });
        },
        clearAll() { return run(() => { schema.STORE_NAMES.forEach((n) => needStore(n).clear()); }); },
        close() { closed = true; },
        deleteDatabase() { return Promise.resolve(); }
      };
    }

    return { create };
  });
}());
