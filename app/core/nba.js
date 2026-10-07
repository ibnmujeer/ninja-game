/*
 * Number Builder V2: the module registry (L0 kernel). Classic script, no ES modules (D1).
 *
 * Every app file calls NBA.define(name, deps, factory). Scripts load in a fixed
 * order from index.html, so every dependency must already be defined and built
 * when define() runs; the factory runs at once and its return value is frozen
 * (shallow). A forward reference fails as "missing dependency", which also makes
 * a dependency cycle impossible. Failures never throw out of define(): each one
 * is pushed onto NBA.errors as { module, kind, detail } and logged, and the
 * failed module is marked failed so its dependants fail too.
 *   kinds: 'duplicate' | 'missing-dependency' | 'dependency-failed' | 'factory-threw'
 * Data files do not call define(): each is one statement, NBA.data.<x> = { ... };
 */
(function (g) {
  'use strict';

  function createRegistry(opts) {
    const o = opts || {};
    const log = typeof o.log === 'function' ? o.log : (msg) => { try { console.error(msg); } catch (e) { /* ignore */ } };
    const modules = new Map(); // name -> { ok: true, exports } | { ok: false }
    const reg = { data: {}, errors: [], ready: false };

    function fail(module, kind, detail) {
      reg.errors.push({ module: module, kind: kind, detail: detail });
      log('[NBA] ' + kind + ': ' + module + ': ' + detail);
    }

    reg.define = function define(name, deps, factory) {
      if (modules.has(name)) {
        fail(name, 'duplicate', 'module "' + name + '" is defined twice');
        return;
      }
      const list = Array.isArray(deps) ? deps : [];
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const m = modules.get(d);
        if (!m) {
          modules.set(name, { ok: false });
          fail(name, 'missing-dependency', 'module "' + name + '" needs "' + d +
            '", which is not defined yet; check the script order in index.html');
          return;
        }
        if (!m.ok) {
          modules.set(name, { ok: false });
          fail(name, 'dependency-failed', 'module "' + name + '" needs "' + d + '", which failed to build');
          return;
        }
      }
      let exports;
      try {
        exports = factory.apply(null, list.map((d) => modules.get(d).exports));
      } catch (e) {
        modules.set(name, { ok: false });
        fail(name, 'factory-threw', (e && e.message) ? e.message : String(e));
        return;
      }
      if (exports === undefined) exports = {};
      if (exports !== null && (typeof exports === 'object' || typeof exports === 'function')) Object.freeze(exports);
      modules.set(name, { ok: true, exports: exports });
    };

    reg.require = function require(name) {
      const m = modules.get(name);
      if (!m || !m.ok) throw new Error('[NBA] module not available: ' + name);
      return m.exports;
    };

    /** True when the module was defined and built. */
    reg.has = function has(name) {
      const m = modules.get(name);
      return !!(m && m.ok);
    };

    /** Called once by main.js: ok is false if any module failed or a required one is missing. */
    reg.boot = function boot(requiredNames) {
      (requiredNames || []).forEach((n) => {
        if (!modules.has(n)) {
          fail(n, 'missing-dependency', 'required module "' + n + '" is not defined; check the script order in index.html');
        }
      });
      return { ok: reg.errors.length === 0, errors: reg.errors.slice() };
    };

    /** A fresh, empty registry (used by the unit tests; never by the app). */
    reg.createRegistry = createRegistry;
    return reg;
  }

  g.NBA = createRegistry();
}(globalThis));
