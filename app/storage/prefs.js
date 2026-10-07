/*
 * prefs (L3): lightweight preferences in localStorage (DESIGN 9.6, D4). One key,
 * ninjaBrickAcademy.v2.prefs = { v: 2, sound, lastHeroId, lastStudentId }. Learning data
 * (students, stars, attempts) lives in IndexedDB through repo, never here.
 *
 * Every access is inside try/catch and the in-memory copy is always the live one, so the
 * game keeps working when storage is blocked, full or throws (v1 parity). This file never
 * reads or writes the v1 key ninjaBrickAcademy.v1; only migrations reads it.
 *   load()            read and validate once at boot (unknown hero -> null, non-boolean sound -> true)
 *   get(name)         'sound' | 'lastHeroId' | 'lastStudentId'
 *   set(name, value)  validates, keeps it in memory and saves
 *   existedAtBoot()   true when the v2 key was present at load() (first V2 run = false)
 *   remove()          test hook only: back to defaults and remove the v2 key
 */
(function () {
  'use strict';

  NBA.define('prefs', ['config', 'catalog'], (config, catalog) => {
    const { PREFS_KEY, PREFS_VERSION } = config;
    const { heroById } = catalog;
    const STUDENT_RE = /^stu_[a-z0-9]{16}$/;

    const defaults = () => ({ v: PREFS_VERSION, sound: true, lastHeroId: null, lastStudentId: null });
    let data = defaults();
    let existed = false;

    const CHECK = {
      sound: (x) => (typeof x === 'boolean' ? x : true),
      lastHeroId: (x) => (typeof x === 'string' && heroById(x) ? x : null),
      lastStudentId: (x) => (typeof x === 'string' && STUDENT_RE.test(x) ? x : null)
    };

    /** Parse and check saved JSON; anything odd falls back to its default. */
    function validate(raw) {
      const d = defaults();
      if (typeof raw !== 'string') return d;
      let p = null;
      try { p = JSON.parse(raw); } catch (e) { return d; }
      if (!p || typeof p !== 'object' || p.v !== PREFS_VERSION) return d;
      Object.keys(CHECK).forEach((k) => { if (Object.prototype.hasOwnProperty.call(p, k)) d[k] = CHECK[k](p[k]); });
      return d;
    }

    function load() {
      let raw = null;
      try { raw = window.localStorage.getItem(PREFS_KEY); } catch (e) { raw = null; }
      existed = typeof raw === 'string';
      data = validate(raw);
    }

    function save() {
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch (e) { /* memory only */ }
    }

    function get(name) {
      if (!Object.prototype.hasOwnProperty.call(CHECK, name)) throw new Error('[NBA] unknown preference: ' + name);
      return data[name];
    }

    function set(name, value) {
      if (!Object.prototype.hasOwnProperty.call(CHECK, name)) throw new Error('[NBA] unknown preference: ' + name);
      data[name] = CHECK[name](value);
      save();
      return data[name];
    }

    function existedAtBoot() { return existed; }

    function remove() {
      data = defaults();
      try { window.localStorage.removeItem(PREFS_KEY); } catch (e) { /* ignore */ }
    }

    /** A copy of the current preferences (test hook and unit tests). */
    function snapshot() { return Object.assign({}, data); }

    return { load, get, set, existedAtBoot, remove, snapshot, validate, KEY: PREFS_KEY };
  });
}());
