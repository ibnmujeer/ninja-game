/*
 * teacherUI (L6 teacher): the adult gate and the teacher shell (DESIGN 17.1, D5, D10).
 *
 * The gate keeps young players out of Teacher mode; it is not security and nothing here claims it
 * is. attachHold(button): a 2000 ms pointer hold (pointerdown to pointerup/pointerleave), or holding
 * Enter or Space (keydown with e.repeat ignored, timed from the first keydown) opens the gate dialog
 * inside #teacher: a sum of two numbers from 21 to 59 (Math.random, never the last sum), a labelled
 * numeric input, "That's not it. Try again." in an aria-live region, a new sum after 3 wrong answers,
 * Esc and Cancel back to Home without re-rendering it, focus trapped in the dialog.
 *
 * The shell renders into #teacher (a sibling of #app): navigation buttons with aria-current, the
 * storage banner, "Back to game" (the exit handler main.js registers: gameUI.returnFromTeacher).
 * Views register with registerTab(id, { label, nav, render(root, ctx) }) and their buttons with
 * registerActions({ name(el, event) }) for one delegated click listener on #teacher (data-t-action),
 * plus data-t-change (select/checkbox changes) and data-t-submit (forms, Enter). All DOM goes
 * through h(tag, attrs, children), which sets text only with textContent and refuses on* attributes.
 */
(function () {
  'use strict';

  NBA.define('teacherUI', ['config', 'util', 'repo', 'learning', 'dom', 'speech'], (config, util, repo, learning, dom, speech) => {
    const NAV_ORDER = ['dashboard', 'classes', 'assignments', 'checks', 'pulse', 'data'];
    const TABS = {};
    const ACTIONS = {};
    const state = { tab: null, ctx: {}, classId: undefined, open: false };
    let exitHandler = null;
    let lastSum = null;
    let installed = false;

    /** Build an element: attrs.text -> textContent; attrs.class; dataset; on* attributes are refused. */
    function h(tag, attrs, children) {
      const el = document.createElement(tag);
      const a = attrs || {};
      Object.keys(a).forEach((k) => {
        const v = a[k];
        if (v === null || v === undefined || v === false) return;
        if (/^on/i.test(k)) throw new Error('[NBA] h(): event attributes are not allowed (' + k + ')');
        if (k === 'text') el.textContent = String(v);
        else if (k === 'class') el.className = String(v);
        else if (k === 'dataset') Object.keys(v).forEach((d) => { el.dataset[d] = String(v[d]); });
        else if (k === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) el.value = String(v);
        else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v === true;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
      [].concat(children === undefined ? [] : children).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
      return el;
    }
    const root = () => document.getElementById('teacher');
    const app = () => document.getElementById('app');
    const $ = (sel, r) => (r || root()).querySelector(sel);

    function registerTab(id, def) {
      if (Object.prototype.hasOwnProperty.call(TABS, id)) throw new Error('[NBA] duplicate teacher tab: ' + id);
      if (!def || typeof def.render !== 'function') throw new Error('[NBA] teacher tab ' + id + ' needs render()');
      TABS[id] = { id: id, label: def.label || id, nav: def.nav !== false, render: def.render };
    }
    function requireTabs(ids) {
      const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(TABS, id));
      if (missing.length) throw new Error('[NBA] missing teacher tabs: ' + missing.join(', '));
    }
    function registerActions(map) {
      Object.keys(map).forEach((k) => { if (Object.prototype.hasOwnProperty.call(ACTIONS, k)) throw new Error('[NBA] duplicate teacher action: ' + k); });
      Object.keys(map).forEach((k) => { ACTIONS[k] = map[k]; });
    }
    function run(name, el, e) {
      const fn = ACTIONS[name];
      if (!fn) { try { console.error('[NBA] unknown teacher action: ' + name); } catch (x) { /* ignore */ } return; }
      Promise.resolve().then(() => fn(el, e)).catch((err) => {
        try { console.error('[NBA] teacher action ' + name + ' failed: ' + ((err && err.message) || err)); } catch (x) { /* ignore */ }
        note('Something went wrong: nothing more was changed. ' + ((err && err.message) || ''), true);
      });
    }

    /** One delegated listener set on #teacher, attached once at boot (main.js calls install()). */
    function install() {
      const r = root();
      if (installed || !r) return;
      installed = true;
      r.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-t-action]') : null;
        if (!el || el.disabled || !r.contains(el)) return;
        e.preventDefault();
        run(el.getAttribute('data-t-action'), el, e);
      });
      r.addEventListener('change', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-t-change]') : null;
        if (el) run(el.getAttribute('data-t-change'), el, e);
      });
      r.addEventListener('submit', (e) => {
        const f = e.target && e.target.closest ? e.target.closest('form[data-t-submit]') : null;
        e.preventDefault();
        if (f) run(f.getAttribute('data-t-submit'), f, e);
      });
      // on document, not #teacher: a click on the dialog background moves focus to <body> (review P6-1)
      document.addEventListener('keydown', onKeydown);
    }

    /**
     * While a teacher dialog (the gate or a confirm dialog) is open: Esc closes it and Tab and
     * Shift+Tab stay inside it (focus trap), wherever focus is; from outside, Tab goes to the first
     * control and Shift+Tab to the last.
     */
    function onKeydown(e) {
      const r = root();
      const dlg = r && !r.hidden ? $('[role="dialog"]:not([hidden])') : null;
      if (!dlg) return;
      if (e.key === 'Escape') { e.preventDefault(); run(dlg.getAttribute('data-t-cancel') || 'gate-cancel', dlg, e); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(dlg.querySelectorAll('button, input, select, textarea, a[href]')).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!dlg.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    /* ---------- the hold and the gate ---------- */
    function attachHold(btn) {
      let timer = null, keyHeld = false;
      const start = () => {
        if (timer) return;
        btn.classList.add('holding');
        timer = setTimeout(() => { timer = null; btn.classList.remove('holding'); openGate(); }, config.teacher.holdMs);
      };
      const stop = () => { if (timer) { clearTimeout(timer); timer = null; } btn.classList.remove('holding'); };
      btn.addEventListener('pointerdown', (e) => { if (typeof e.button === 'number' && e.button > 0) return; start(); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, stop));
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (e.repeat || keyHeld) return; // auto-repeat neither restarts nor shortens the hold
        keyHeld = true;
        start();
      });
      btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { keyHeld = false; stop(); } });
      btn.addEventListener('blur', () => { keyHeld = false; stop(); });
    }

    function newSum() {
      const lo = config.teacher.gateMin, hi = config.teacher.gateMax;
      let s;
      do { s = [util.randInt(lo, hi), util.randInt(lo, hi)]; } while (lastSum && s[0] === lastSum[0] && s[1] === lastSum[1]);
      lastSum = s;
      return s;
    }
    const gate = { sum: null, wrong: 0, returnFocus: null };

    function showRoot() {
      speech.SPEECH.cancel();
      dom.clearTimers();
      app().hidden = true;
      root().hidden = false;
      state.open = true;
    }
    function openGate() {
      gate.returnFocus = document.activeElement;
      gate.sum = newSum();
      gate.wrong = 0;
      showRoot();
      const r = root();
      r.textContent = '';
      const label = h('label', { for: 'gate-answer', id: 'gate-question', text: 'What is ' + gate.sum[0] + ' + ' + gate.sum[1] + '?' });
      r.appendChild(h('div', { class: 't-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-title', 'data-t-cancel': 'gate-cancel' }, [
        h('form', { class: 't-card', 'data-t-submit': 'gate-open', novalidate: true }, [
          h('h1', { id: 'gate-title', text: 'Teacher mode' }),
          h('p', { class: 't-help', text: 'This check keeps young players out of Teacher mode. It is not a password.' }),
          h('div', { class: 't-field' }, [label,
            h('input', { id: 'gate-answer', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'gate-msg' })]),
          h('p', { id: 'gate-msg', class: 't-error', 'aria-live': 'polite' }),
          h('div', { class: 't-actions' }, [
            h('button', { type: 'submit', class: 't-btn t-primary', text: 'Open' }),
            h('button', { type: 'button', class: 't-btn', 'data-t-action': 'gate-cancel', text: 'Cancel' })])
        ])]));
      $('#gate-answer').focus();
    }
    function gateOpen() {
      const input = $('#gate-answer');
      if (!input || !gate.sum) return;
      const v = input.value.trim();
      if (/^\d+$/.test(v) && Number(v) === gate.sum[0] + gate.sum[1]) { gate.sum = null; openShell('dashboard'); return; }
      gate.wrong++;
      if (gate.wrong >= config.teacher.gateTries) {
        gate.sum = newSum();
        gate.wrong = 0;
        $('#gate-question').textContent = 'What is ' + gate.sum[0] + ' + ' + gate.sum[1] + '?';
      }
      $('#gate-msg').textContent = "That's not it. Try again.";
      input.value = '';
      input.focus();
    }
    /** Back to Home exactly as it was (no re-render). */
    function gateCancel() {
      gate.sum = null;
      root().textContent = '';
      root().hidden = true;
      app().hidden = false;
      state.open = false;
      if (gate.returnFocus && document.contains(gate.returnFocus)) gate.returnFocus.focus();
    }

    /* ---------- the shell ---------- */
    function bannerText() {
      if (repo.mode === 'memory') {
        return 'Data is not being kept on this device (' + (repo.READABLE[repo.reason] || repo.reason || 'storage unavailable') +
          '). Anything recorded now is lost when the page closes. To keep data, open the app with python tools/serve.py, or try another browser.';
      }
      if (repo.state === 'degraded') return 'Some answers have not been saved yet (' + learning.pendingWrites() + ' waiting). The app keeps trying.';
      if (repo.state === 'closed') return 'Storage was closed by the browser. Reload the page to keep saving.';
      return '';
    }
    function buildShell() {
      const r = root();
      r.textContent = '';
      const nav = h('nav', { class: 't-nav', 'aria-label': 'Teacher sections' }, NAV_ORDER.filter((id) => TABS[id] && TABS[id].nav).map((id) =>
        h('button', { type: 'button', class: 't-tab', 'data-t-action': 'tab', 'data-tab': id, text: TABS[id].label })));
      const banner = bannerText();
      r.appendChild(h('div', { class: 't-shell' }, [
        banner ? h('p', { class: 't-banner', role: 'status', id: 't-banner', text: banner }) : null,
        h('header', { class: 't-head' }, [h('p', { class: 't-brand', text: 'Teacher mode' }),
          h('button', { type: 'button', class: 't-btn', 'data-t-action': 'exit', text: 'Back to game' })]),
        nav,
        h('main', { id: 't-main', class: 't-main', tabindex: '-1' }),
        h('p', { id: 't-note', class: 't-note', role: 'status', 'aria-live': 'polite' })
      ]));
    }
    function openShell(id, ctx) {
      showRoot();
      buildShell();
      return open(id || 'dashboard', ctx);
    }
    /** Clear the content root and render a view (it may return a Promise). */
    function open(id, ctx) {
      if (!TABS[id]) throw new Error('[NBA] unknown teacher tab: ' + id);
      if (!$('#t-main')) { showRoot(); buildShell(); }
      state.tab = id;
      state.ctx = ctx || {};
      Array.from(root().querySelectorAll('.t-tab')).forEach((b) => {
        if (b.getAttribute('data-tab') === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const main = $('#t-main');
      main.textContent = '';
      $('#t-note').textContent = '';
      return Promise.resolve(TABS[id].render(main, state.ctx)).then(() => {
        const head = main.querySelector('h1, h2');
        if (head) { head.setAttribute('tabindex', '-1'); head.focus(); }
      });
    }
    function note(text, isError) {
      const n = $('#t-note');
      if (!n) return;
      n.textContent = text;
      n.classList.toggle('t-error', !!isError);
    }
    function setExitHandler(fn) { exitHandler = typeof fn === 'function' ? fn : null; }
    function exit() {
      root().textContent = '';
      root().hidden = true;
      app().hidden = false;
      state.open = false;
      if (!exitHandler) {
        try { console.error('[NBA] teacher mode has no exit handler; reloading'); } catch (e) { /* ignore */ }
        window.location.reload();
        return null;
      }
      return exitHandler();
    }

    /* ---------- shared dialog and form helpers (D10: confirm first; typed confirmation for deletes) ---------- */
    let dialogResolve = null, dialogFocus = null;
    /**
     * A modal confirm dialog. o = { title, lines: [text], confirmLabel, danger, typeToConfirm?: exact text
     * that enables the confirm button, extra?: element }. Resolves true (confirmed) or false.
     */
    function confirmDialog(o) {
      closeDialog(false);
      return new Promise((resolve) => {
        const want = o.typeToConfirm || null;
        const input = want ? h('input', { id: 't-confirm-text', type: 'text', autocomplete: 'off' }) : null;
        const ok = h('button', { type: 'button', class: 't-btn ' + (o.danger ? 't-danger' : 't-primary'), id: 't-dialog-ok',
          'data-t-action': 'dialog-ok', text: o.confirmLabel || 'OK', disabled: !!want });
        const body = (o.lines || []).map((l) => h('p', { text: l }));
        const card = h('div', { class: 't-card t-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 't-dialog-title', 'data-t-cancel': 'dialog-cancel' },
          [h('h2', { id: 't-dialog-title', text: o.title })].concat(body, [o.extra || null,
            input ? h('div', { class: 't-field' }, [h('label', { for: 't-confirm-text', text: 'Type ' + want + ' to confirm' }), input]) : null,
            h('div', { class: 't-actions' }, [ok, h('button', { type: 'button', class: 't-btn', 'data-t-action': 'dialog-cancel', text: 'Cancel' })])]));
        if (input) input.addEventListener('input', () => { ok.disabled = input.value !== want; });
        dialogResolve = resolve;
        dialogFocus = document.activeElement;
        root().appendChild(h('div', { class: 't-overlay', id: 't-dialog' }, [card]));
        (input || ok).focus();
      });
    }
    function closeDialog(result) {
      const d = $('#t-dialog');
      if (d) d.remove();
      const f = dialogResolve;
      dialogResolve = null;
      if (dialogFocus && document.contains(dialogFocus)) dialogFocus.focus();
      dialogFocus = null;
      if (f) f(result);
    }

    /** Inline errors next to fields (17.4, 17.6): [{ field, message }]; focus moves to the first. */
    function fieldErrors(form, list) {
      Array.from(form.querySelectorAll('.t-field-error')).forEach((x) => x.remove());
      Array.from(form.querySelectorAll('[aria-invalid]')).forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
      let first = null;
      (list || []).forEach((p, i) => {
        const field = form.querySelector('[data-field="' + p.field + '"]') || form.querySelector('[name="' + p.field + '"]');
        const id = 't-err-' + p.field + '-' + i;
        const msg = h('p', { class: 't-error t-field-error', id: id, text: p.message });
        if (field) {
          field.setAttribute('aria-invalid', 'true');
          field.setAttribute('aria-describedby', id);
          const box = field.closest('.t-field') || field.parentNode;
          box.appendChild(msg);
          if (!first) first = field;
        } else form.appendChild(msg);
      });
      if (first) first.focus();
      return !!(list && list.length);
    }

    /** A labelled class selector: "No class" ('') plus the classes given (and "Every class" with all: true). */
    function classSelect(id, classes, value, opts) {
      const o = opts || {};
      const sel = h('select', { id: id, name: o.name || 'classId', 'data-t-change': o.change || null },
        (o.all ? [h('option', { value: '*', text: 'Every class' })] : []).concat([h('option', { value: '', text: 'No class' })],
          classes.map((c) => h('option', { value: c.id, text: c.name + (c.status === 'archived' ? ' (archived)' : '') }))));
      sel.value = value === undefined || value === null ? '' : value;
      return h('div', { class: 't-field t-inline' }, [h('label', { for: id, text: o.label || 'Class' }), sel]);
    }
    const dateText = (ms) => (typeof ms === 'number' ? util.localDate(ms) : '');

    registerActions({
      'gate-open': gateOpen,
      'gate-cancel': gateCancel,
      'dialog-ok': () => closeDialog(true),
      'dialog-cancel': () => closeDialog(false),
      tab(el) { return open(el.getAttribute('data-tab')); },
      exit() { return exit(); }
    });

    return {
      h, install, attachHold, openGate, openShell, open, registerTab, requireTabs, registerActions, note, setExitHandler,
      hasExitHandler: () => !!exitHandler, exit, state, tabIds: () => Object.keys(TABS), bannerText,
      confirmDialog, fieldErrors, classSelect, dateText
    };
  });
}());
