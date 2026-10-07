/*
 * checkUI (L5): the child's Ninja Check (DESIGN 15.3, 16.2, 16.6, D8). Screens check-intro and
 * check-end, the action check-begin, and the check answer hook on the mission screen.
 *
 * Answering: the first number tap, tower tap or Done is the only submission. The input locks at
 * once; the child hears the v1 tap sound and sees the same neutral Next card after every answer
 * ("Got it! On to the next one.") - never a star, hint, shake, greyed button, wrong sound or the
 * right answer. +1 and Undo work as in play; only Done submits. The answer is saved with its run
 * (assessments.answer: one batch), so leaving and coming back resumes at the first unanswered item.
 * No scores, levels or results are shown to the child.
 *
 *   start(runId, { locked }?)  show check-intro for an open run of the current student
 *   tileRunId()                the run a Home Ninja Check tile opens (baseline first), or null
 *   lockedRunId()              the open baseline a world tile must open first (baselineRequired), or null
 */
(function () {
  'use strict';

  NBA.define('checkUI', ['config', 'util', 'dom', 'audio', 'speech', 'art', 'bricks', 'screens', 'assessments', 'missionUI'],
    (config, util, dom, audio, speech, art, bricks, screens, assessments, missionUI) => {
      const { TIMING } = config;
      const { esc } = util;
      const { $, later, replayClass } = dom;
      const { AUDIO } = audio;
      const { SPEECH } = speech;
      const { ICONS, faceHTML, iconBtn } = art;
      const { studsHTML } = bricks;
      const { state, currentHero, fill } = screens;

      /** The same line after every answer, right or wrong (D8). */
      const NEUTRAL_LINE = 'Got it! On to the next one.';

      missionUI.setCheckAnswerHandler((value, el) => {
        const run = state.run;
        if (!run || run.kind !== 'check' || !run.q || run.locked) return;
        run.locked = true; // one submission: nothing else is taken
        run.submitted.push(value);
        if (run.firstPerf === null) run.firstPerf = performance.now();
        AUDIO.play('tap');
        if (el) replayClass(el, 'pop');
        const rec = missionUI.currentAttempt('single');
        if (rec) assessments.answer(run.checkRun, run.cellId, value, rec);
        // P5-N3: never silent; the run stays open and resumes at this item (mission-ui never shows check-end for it)
        else { try { console.error('[NBA] Ninja Check answer not recorded (no session or student)'); } catch (e) { /* ignore */ } }
        const count = $('#progress');
        if (count) count.textContent = Object.keys(run.checkRun.answers).length + ' of ' + run.total;
        SPEECH.say(NEUTRAL_LINE);
        later(() => missionUI.showNextCard(NEUTRAL_LINE, false), TIMING.NEXT_CARD);
      });

      function introText(p) {
        if (p.resumed) return fill("Let's finish your Ninja Check! Just do your best, {hero}!");
        return fill((p.locked ? 'First, a quick Ninja Check!' : 'Time for a quick Ninja Check!') +
          ' 12 questions, one go at each. Just do your best, {hero}!');
      }

      function banner() {
        return '<div class="banner tile-white check-banner">' + studsHTML(5) + '<span class="tile-symbol">' + ICONS.tick + '</span>' +
          '<span class="banner-name">Ninja Check</span></div>';
      }

      screens.register('check-intro', {
        render(p) {
          return '<section class="screen story-screen check-screen" data-screen="check-intro"><header class="bar">' +
            iconBtn('home', 'home', 'Home') + '<h1 class="screen-title">Ninja Check</h1></header>' +
            '<div class="card story-card">' + banner() +
            '<div class="story-art">' + faceHTML(currentHero().id, 'story-hero') + '</div>' +
            '<p class="story-text">' + esc(introText(p)) + '</p>' +
            '<button type="button" class="big-btn btn-green go-btn" data-action="check-begin"><span>Start!</span>' + ICONS.next + '</button>' +
            '</div></section>';
        },
        after(sec, p) {
          state.checkIntroRunId = p.runId || null;
          later(() => SPEECH.say(introText(p)), TIMING.STORY_SPEAK);
        }
      });

      const END_LINE = 'Thanks, {hero}! Back to the academy.';
      screens.register('check-end', {
        render() {
          return '<section class="screen story-screen check-screen" data-screen="check-end"><header class="bar">' +
            '<h1 class="screen-title">Ninja Check</h1></header>' +
            '<div class="card story-card">' + banner() +
            '<div class="story-art">' + faceHTML(currentHero().id, 'story-hero') + '</div>' +
            '<p class="story-text"><strong>Ninja Check done!</strong> ' + esc(fill(END_LINE)) + '</p>' +
            '<button type="button" class="big-btn btn-green go-btn" data-action="home">' + ICONS.home + '<span>Home</span></button>' +
            '</div></section>';
        },
        after() {
          AUDIO.play('star');
          later(() => SPEECH.say('Ninja Check done! ' + fill(END_LINE)), TIMING.STORY_SPEAK);
        }
      });

      screens.registerActions({
        'check-begin'() {
          const run = assessments.begin(state.checkIntroRunId);
          if (!run || !missionUI.startCheck(run)) screens.show('home');
        }
      });

      /** Show the intro of an open run of the current student (Home otherwise). */
      function start(runId, opts) {
        const run = assessments.begin(runId);
        if (!run) { screens.show('home'); return false; }
        screens.show('check-intro', { runId: run.id, locked: !!(opts && opts.locked), resumed: Object.keys(run.answers).length > 0 });
        return true;
      }

      function tileRunId() { const r = assessments.openRuns()[0]; return r ? r.id : null; }
      function lockedRunId() { const r = assessments.lockedRun(state.currentStudent); return r ? r.id : null; }

      return { start, tileRunId, lockedRunId, NEUTRAL_LINE };
    });
}());
