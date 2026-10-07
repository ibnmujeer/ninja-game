/*
 * dom (L5): DOM helpers, game timers with the SPEED factor and the double-tap input guard
 * (moved from v1 section 5). SPEED and inputReadyAt are module state behind getters and
 * setters, because the exported object is frozen.
 */
(function () {
  'use strict';

  NBA.define('dom', ['config'], (config) => {
    const { TIMING } = config;

    function reducedMotion() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }

    /** Browsers refuse speech (and warn about audio) until the page has had a real tap. */
    function hasUserActivation() {
      try {
        const ua = navigator.userActivation;
        return !ua || ua.hasBeenActive;
      } catch (e) { return true; }
    }

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    /*
     * Game timers. Every delay goes through later(), so:
     *  - screens.show() can cancel all of them (no stale callback on a new screen);
     *  - the test hook can speed the whole game up (SPEED < 1).
     * Game flow never waits for animationend or speech events.
     */
    let SPEED = 1;
    const timers = new Set();
    function later(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, Math.round(ms * SPEED)));
      timers.add(id);
      return id;
    }
    function clearTimers() { timers.forEach((id) => clearTimeout(id)); timers.clear(); }
    function getSpeed() { return SPEED; }
    function setSpeed(x) { SPEED = x; }

    /* Double-tap guard: screens.onClick() ignores taps until inputReadyAt (see TIMING.INPUT_GUARD). */
    let inputReadyAt = 0;
    function guardInput() { inputReadyAt = performance.now() + TIMING.INPUT_GUARD * SPEED; }
    function resetInputGuard() { inputReadyAt = 0; }
    function getInputReadyAt() { return inputReadyAt; }

    /** Restart a CSS animation class on an element (e.g. shake twice in a row). */
    function replayClass(el, cls, ms) {
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth; // reflow so the animation starts again
      el.classList.add(cls);
      if (ms) later(() => el.classList.remove(cls), ms);
    }

    return {
      reducedMotion, hasUserActivation, $, $all, later, clearTimers, getSpeed, setSpeed,
      guardInput, resetInputGuard, inputReadyAt: getInputReadyAt, replayClass
    };
  });
}());
