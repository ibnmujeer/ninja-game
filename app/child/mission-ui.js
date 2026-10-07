/*
 * missionUI (L5): the mission screen, a world run, answers, hints, the Next card and the build
 * controls (v1 sections 9 and 10). World Complete and check-end are shown by name (screens.show).
 * P3/P4 (DESIGN 8.1, 11, 14.5, 16.5): each slot is decided in showMission(i) from the learning cache
 * (no data or adaptation off: the v1 type at the v1 level), questions are seeded, and every answered
 * question is recorded as an attempt (on the correct answer, or 'abandoned' on leaving after a wrong
 * one). A run opens a session at its first question and closes it at the end or on leaving; writes
 * go through the learning queue, so the child flow never waits for storage.
 * P5/P6 (DESIGN 16.6): run.kind 'check' (a Ninja Check; answers go to assessment-ui's hook) and
 * 'assignment' (a "Special mission": no stars or worldProgress) use the same screen and actions;
 * what differs per kind (header, counter, last question, session, missionId) is in runKinds.
 */
(function () {
  'use strict';

  NBA.define('missionUI',
    ['config', 'util', 'catalog', 'dom', 'audio', 'speech', 'art', 'bricks', 'screens', 'questionTypes', 'generator',
      'assessmentEngine', 'learningEngine', 'learning', 'renderers', 'progression', 'runKinds'],
    (config, util, catalog, dom, audio, speech, art, bricks, screens, questionTypes, generator,
      assessmentEngine, learningEngine, learning, renderers, progression, runKinds) => {
      const { MISSIONS_PER_WORLD, TIMING, COL_ROWS } = config;
      const { clamp, esc, pick, repeat } = util;
      const { WORLDS, worldById, PRAISE, ENCOURAGE } = catalog;
      const { $, $all, later, reducedMotion, replayClass, guardInput } = dom;
      const { AUDIO } = audio;
      const { SPEECH, forSpeech } = speech;
      const { ICONS, faceHTML, iconBtn } = art;
      const { brickHTML, fitStage } = bricks;
      const { state, currentHero, fill } = screens;

      const progressHTML = runKinds.progressHTML; // the 8-brick bar, or the "4 of 12" counter (DESIGN 16.6)

      /** The Next card overlay shown after a correct answer (the praise is announced politely). */
      function nextCardHTML(praise, gotStar, last) {
        return '<div id="next-card" class="overlay"><div class="card next-box">' +
          '<p class="praise" aria-live="polite">' + esc(praise) + '</p>' +
          (gotStar ? '<p class="got-star">' + ICONS.star + '<span>+1 star!</span></p>' : '') +
          '<button type="button" class="big-btn btn-green" data-action="next"><span>' + (last ? 'Finish' : 'Next') + '</span>' +
          ICONS.next + '</button></div></div>';
      }

      const inputModeOf = (q) => questionTypes.get(q.typeId).inputMode;

      screens.register('mission', {
        render() {
          const run = state.run, q = run.q, check = run.kind === 'check', asg = run.kind === 'assignment';
          const mode = inputModeOf(q);
          const { title, label } = runKinds.header(run);
          let answers = '';
          if (mode === 'choices') {
            answers = q.choices.map((v) => '<button type="button" class="choice" data-action="answer" data-value="' + v + '">' + v + '</button>').join('');
          } else if (mode === 'build') {
            answers = '<div id="build-controls" class="build-controls">' +
              '<button type="button" class="ctl ctl-add" data-action="add-brick" aria-label="Add one brick">+1</button>' +
              '<button type="button" class="ctl ctl-undo" data-action="undo" aria-label="Undo" disabled>' + ICONS.undo + '</button>' +
              '<button type="button" class="ctl ctl-done" data-action="done">' + ICONS.tick + '<span>Done</span></button></div>';
          }
          return '<section class="screen mission mode-' + mode + (check ? ' kind-check' : (asg ? ' kind-assignment' : '')) + '" data-screen="mission" data-type="' + q.typeId + '"><header class="bar">' +
            iconBtn('home', 'home', 'Home') +
            '<div class="mission-title"><span class="world-name">' + title + '</span>' +
            '<span class="mission-no">' + label + '</span></div>' +
            faceHTML(currentHero().id, '', ' id="mission-hero"') +
            iconBtn('replay', 'speaker', 'Hear the question again') + '</header>' +
            progressHTML(run) +
            '<h2 id="q-text">' + q.display.map((l) => '<span class="q-line">' + esc(l) + '</span>').join('') + '</h2>' +
            '<div id="stage" class="stage"></div>' +
            '<p id="hint" class="hint" aria-live="polite" hidden></p>' +
            '<div id="answers" class="answers"' + (mode === 'towers' ? ' hidden' : '') + '>' + answers + '</div>' +
            '</section>';
        },
        after(sec) {
          const q = state.run.q, T = questionTypes.get(q.typeId);
          const stage = $('#stage', sec);
          stage._fit = T.render(stage, q);
          fitStage();
          if (T.inputMode === 'build') updateBuildControls(); // Undo on exactly when buildCount > 0
          if (T.afterShow) T.afterShow(stage, q);
          later(() => SPEECH.say(q.speech), TIMING.QUESTION_SPEAK);
        }
      });

      /* ---------- attempt capture (DESIGN 11) ---------- */
      const studentId = () => (state.currentStudent ? state.currentStudent.id : null);

      /**
       * The attempt record of the current question, built once: 'correct', or 'abandoned' after a wrong
       * answer; in a Ninja Check the single answer (assessmentEngine.attemptParts: no hint, no star).
       */
      function attemptRecord(kind) {
        const run = state.run;
        if (!run || !run.q || run.recorded || !run.sessionId || !studentId()) return null;
        if (!run.submitted.length) return null; // no answer: nothing to record
        run.recorded = true;
        // From input accepted (the end of the input guard) to the first and the last answer. A test
        // hook tap can come before the guard ends (it resets the guard), so the time is at least 0.
        const times = learningEngine.responseTimes({
          readyPerf: run.readyPerf, firstPerf: run.firstPerf, nowPerf: performance.now(),
          hiddenBeforeFirst: run.hiddenBeforeFirst, hidden: run.wasHidden
        });
        const base = { id: util.newId('att'), now: util.now(), studentId: studentId(), sessionId: run.sessionId, speed: dom.getSpeed() };
        const timing = { shownAt: run.shownAt, responseMs: times.responseMs, totalMs: times.totalMs };
        if (run.kind === 'check') {
          const parts = assessmentEngine.attemptParts(run.checkRun, run.cellId, run.submitted[0]);
          return learningEngine.buildAttempt(run.q, Object.assign(timing, parts.outcome), Object.assign(base, parts.ctx));
        }
        return learningEngine.buildAttempt(run.q, Object.assign(timing, {
          outcome: kind, submittedAnswers: run.submitted, hintsShown: run.hintsShown,
          starEarned: kind === 'correct' ? run.firstTry : false
        }), Object.assign(base, runKinds.attemptWhere(run), {
          missionIndex: run.missionIndex,
          decisionSource: run.slot.decisionSource, decision: run.slot.decision, mixed: run.slot.mixed, leadConcepts: run.slot.leadConcepts
        }));
      }

      /** Record the current world question once (see attemptRecord). */
      function recordCurrent(kind) {
        const rec = attemptRecord(kind);
        if (rec) learning.recordAttempt(rec);
        return rec;
      }

      /**
       * The child leaves the run (Home, a new run, change of student or pagehide): a question with
       * a wrong answer and no right one is recorded as abandoned, then the session ends.
       */
      function leaveRun() {
        const run = state.run;
        if (!run) return;
        if (run.q && !run.locked) recordCurrent('abandoned');
        if (run.sessionId) { learning.endSession(); run.sessionId = null; }
      }

      /** Page hidden (main.js): totalMs becomes null, responseMs too before the first answer (P3-N1). */
      function noteHidden() {
        const run = state.run;
        if (!run) return;
        run.wasHidden = true;
        if (run.firstPerf === null) run.hiddenBeforeFirst = true;
      }

      /** Start a fresh run of a world (no screen change). */
      function startRun(worldId) {
        leaveRun();
        const w = worldById(worldId) || WORLDS[0];
        state.run = {
          worldId: w.id,
          plan: generator.buildPlan(w, util.rngFrom(util.newSeed())), // 8 question type ids (the v1 slot labels)
          missionIndex: 0,
          results: repeat(null, MISSIONS_PER_WORLD), // null | 'done' | 'star' (drives the progress bar)
          stars: 0,                                  // stars this run
          prevBest: progression.best(w.id),          // for "New best!"
          used: new Set(),                           // question keys already shown this run
          q: null, firstTry: true, wrongCount: 0, locked: false, buildCount: 0,
          kind: 'world', sessionId: null, slot: null,
          checkRunId: null, total: MISSIONS_PER_WORLD, sittingCount: 0, // DESIGN 16.6
          activities: []                              // activity shown in each slot so far (the variety rule)
        };
        return state.run;
      }

      /** P5: a check run of the live record (assessments.begin), from the first unanswered cell; false: none. */
      function startCheck(checkRun) {
        leaveRun();
        const first = checkRun ? assessmentEngine.resumeCell(checkRun) : null;
        if (!first) return false;
        state.run = runKinds.newCheckRun(checkRun);
        showMission(checkRun.items.findIndex((it) => it.cellId === first));
        return true;
      }

      /**
       * P6 (16.6, 17.6): an assignment run of the loaded student, from its attempts so far (R3: the
       * cache), so the rotation and missionId <assignmentId>.q<i> continue across sittings. No stars,
       * no worldProgress. false: not open, or nothing left to play.
       */
      function startAssignment(assignmentId) {
        const a = learning.assignment(assignmentId);
        if (!a || a.status !== 'open') return false;
        leaveRun();
        const start = learning.assignmentProgress(a.id).count;
        state.run = runKinds.newAssignmentRun(a, start);
        if (state.run.total !== null && start >= state.run.total) { state.run = null; return false; }
        showMission(start);
        return true;
      }
      const isLast = runKinds.isLast;

      function startWorld(worldId, missionIndex) {
        startRun(worldId);
        showMission(clamp(missionIndex || 0, 0, MISSIONS_PER_WORLD - 1));
      }

      /**
       * Show mission i of the current run: a new seeded question for the slot decision
       * (learning.decideSlotFor: override, adaptive or v1 default) unless one is given (the test
       * hook). A given question records decisionSource 'default', decision null, with its own concept
       * plus the range concept (R6); a world 5 add/sub slot also credits addsub.mixed.
       */
      function showMission(i, givenQ) {
        const run = state.run;
        if (run.q && !run.locked) recordCurrent('abandoned');
        run.missionIndex = i;
        if (run.kind === 'check') {
          // the stored instance (DESIGN 15.2): the same numbers, seed and button order on every visit
          const item = run.checkRun.items[i];
          run.cellId = item.cellId;
          run.q = assessmentEngine.questionFor(item, screens.currentHeroId());
          run.slot = { decisionSource: 'assessment', decision: null, mixed: false, leadConcepts: [item.conceptId] };
        } else if (givenQ) {
          run.q = givenQ; // R6: no slot decision for a test-given question
          run.slot = { decisionSource: 'default', decision: null, mixed: false, leadConcepts: [] };
        } else {
          // P4 (DESIGN 14.5): assignment > override > adaptive > v1 default, from the in-memory cache only;
          // P6: an assignment run is decided entirely by the assignment (14.8, R9 b variety when both Auto)
          const d = run.kind === 'assignment' ? learning.decideAssignmentFor(run, i) : learning.decideSlotFor(run, i);
          run.q = generator.generate(d.activityId, d.difficulty, run.used, util.newSeed(),
            { heroId: screens.currentHeroId(), template: d.template, exclude: learning.recentExclude(d.activityId) });
          run.slot = { decisionSource: d.decisionSource, decision: d.decision, mixed: d.mixed, leadConcepts: d.leadConcepts };
        }
        run.used.add(run.q.key);
        run.activities.push(run.q.activityId);
        run.firstTry = true;
        run.wrongCount = 0;
        run.locked = false;
        run.buildCount = run.q.start || 0;
        run.submitted = [];
        run.hintsShown = 0;
        run.recorded = false;
        run.wasHidden = false;
        run.hiddenBeforeFirst = false;
        run.firstPerf = null;
        run.sittingCount++;
        if (!run.sessionId && studentId()) run.sessionId = learning.startSession(runKinds.sessionArgs(run, studentId()));
        run.shownAt = util.now();
        screens.show('mission');
        run.readyPerf = Math.max(performance.now(), dom.inputReadyAt());
      }

      /**
       * Handle an answer: a number button, a tower (value = 0/1) or Done (value =
       * bricks built). Wrong: shake, soft sound, hint, grey out the button. No
       * timer, lives or score loss. Correct: happy sound, praise, progress brick,
       * then the Next card.
       */
      function onAnswer(value, el) {
        const run = state.run;
        if (!run || !run.q || run.locked) return;
        if (run.kind === 'check') { // P5 (DESIGN 16.6): one submission, neutral feedback (assessment-ui)
          if (checkAnswerHandler) checkAnswerHandler(value, el);
          else { try { console.error('[NBA] check answer handler missing'); } catch (e) { /* ignore */ } }
          return;
        }
        const q = run.q;
        const mode = inputModeOf(q);
        run.submitted.push(value);
        if (run.firstPerf === null) run.firstPerf = performance.now();

        if (value !== q.answer) {
          run.firstTry = false;
          run.wrongCount++;
          if (mode === 'build') {
            replayClass(el, 'shake', TIMING.SHAKE); // Done stays usable
          } else {
            el.classList.add('shake', 'used');
            el.disabled = true;
          }
          AUDIO.play('wrong');
          showHint();
          return;
        }

        run.locked = true;
        const world = run.kind === 'world'; // P6 (16.6): an assignment gets v1 feedback without the star and the brick drop
        const star = world && run.firstTry;
        if (world) {
          if (star) run.stars++;
          run.results[run.missionIndex] = star ? 'star' : 'done';
          progression.saveBest(run.worldId, run.stars); // saved after every mission
        }
        recordCurrent('correct');
        AUDIO.play('correct');
        if (star) later(() => AUDIO.play('star'), TIMING.STAR_SOUND);
        el.classList.add('pop', 'right');
        const pb = world ? $all('#progress .pbrick')[run.missionIndex] : $('#progress');
        if (pb && world) {
          pb.className = 'pbrick filled c-' + worldById(run.worldId).colour + (star ? ' star' : '') + ' drop';
          pb.innerHTML = star ? ICONS.star : '';
        } else if (pb) pb.textContent = runKinds.counterText(run);
        replayClass($('#mission-hero'), 'bounce', TIMING.BOUNCE);
        const praise = fill(pick(PRAISE));
        SPEECH.say(praise);
        later(() => showNextCard(praise, star), TIMING.NEXT_CARD);
      }

      /** Show (and say) a hint that uses this question's numbers. */
      function showHint() {
        const run = state.run, q = run.q;
        const box = $('#hint');
        if (!box) return;
        const text = pick(ENCOURAGE) + ' ' + questionTypes.get(q.typeId).hint(q, run.wrongCount, run);
        box.textContent = text;
        box.hidden = false;
        run.hintsShown++;
        replayClass(box, 'pop');
        fitStage(); // the hint takes room from the stage
        SPEECH.say(forSpeech(text));
      }

      function showNextCard(praise, star) {
        const sec = $('.screen[data-screen="mission"]');
        if (!sec || $('#next-card')) return;
        sec.insertAdjacentHTML('beforeend', nextCardHTML(praise, star, isLast(state.run)));
        guardInput();
      }

      function nextMission() {
        const run = state.run;
        if (!run || !run.locked) return;
        if (run.kind !== 'world') {
          // R4: a check goes to the next unanswered cell in blueprint order; P6: an assignment sitting to its last question
          const next = run.kind === 'check' ? assessmentEngine.nextCell(run.checkRun, run.cellId) : null;
          if (next) { showMission(run.checkRun.items.findIndex((it) => it.cellId === next)); return; }
          if (run.kind === 'assignment' && !isLast(run)) { showMission(run.missionIndex + 1); return; }
          leaveRun();
          state.run = null;
          if (run.kind === 'assignment') { screens.show('assignment-end', { assignmentId: run.assignmentId }); return; }
          // P5-N3: an answer that was not recorded leaves the run open: never show "done" for it silently
          if (assessmentEngine.resumeCell(run.checkRun) !== null) {
            try { console.error('[NBA] Ninja Check ended with unrecorded answers; the run stays open'); } catch (e) { /* ignore */ }
            screens.show('home');
            return;
          }
          screens.show('check-end', { runId: run.checkRunId });
          return;
        }
        if (run.missionIndex >= MISSIONS_PER_WORLD - 1) completeWorld();
        else showMission(run.missionIndex + 1);
      }

      function completeWorld() {
        const run = state.run;
        progression.saveComplete(run.worldId, run.stars);
        leaveRun();
        const p = { worldId: run.worldId, stars: run.stars, newBest: run.stars > run.prevBest };
        state.run = null;
        screens.show('complete', p);
      }

      /* ---------- build-mode controls: +1 adds a brick, Undo removes the top one ---------- */
      const buildable = (run) => !!run && !run.locked && !!run.q && inputModeOf(run.q) === 'build';

      function addBrick() {
        const run = state.run;
        if (!buildable(run) || run.buildCount >= run.q.cap) return;
        const i = run.buildCount;
        const col = $all('#stage .build-stack .col')[Math.floor(i / COL_ROWS)];
        if (!col) return;
        col.insertAdjacentHTML('beforeend', brickHTML(renderers.brickColour(run.q, i), reducedMotion() ? '' : 'drop', ' data-i="' + i + '"'));
        run.buildCount++;
        AUDIO.play('place', run.buildCount); // pitch rises as the tower grows
        updateBuildControls();
      }

      function undoBrick() {
        const run = state.run;
        if (!buildable(run) || run.buildCount <= 0) return;
        const all = $all('#stage .build-stack .brick');
        if (all.length) all[all.length - 1].remove();
        run.buildCount--;
        AUDIO.play('undo');
        updateBuildControls();
      }

      function updateBuildControls() {
        const run = state.run;
        const add = $('[data-action="add-brick"]'), undo = $('[data-action="undo"]');
        if (add) add.disabled = run.buildCount >= run.q.cap;
        if (undo) undo.disabled = run.buildCount <= 0;
      }

      screens.registerActions({
        replay() { if (state.run && state.run.q) SPEECH.say(state.run.q.speech); },
        answer(el) { onAnswer(Number(el.getAttribute('data-value')), el); },
        tower(el) { onAnswer(Number(el.getAttribute('data-value')), el); },
        'add-brick'() { addBrick(); },
        undo() { undoBrick(); },
        done(el) { if (state.run) onAnswer(state.run.buildCount, el); },
        next() { nextMission(); }
      }, ['answer', 'tower', 'add-brick', 'undo', 'done']);

      /** assessment-ui registers the check answer hook in its factory (main.js checks it at boot). */
      let checkAnswerHandler = null;
      function setCheckAnswerHandler(fn) { checkAnswerHandler = typeof fn === 'function' ? fn : null; }

      return {
        startRun, startWorld, startAssignment, showMission, leaveRun, noteHidden,
        startCheck, currentAttempt: attemptRecord, showNextCard, setCheckAnswerHandler, hasCheckAnswerHandler: () => !!checkAnswerHandler
      };
    });
}());
