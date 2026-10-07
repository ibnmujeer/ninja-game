/*
 * main (L6): boot (DESIGN 4.2; v1 section 11 init). Checks that every module built, runs the
 * synchronous v1 init steps in v1 order, installs NBA_TEST (with ?test) before storage opens,
 * then boots storage asynchronously: repo.open() (IndexedDB, or memory with a reason),
 * the default student, the v1 save migration, the current student and their world progress.
 * Only then html[data-nba-ready="1"] is set and the title screen shown. #app stays empty
 * (the yellow background) until then; a plain "Loading..." line appears after boot.slowMs.
 */
(function () {
  'use strict';

  // The index.html module list (static_checks.py checks registry.test.js holds the same list).
  const REQUIRED = ['config', 'util', 'catalog', 'questionTypes', 'generator', 'errorEngine', 'masteryEngine', 'adaptiveEngine', 'targets', 'assessmentEngine', 'learningEngine', 'reports', 'schema',
    'memoryAdapter', 'migrations', 'idbAdapter', 'prefs', 'repo', 'exporter', 'importer', 'roster', 'learning', 'assessments', 'teacherData', 'dom', 'audio', 'speech', 'art',
    'bricks', 'screens', 'renderers', 'progression', 'runKinds', 'missionUI', 'checkUI', 'gameUI',
    'teacherUI', 'classView', 'dashboardView', 'studentView', 'pulseView', 'assignmentsView', 'checksView', 'dataView', 'testHook'];
  const SCREEN_NAMES = ['title', 'picker', 'home', 'story', 'mission', 'complete', 'check-intro', 'check-end', 'players', 'assignment-end'];
  // P6 (DESIGN 4.1 pattern 4): the teacher views; P7 adds 'data' (export and import).
  const TEACHER_TABS = ['classes', 'dashboard', 'student', 'pulse', 'assignments', 'checks', 'data'];

  /** Plain message for the child plus a <details> list of the module errors for adults. */
  function showBootError(errors) {
    const app = document.getElementById('app');
    if (!app) return;
    app.textContent = '';
    const p = document.createElement('p');
    p.style.cssText = 'font-size:24px;padding:16px';
    p.textContent = 'The game could not start. Please reload the page.';
    const details = document.createElement('details');
    details.style.cssText = 'padding:0 16px;font-size:16px';
    const summary = document.createElement('summary');
    summary.textContent = 'Details';
    const list = document.createElement('ul');
    errors.forEach((e) => {
      const li = document.createElement('li');
      li.textContent = e.module + ' (' + e.kind + '): ' + e.detail;
      list.appendChild(li);
    });
    details.appendChild(summary);
    details.appendChild(list);
    app.appendChild(p);
    app.appendChild(details);
  }

  const booted = NBA.boot(REQUIRED);
  if (!booted.ok) { showBootError(booted.errors); return; }

  const config = NBA.require('config');
  const prefs = NBA.require('prefs');
  const repo = NBA.require('repo');
  const migrations = NBA.require('migrations');
  const roster = NBA.require('roster');
  const learning = NBA.require('learning');
  const speech = NBA.require('speech');
  const audio = NBA.require('audio');
  const bricks = NBA.require('bricks');
  const screens = NBA.require('screens');
  const missionUI = NBA.require('missionUI');
  const gameUI = NBA.require('gameUI');
  const teacherUI = NBA.require('teacherUI');
  const testHook = NBA.require('testHook');

  // Boot step 2 (DESIGN 4.2): the content data is consistent and every activity has logic and a renderer.
  // P4-N1: the mastery thresholds are consistent (developing lower bound = needs-support bound).
  const catalogProblems = NBA.require('catalog').validate({ questionTypes: NBA.require('questionTypes') })
    .concat(NBA.require('masteryEngine').configProblems(config.mastery));
  if (catalogProblems.length) {
    try { console.error('[NBA] content data problems: ' + catalogProblems.join('; ')); } catch (e) { /* ignore */ }
    showBootError(catalogProblems.map((p) => ({ module: 'catalog', kind: 'invalid-data', detail: p })));
    return;
  }

  try {
    screens.requireScreens(SCREEN_NAMES);
    if (!screens.hasHeroWriter()) throw new Error('[NBA] no hero writer registered (gameUI)');
    if (!missionUI.hasCheckAnswerHandler()) throw new Error('[NBA] no check answer handler registered (checkUI)');
    // P6 (DESIGN 4.1 pattern 5): main.js wires the child-teacher seams in both directions.
    teacherUI.requireTabs(TEACHER_TABS);
    gameUI.setTeacherHold(teacherUI.attachHold);
    teacherUI.setExitHandler(gameUI.returnFromTeacher);
    if (!gameUI.hasTeacherHold() || !teacherUI.hasExitHandler()) throw new Error('[NBA] teacher seams not wired');
  } catch (e) {
    try { console.error(e.message); } catch (e2) { /* ignore */ }
    showBootError([{ module: 'screens', kind: 'missing-screen', detail: e.message }]);
    return;
  }

  /** The test hook exists only when the URL has ?test (for example index.html?test=1). */
  const TEST_MODE = /[?&]test(=|&|$)/.test(window.location.search);

  /** Block pinch, double-tap and keyboard zoom, text selection menus and long-press menus. */
  function guardZoom() {
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    // P6 (DESIGN 17.1): inside #teacher, text selection, context menus and keyboard/ctrl-wheel zoom work
    const inTeacher = (e) => {
      const t = e.target && e.target.nodeType === 3 ? e.target.parentNode : e.target; // selectstart can target a text node
      return !!(t && t.closest && t.closest('#teacher'));
    };
    const guard = (e) => { if (!inTeacher(e)) stop(e); };
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
    document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) stop(e); }, { passive: false });
    document.addEventListener('dblclick', guard, { passive: false });
    document.addEventListener('contextmenu', guard);
    document.addEventListener('selectstart', guard);
    window.addEventListener('wheel', (e) => { if (e.ctrlKey) guard(e); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].indexOf(e.key) >= 0) guard(e);
    });
  }

  let resizeFrame = 0;
  function onResize() {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = 0; bricks.applyScale(); bricks.fitStage(); });
  }

  /** What the asynchronous boot found (NBA_TEST.state() reads it). */
  const bootInfo = { stage: 'start', storageMode: null, storageReason: null, migration: null, defaultStudentId: null, error: null };

  function init() {
    prefs.load();
    speech.SPEECH.init();
    bricks.applyScale();
    guardZoom();
    document.getElementById('app').addEventListener('click', screens.onClick);
    teacherUI.install(); // one delegated listener set on #teacher (DESIGN 17.1)
    document.addEventListener('pointerdown', () => audio.AUDIO.unlock(), { passive: true }); // backup unlock
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { speech.SPEECH.cancel(); missionUI.noteHidden(); learning.flush(); }
    });
    window.addEventListener('pagehide', () => { missionUI.leaveRun(); learning.flush(); });
  }

  /** Steps 6 to 9 of DESIGN 4.2. Never rejects: storage problems fall back to memory. */
  async function bootStorage() {
    bootInfo.stage = 'open';
    const opened = await repo.open();
    bootInfo.storageMode = opened.mode;
    bootInfo.storageReason = opened.reason;
    bootInfo.stage = 'default-student';
    const def = await roster.ensureDefaultStudent();
    bootInfo.defaultStudentId = def.id;
    bootInfo.stage = 'migration';
    bootInfo.migration = await migrations.migrateV1({ repo: repo, prefs: prefs, studentId: def.id });
    bootInfo.stage = 'student';
    // The migration may have given the default player its v1 hero: read the record again.
    let fresh = null;
    try { fresh = await roster.get(def.id); } catch (e) { fresh = null; }
    let current = await roster.chooseStudent(prefs.get('lastStudentId'), fresh || def);
    await learning.loadStudent(current.id);
    // A failed migration write: show the validated v1 values for this session (review P2-M1).
    const unsaved = bootInfo.migration && bootInfo.migration.memoryOnly;
    if (unsaved && current.id === def.id) {
      learning.applyUnsaved(current.id, unsaved.worlds);
      if (!current.heroId && unsaved.heroId) current = Object.assign({}, current, { heroId: unsaved.heroId });
    }
    screens.state.currentStudent = current;
    await gameUI.refreshPlayers(); // P6: who the players screen lists (D4: shown only with 2 or more)
  }

  init();
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  if (TEST_MODE) testHook.install({ ready: ready, bootInfo: bootInfo });

  const slowTimer = setTimeout(() => {
    const app = document.getElementById('app');
    if (!NBA.ready && app && !app.firstChild) {
      const p = document.createElement('p');
      p.style.cssText = 'font-size:24px;padding:16px';
      p.textContent = 'Loading...';
      app.appendChild(p);
    }
  }, config.boot.slowMs);

  bootStorage().then(() => {
    bootInfo.stage = 'ready';
    clearTimeout(slowTimer);
    NBA.ready = true;
    document.documentElement.dataset.nbaReady = '1';
    screens.show('title');
    readyResolve(bootInfo);
  }).catch((e) => {
    clearTimeout(slowTimer);
    bootInfo.error = (e && e.message) || String(e);
    try { console.error('[NBA] boot failed: ' + bootInfo.error); } catch (e2) { /* ignore */ }
    showBootError([{ module: 'main', kind: 'boot-failed', detail: bootInfo.error }]);
    readyResolve(bootInfo);
  });
}());
