/*
 * screens (L5): the child screen kernel (DESIGN 3.3). Screen modules loaded later register
 * their screens and data-action handlers here, so calls such as "show the complete screen"
 * are run-time lookups by name instead of forward module references.
 * Holds the v1 run-time state, showScreen (as show) and the delegated onClick.
 */
(function () {
  'use strict';

  NBA.define('screens', ['config', 'util', 'catalog', 'dom', 'speech', 'audio'],
    (config, util, catalog, dom, speech, audio) => {
      const { heroById, DEFAULT_HERO } = catalog;
      const { reducedMotion, clearTimers, guardInput } = dom;
      const { SPEECH } = speech;
      const { AUDIO } = audio;

      /** Run-time state (not saved). */
      const state = {
        screen: null,
        pickerFirstRun: false,
        session: { startedAt: null }, // Date.now() at the first Play tap; drives the rest reminder
        run: null,                    // the world being played (see missionUI.startRun)
        storyWorldId: null,           // world shown on the story card
        completeWorldId: null,        // world shown on the World Complete screen
        currentStudent: null,         // the student record playing now (main.js sets it at boot)
        activeStudents: [],           // P6: the active students "Who's playing?" lists (gameUI.refreshPlayers)
        playersFromHome: false        // P6: the players screen was opened from Home (it shows a Home button)
      };

      /** The current student's hero id, or null when this student has not picked one yet. */
      function studentHeroId() {
        const s = state.currentStudent;
        return s && heroById(s.heroId) ? s.heroId : null;
      }
      /** The chosen hero's id, or the default hero. */
      function currentHeroId() { return currentHero().id; }
      function currentHero() { return heroById(studentHeroId()) || heroById(DEFAULT_HERO); }

      /** Saves a hero choice (game-ui registers roster.setHero plus prefs lastHeroId). */
      let heroWriter = null;
      function setHeroWriter(fn) { heroWriter = fn; }
      /** Set the current student's hero now (synchronously) and save it in the background. */
      function setHero(heroId) {
        const s = state.currentStudent;
        if (!s || !heroById(heroId)) return;
        s.heroId = heroId;
        if (heroWriter) heroWriter(s.id, heroId);
        else { try { console.error('[NBA] screens.setHero: no hero writer registered'); } catch (e) { /* ignore */ } }
      }
      /** Put the chosen hero's name into a line of text. */
      function fill(text) {
        const h = currentHero();
        return String(text).replace(/\{hero\}/g, h.name);
      }
      function elapsedPlayMs() { return state.session.startedAt ? Date.now() - state.session.startedAt : 0; }

      // Each screen is a render function that returns one <section class="screen">.
      // Buttons carry data-action; registered actions handle them. after(sec, p)
      // runs once the screen is in the page (stage fitting, speech, sounds).
      const SCREENS = {};
      const ACTIONS = {};
      /** Actions with their own sound (no extra tap click). */
      const OWN_SOUND = {};

      /** One per screen: { render(params) -> html, after?(sec, params) }. A duplicate is a developer error. */
      function register(name, def) {
        if (Object.prototype.hasOwnProperty.call(SCREENS, name)) throw new Error('[NBA] duplicate screen: ' + name);
        if (!def || typeof def.render !== 'function') throw new Error('[NBA] screen ' + name + ' needs render()');
        SCREENS[name] = def;
      }

      /** Merge data-action handlers; ownSound lists the actions that play their own sound. */
      function registerActions(map, ownSound) {
        Object.keys(map).forEach((name) => {
          if (Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw new Error('[NBA] duplicate action: ' + name);
        });
        Object.keys(map).forEach((name) => { ACTIONS[name] = map[name]; });
        (ownSound || []).forEach((name) => { OWN_SOUND[name] = 1; });
      }

      /**
       * Show one screen. Always in this order: stop speech, cancel game timers,
       * render (this also removes any overlay), then the screen's after hook.
       */
      function show(name, params) {
        if (!Object.prototype.hasOwnProperty.call(SCREENS, name)) throw new Error('[NBA] unknown screen: ' + name);
        const p = params || {};
        SPEECH.cancel();
        clearTimers();
        const app = document.getElementById('app');
        app.innerHTML = SCREENS[name].render(p);
        app.scrollTop = 0;
        state.screen = name;
        const sec = app.firstElementChild;
        if (!reducedMotion()) sec.classList.add('enter');
        if (SCREENS[name].after) SCREENS[name].after(sec, p);
        guardInput();
      }

      /** One delegated click listener for the whole game (main.js attaches it to #app once). */
      function onClick(e) {
        if (performance.now() < dom.inputReadyAt()) return; // stray second tap of a double-tap
        const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
        if (!el || el.disabled) return;
        const action = el.getAttribute('data-action');
        if (!ACTIONS[action]) return;
        AUDIO.unlock(); // creates or resumes WebAudio on a real tap
        if (!OWN_SOUND[action]) AUDIO.play('tap');
        ACTIONS[action](el);
      }

      /** Called by main.js after boot: throws if any of these screens was never registered. */
      function requireScreens(names) {
        const missing = names.filter((n) => !Object.prototype.hasOwnProperty.call(SCREENS, n));
        if (missing.length) throw new Error('[NBA] missing screens: ' + missing.join(', '));
      }

      /** True once game-ui registered the hero writer (main.js checks it at boot). */
      function hasHeroWriter() { return typeof heroWriter === 'function'; }

      return {
        state, currentHeroId, currentHero, studentHeroId, fill, elapsedPlayMs,
        setHero, setHeroWriter, hasHeroWriter,
        register, registerActions, show, onClick, requireScreens
      };
    });
}());
