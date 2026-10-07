/*
 * util (L2): small pure helpers (moved from v1 section 5), plus (P2) fnv1a32, the id factory and
 * IndexedDB key comparison, and (P3, DESIGN 4.3, N6) the seeded RNG and the injected clock:
 *   rngFrom(seed)        mulberry32: a function giving floats in [0, 1), the same for the same seed
 *   newSeed()            a uint32 seed from the seed source (Math.random unless setSeedSource(fn))
 *   setSeedSource(fn)    NBA_TEST.seed(n) passes rngFrom(n); null restores Math.random
 *   now() / setClock(ms) Date.now(), or the fixed time set by NBA_TEST.setClock (null = real clock)
 *   shuffle(list, rng?) and pick(list, rng?) take an rng (Math.random when omitted: confetti only)
 * Engines never call now() or Math.random themselves: callers pass now and rng in.
 */
(function () {
  'use strict';

  NBA.define('util', [], () => {
    function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
    function pick(list, rng) { return list[Math.floor((rng || Math.random)() * list.length)]; }
    function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
    function range(lo, hi) { const r = []; for (let i = lo; i <= hi; i++) r.push(i); return r; }
    function repeat(item, n) { return new Array(n).fill(item); }

    /** Fisher-Yates shuffle into a new array (every order equally likely). */
    function shuffle(list, rng) {
      const r = rng || Math.random;
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    /** mulberry32: a small, fast seeded generator of floats in [0, 1). */
    function rngFrom(seed) {
      let s = (Number(seed) >>> 0);
      return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    let seedSource = Math.random;
    function setSeedSource(fn) { seedSource = typeof fn === 'function' ? fn : Math.random; }
    /** A new uint32 question seed. */
    function newSeed() { return Math.floor(seedSource() * 4294967296) >>> 0; }

    let fixedNow = null;
    function now() { return fixedNow === null ? Date.now() : fixedNow; }
    function setClock(ms) { fixedNow = (ms === null || ms === undefined) ? null : Math.floor(Number(ms)); }
    /** 'YYYY-MM-DD' of a time in the device's own time zone. */
    function localDate(ms) {
      const d = new Date(ms);
      const p = (n) => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /** Escape text for safe use inside HTML. */
    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function noRepeatsInARow(list) {
      for (let i = 1; i < list.length; i++) if (list[i] === list[i - 1]) return false;
      return true;
    }

    /** FNV-1a 32-bit hash of a string (UTF-16 code units), as 8 lowercase hex digits. */
    function fnv1a32(str) {
      let h = 0x811c9dc5;
      const s = String(str);
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return ('0000000' + h.toString(16)).slice(-8);
    }

    /**
     * An opaque id: prefix + '_' + 8 base-36 time characters (the injected clock unless nowMs is
     * given) + 8 random base-36 characters (crypto.getRandomValues, else the seed source).
     */
    function newId(prefix, nowMs) {
      const t = Math.max(0, Math.floor(nowMs == null ? now() : nowMs)).toString(36);
      const time36 = ('00000000' + t).slice(-8);
      let rand = new Uint32Array(8);
      try {
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(rand);
        else rand = rand.map(() => newSeed());
      } catch (e) {
        rand = rand.map(() => newSeed());
      }
      let r36 = '';
      for (let i = 0; i < 8; i++) r36 += (rand[i] % 36).toString(36);
      return prefix + '_' + time36 + r36;
    }

    /** IndexedDB key type order: numbers, then strings, then arrays (dates and binary keys are unused). */
    function keyRank(k) {
      if (typeof k === 'number') return 1;
      if (typeof k === 'string') return 3;
      if (Array.isArray(k)) return 5;
      return -1;
    }

    /** True for a valid IndexedDB key of the kinds the app uses (number but not NaN, string, array of keys). */
    function isValidKey(k) {
      if (typeof k === 'number') return !Number.isNaN(k);
      if (typeof k === 'string') return true;
      if (Array.isArray(k)) return k.every(isValidKey);
      return false;
    }

    /** Compare two valid keys with IndexedDB's rules: -1, 0 or 1. */
    function compareKeys(a, b) {
      const ra = keyRank(a), rb = keyRank(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
      if (ra === 5) {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
          const c = compareKeys(a[i], b[i]);
          if (c !== 0) return c;
        }
        return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
      }
      return a === b ? 0 : (a < b ? -1 : 1);
    }

    return {
      randInt, pick, clamp, range, repeat, shuffle, esc, noRepeatsInARow, fnv1a32, newId, isValidKey, compareKeys,
      rngFrom, newSeed, setSeedSource, now, setClock, localDate
    };
  });
}());
