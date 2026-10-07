/*
 * testHook (L6): window.NBA_TEST for the Playwright checks (moved from v1 section 11).
 * main.js installs it only when the URL has ?test; without it NBA_TEST never exists.
 * The hook only calls setters (dom.setSpeed, dom.resetInputGuard, learning.setAdaptive); it holds no game state.
 */
(function () {
  'use strict';

  NBA.define('testHook',
    ['config', 'util', 'catalog', 'prefs', 'repo', 'roster', 'learning', 'assessments', 'dom', 'audio', 'speech', 'bricks', 'screens',
      'questionTypes', 'generator', 'missionUI', 'gameUI', 'teacherUI'],
    (config, util, catalog, prefs, repo, roster, learning, assessments, dom, audio, speech, bricks, screens,
      questionTypes, generator, missionUI, gameUI, teacherUI) => {
      const { MISSIONS_PER_WORLD, STORAGE_KEY, SAVE_VERSION } = config;
      const { clamp } = util;
      const { WORLDS, worldById } = catalog;
      const { $, $all, guardInput } = dom;
      const { AUDIO } = audio;
      const { SPEECH } = speech;
      const { fitStage } = bricks;
      const { state, elapsedPlayMs } = screens;
      const { tier } = questionTypes;
      const { createQuestion } = generator;
      const { startRun, startWorld, showMission, leaveRun } = missionUI;
      const showScreen = screens.show;

      /** The v1-shaped save { v: 1, heroId, sound, worlds } built from the current student (v1 suites read it). */
      function v1Save() {
        const worlds = {};
        WORLDS.forEach((w) => { const r = learning.worldRecord(w.id); worlds[w.id] = { best: r.best, done: r.done }; });
        return { v: SAVE_VERSION, heroId: screens.studentHeroId(), sound: prefs.get('sound'), worlds: worlds };
      }

      /** opts: { ready: Promise (resolves when boot finished), bootInfo: { storageMode, storageReason, migration } } */
      function install(opts) {
        const o = opts || {};
        const bootInfo = o.bootInfo || {};
        const ready = o.ready || Promise.resolve(bootInfo);
        SPEECH.log = [];
        // P4 (DESIGN 8.4): ?test&adaptive=0 switches adaptation off for the page, so it survives reloads.
        if (/[?&]adaptive=0(&|$)/.test(window.location.search)) learning.setAdaptive(false);
        // Hook clicks are deliberate, so they skip the double-tap guard.
        const click = (el) => { dom.resetInputGuard(); if (el && !el.disabled) el.click(); return !!el; };
        const api = {
          /** A snapshot of the game state. */
          state() {
            const run = state.run, q = run && run.q;
            return {
              screen: state.screen,
              worldId: run ? run.worldId : (state.screen === 'complete' ? state.completeWorldId : null),
              missionIndex: run ? run.missionIndex : null,
              plan: run ? run.plan.slice() : null,
              typeId: q ? q.typeId : null,
              max: q ? q.max : null,
              answer: q ? q.answer : null,
              choices: q && q.choices ? q.choices.slice() : null,
              numbers: q ? Object.assign({}, q.numbers) : null,
              display: q ? q.display.slice() : null,
              speechText: q ? q.speech : null,
              starsThisRun: run ? run.stars : null,
              results: run ? run.results.slice() : null,
              firstTry: run ? run.firstTry : null,
              wrongCount: run ? run.wrongCount : null,
              buildCount: run ? run.buildCount : null,
              locked: run ? run.locked : null,
              activityId: q ? q.activityId : null,
              conceptId: q ? q.conceptId : null,
              difficulty: q ? q.difficulty : null,
              representation: q ? q.representation : null,
              questionId: q ? q.questionId : null,
              seed: q ? q.seed : null,
              template: q ? q.template : null,
              start: q && q.start !== undefined ? q.start : null,
              cap: q && q.cap !== undefined ? q.cap : null,
              decisionSource: run && run.slot ? run.slot.decisionSource : null,
              decision: run && run.slot && run.slot.decision ? JSON.parse(JSON.stringify(run.slot.decision)) : null,
              context: run ? (run.kind === 'check' ? 'assessment' : (run.kind === 'assignment' ? 'assignment' : 'play')) : null,
              runKind: run ? run.kind : null,                  // P5: 'world' | 'check'; P6: 'assignment'
              assignmentId: run && run.assignmentId ? run.assignmentId : null,
              sittingCount: run ? run.sittingCount : null,
              teacherOpen: !document.getElementById('teacher').hidden,
              total: run ? run.total : null,                   // 8 for worlds, 12 for a check
              checkRunId: run && run.checkRunId ? run.checkRunId : null,
              cellId: run && run.cellId ? run.cellId : null,
              adaptive: learning.isAdaptive(),
              sessionId: learning.currentSessionId(),
              heroId: screens.studentHeroId(),
              sound: prefs.get('sound'),
              playMs: elapsedPlayMs(),
              save: v1Save(),
              studentId: state.currentStudent ? state.currentStudent.id : null,
              storageMode: repo.mode,
              storageReason: repo.reason,
              storageState: repo.state,
              pendingWrites: learning.pendingWrites(),
              migration: bootInfo.migration ? JSON.parse(JSON.stringify(bootInfo.migration)) : null,
              bootStage: bootInfo.stage || null,
              symbolLeak: SPEECH.symbolLeak,
              hasSpeech: !!SPEECH.synth,
              hasAudio: !!AUDIO.ctx,
              u: (function () { const s = $('#stage'); return s ? parseFloat(s.style.getPropertyValue('--u')) || null : null; }())
            };
          },
          /** Every line passed to SPEECH.say (even when the engine is missing or muted). */
          speechLog: SPEECH.log,
          /** Multiply every game delay (tests use 0.05); also shortens CSS animations. */
          setSpeed(f) {
            dom.setSpeed(clamp(Number(f) || 1, 0.01, 1));
            guardInput(); // rescale a guard that is still running from the last screen
            document.documentElement.classList.toggle('nba-fast', dom.getSpeed() < 1);
          },
          /** Pretend this much play time has passed (starts the session clock if needed). */
          setPlayTime(ms) { state.session.startedAt = Date.now() - (Number(ms) || 0); },
          /** Jump to a screen: title | picker {firstRun} | home | story {worldId} | complete {worldId, stars, newBest}. */
          goto(screen, opts) {
            const o = opts || {};
            const worldId = worldById(o.worldId) ? o.worldId : WORLDS[0].id;
            leaveRun();
            state.run = null;
            if (screen === 'picker') { state.pickerFirstRun = !!o.firstRun; showScreen('picker'); }
            else if (screen === 'story') showScreen('story', { worldId: worldId });
            else if (screen === 'complete') {
              showScreen('complete', { worldId: worldId, stars: clamp(o.stars == null ? MISSIONS_PER_WORLD : o.stars, 0, MISSIONS_PER_WORLD), newBest: !!o.newBest });
            } else if (screen === 'title' || screen === 'home') showScreen(screen);
            // P5: check-intro {runId, locked, resumed} | check-end {runId}
            else if (screen === 'check-intro' || screen === 'check-end') showScreen(screen, { runId: o.runId || null, locked: !!o.locked, resumed: !!o.resumed });
            // P6: players {fromHome} | assignment-end {assignmentId}
            else if (screen === 'players') { state.playersFromHome = !!o.fromHome; showScreen('players'); }
            else if (screen === 'assignment-end') showScreen('assignment-end', { assignmentId: o.assignmentId || null });
            return state.screen;
          },
          /**
           * P5: play the current student's open Ninja Check (baseline first) on the mission screen,
           * skipping the intro; with none open, request one of `form` (default 'post') first.
           * Resolves with state(); runKind 'check'.
           */
          async startCheck(form) {
            const sid = state.currentStudent ? state.currentStudent.id : null;
            let open = assessments.openRuns()[0];
            if (!open && sid) {
              const r = await assessments.request(sid, form === 'baseline' ? 'baseline' : 'post', { createdBy: 'system' });
              open = r.created ? r.run : null;
            }
            leaveRun();
            state.run = null;
            if (!open || !missionUI.startCheck(assessments.begin(open.id))) return null;
            return api.state();
          },
          /** P6: the active students (the players screen list), oldest first, as plain copies. */
          async students() { await gameUI.refreshPlayers(); return JSON.parse(JSON.stringify(state.activeStudents || [])); },
          /** P6: make a student the current player (as the players screen does); resolves state(). */
          async selectStudent(id) { const s = await gameUI.selectStudent(id); if (!s) return null; await gameUI.refreshPlayers(); showScreen('home'); return api.state(); },
          /** P6: play an assignment of the current student on the mission screen (no Home tap); resolves state(). */
          async startAssignment(id) {
            const sid = state.currentStudent ? state.currentStudent.id : null;
            if (sid) await learning.loadStudent(sid);
            leaveRun();
            state.run = null;
            if (!missionUI.startAssignment(id)) return null;
            return api.state();
          },
          /** P6: open teacher mode on a tab, bypassing the gate (tests only; the gate itself is tested with real holds). */
          async openTeacher(tab, ctx) { leaveRun(); state.run = null; await teacherUI.openShell(tab || 'dashboard', ctx); return api.state(); },
          /** New run of a world, skipping the story, showing mission index i (0-7). */          startWorld(worldId, i) { startWorld(worldById(worldId) ? worldId : WORLDS[0].id, i || 0); return api.state(); },
          /**
           * Show a given question type with given numbers (mission 1 for max 10, mission 5 for max 20).
           * opts (V2, optional): { level: 1-4, template: 'take' | 'diff', seed }. A V2 activity plays in
           * the first world whose activity metadata lists it.
           */
          renderQuestion(typeId, numbers, max, opts) {
            const o = opts || {};
            const T = questionTypes.get(typeId);
            const level = o.level || generator.levelOf(tier(max || T.size(numbers)));
            const m = tier(catalog.tierOfLevel(level));
            const meta = catalog.activityById(typeId);
            const w = WORLDS.find((x) => generator.planTypes(x).indexOf(typeId) >= 0) ||
              (meta && worldById(meta.worlds[0])) || WORLDS[0];
            startRun(w.id);
            showMission(m === 20 ? 4 : 0, createQuestion(typeId, numbers, level, o.seed,
              { heroId: screens.currentHeroId(), template: o.template }));
            return api.state();
          },
          /** Make every new seed (questions and plans) come from rngFrom(n); null restores Math.random. */
          seed(n) { util.setSeedSource(n === null || n === undefined ? null : util.rngFrom(n)); return true; },
          /** Switch step 3 (adaptive) of the slot decision on or off for this page (DESIGN 8.4). */
          setAdaptive(on) { return learning.setAdaptive(on !== false); },
          /** The newest slot decisions of this page (at most 100), oldest first. */
          lastDecisions() { return learning.lastDecisions(); },
          /** Fix the clock used for timestamps and ids (ms), or null for the real clock. */
          setClock(ms) { util.setClock(ms); return util.now(); },
          /** Give the right answer through real DOM clicks. */
          answerCorrect() {
            const run = state.run;
            if (!run || !run.q || run.locked) return false;
            const q = run.q, mode = questionTypes.get(q.typeId).inputMode;
            if (mode === 'choices') return click($('.choice[data-value="' + q.answer + '"]'));
            if (mode === 'towers') return click($('.tower[data-value="' + q.answer + '"]'));
            let guard = 60;
            while (run.buildCount > q.answer && guard--) click($('[data-action="undo"]'));
            while (run.buildCount < q.answer && guard--) click($('[data-action="add-brick"]'));
            return click($('[data-action="done"]'));
          },
          /** Give a wrong answer through real DOM clicks. */
          answerWrong() {
            const run = state.run;
            if (!run || !run.q || run.locked) return false;
            const q = run.q, mode = questionTypes.get(q.typeId).inputMode;
            if (mode === 'choices') {
              return click($all('.choice').find((b) => !b.disabled && Number(b.getAttribute('data-value')) !== q.answer));
            }
            if (mode === 'towers') return click($('.tower[data-value="' + (1 - q.answer) + '"]'));
            if (run.buildCount === q.answer) click($('[data-action="add-brick"]'));
            return click($('[data-action="done"]'));
          },
          next() { return click($('#next-card [data-action="next"]')); },
          fit() { fitStage(); },
          /** Resolves (true) once every queued progress write has reached storage. */
          flush() { return learning.flush(); },
          /** Resolves with the boot info once storage is open and the title screen is shown. */
          ready() { return ready.then(() => api.state()); },
          /**
           * A fresh profile: clears every store, removes the v2 prefs key (so the next boot counts
           * as a first V2 run), never touches the v1 key, then creates and selects a new default
           * student. Returns a Promise; suites await it.
           */
          async resetSave() {
            await ready;
            leaveRun();
            state.run = null;
            await learning.flush();
            await repo.clearAll();
            prefs.remove();
            learning.reset();
            const s = await roster.ensureDefaultStudent();
            state.currentStudent = s;
            await learning.loadStudent(s.id);
            await gameUI.refreshPlayers();
            return s.id;
          },
          /** Direct storage access for the V2 suites (writes are validated by repo). */
          db: Object.freeze({
            count(store) { return repo.count(store); },
            getAll(store) { return repo.getAll(store); },
            put(store, rec) { return repo.put(store, rec); },
            /** P4: attempts are add-only, so planted attempts go through add. */
            add(store, rec) { return repo.add(store, rec); },
            clearAll() { return repo.clearAll(); }
          }),
          /** Tests only: plant or read a v1 save (the only V2 code that writes the v1 key). */
          v1: Object.freeze({
            get() { try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } },
            set(raw) { window.localStorage.setItem(STORAGE_KEY, String(raw)); },
            remove() { window.localStorage.removeItem(STORAGE_KEY); }
          })
        };
        Object.defineProperty(window, 'NBA_TEST', { value: Object.freeze(api), configurable: true });
      }

      return { install };
    });
}());
