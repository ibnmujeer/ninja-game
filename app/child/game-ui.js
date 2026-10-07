/*
 * gameUI (L5): the title, hero picker, Home, story and World Complete screens and their
 * actions (moved from v1 sections 9 and 10). Loaded after missionUI, so Go calls
 * missionUI.startWorld() directly.
 * P6 (DESIGN 16.2, 17.1): the "Who's playing?" screen (only with 2 or more active students), the
 * Home greeting with the student's name and "Change player", assignment tiles ("Special mission")
 * above the worlds with "x of y" from the learning cache, the assignment-end card, the Teacher
 * button (no data-action: a plain tap does nothing; main.js registers the hold with setTeacherHold)
 * and returnFromTeacher(). Every way into a world or an assignment goes through the baseline lock
 * (P5-N1). No teacher words reach the child: the button has only its aria-label.
 */
(function () {
  'use strict';

  NBA.define('gameUI',
    ['config', 'util', 'catalog', 'prefs', 'roster', 'learning', 'dom', 'audio', 'speech', 'art', 'bricks', 'screens', 'progression', 'missionUI', 'checkUI'],
    (config, util, catalog, prefs, roster, learning, dom, audio, speech, art, bricks, screens, progression, missionUI, checkUI) => {
      const { BAND_CYCLE, CONFETTI_COUNT, MISSIONS_PER_WORLD, REST_AFTER_MS, TIMING } = config;
      const { esc, randInt } = util;
      const { WORLDS, HEROES, REST_LINE, DEFAULT_HERO, heroById, worldById, worldIndex } = catalog;

      // A hero choice is saved on the student record and remembered as the last hero.
      screens.setHeroWriter((studentId, heroId) => {
        roster.setHero(studentId, heroId);
        prefs.set('lastHeroId', heroId);
      });
      const { $, $all, clearTimers, later, reducedMotion, replayClass } = dom;
      const { AUDIO } = audio;
      const { SPEECH } = speech;
      const { ICONS, faceHTML, villainHTML, iconBtn } = art;
      const { studsHTML } = bricks;
      const { state, currentHero, fill, elapsedPlayMs } = screens;
      const showScreen = screens.show;

      /** P6: the Teacher button hold (main.js registers teacherUI.attachHold); no button without it. */
      let teacherHold = null;
      function setTeacherHold(fn) { teacherHold = typeof fn === 'function' ? fn : null; }
      const manyPlayers = () => (state.activeStudents || []).length >= 2;

      /** Falling brick confetti for the win screen (clipped inside its own layer). */
      function confettiHTML() {
        if (reducedMotion()) return '';
        let html = '';
        for (let i = 0; i < CONFETTI_COUNT; i++) {
          html += '<i class="bit c-' + BAND_CYCLE[i % BAND_CYCLE.length] + '" style="left:' + randInt(2, 92) +
            '%;animation-delay:' + (Math.random() * 0.9).toFixed(2) + 's;animation-duration:' + (1.3 + Math.random()).toFixed(2) + 's"></i>';
        }
        return html;
      }

      screens.register('title', {
        render() {
          return '<section class="screen title-screen" data-screen="title">' +
            '<h1 class="game-name"><span class="name-1">' + studsHTML(6) + 'Number Builder</span>' +
            '<span class="name-2">' + studsHTML(6) + 'Ninja Brick Academy</span></h1>' +
            '<div class="title-art">' + faceHTML(currentHero().id, 'title-hero') + villainHTML('title-villain') + '</div>' +
            '<button type="button" class="big-btn btn-green play-btn" data-action="play">' + ICONS.play + '<span>Play!</span></button>' +
            '</section>';
        }
      });

      screens.register('picker', {
        render() {
          const chosen = screens.studentHeroId();
          const cards = HEROES.map((h) =>
            '<button type="button" class="hero-card' + (h.id === chosen ? ' chosen' : '') + '" data-action="hero" data-hero="' + h.id +
            '" aria-pressed="' + (h.id === chosen) + '">' + faceHTML(h.id, 'card-face') +
            '<span class="hero-name">' + esc(h.name) + '</span></button>').join('');
          return '<section class="screen picker-screen" data-screen="picker"><header class="bar">' +
            (state.pickerFirstRun ? '' : iconBtn('home', 'home', 'Home')) +
            '<h1 class="screen-title">Pick your hero!</h1></header>' +
            '<div class="hero-grid">' + cards + '</div></section>';
        }
      });

      /** P6 (16.2): one big button per active student: hero face plus the name (escaped). */
      screens.register('players', {
        render() {
          const cur = state.currentStudent;
          const cards = (state.activeStudents || []).map((s) => {
            const on = !!cur && s.id === cur.id;
            return '<button type="button" class="hero-card player-card' + (on ? ' chosen' : '') + '" data-action="player" data-student="' + esc(s.id) +
              '" aria-pressed="' + on + '">' + faceHTML(heroById(s.heroId) ? s.heroId : DEFAULT_HERO, 'card-face') +
              '<span class="hero-name">' + esc(s.name) + '</span></button>';
          }).join('');
          return '<section class="screen picker-screen players-screen" data-screen="players"><header class="bar">' +
            (state.playersFromHome ? iconBtn('home', 'home', 'Home') : '') +
            '<h1 class="screen-title">Who&#39;s playing?</h1></header>' +
            '<div class="hero-grid">' + cards + '</div></section>';
        }
      });

      /** P6 (16.2): "Special mission" tiles: open, not yet complete, oldest first; the first gets the badge. */
      function assignmentTiles() {
        return learning.homeAssignments().map((a, k) => {
          const p = learning.assignmentProgress(a.id);
          const prog = typeof a.questionCount === 'number' ? Math.min(p.count, a.questionCount) + ' of ' + a.questionCount
            : Math.min(Math.floor(p.totalMs / 60000), a.targetMinutes) + ' of ' + a.targetMinutes + ' minutes';
          const title = 'Special mission: ' + a.name;
          return '<button type="button" class="world-tile tile-white assignment-tile' + (k === 0 ? ' suggested' : '') +
            '" data-action="assignment" data-assignment="' + esc(a.id) + '" aria-label="' + esc(title + ', ' + prog) + '">' +
            studsHTML(4) + '<span class="tile-symbol">' + ICONS.star + '</span>' +
            '<span class="tile-text"><span class="tile-name">' + esc(title) + '</span><span class="tile-op">' + esc(prog) + '</span></span>' +
            (k === 0 ? '<span class="badge">Next!</span>' : '') + '</button>';
        });
      }

      screens.register('home', {
        render() {
          const extra = assignmentTiles();
          const suggested = extra.length ? null : progression.suggestedWorldId(); // only one badge on Home
          const tiles = WORLDS.map((w, i) => {
            const best = progression.best(w.id);
            const isNext = w.id === suggested;
            return '<button type="button" class="world-tile tile-' + w.colour + (isNext ? ' suggested' : '') +
              '" data-action="world" data-world="' + w.id + '" aria-label="' + esc(w.name + ', ' + best + ' of ' + MISSIONS_PER_WORLD + ' stars') + '">' +
              studsHTML(4) + '<span class="tile-symbol">' + esc(w.symbol) + '</span>' +
              '<span class="tile-text outlined"><span class="tile-name">' + esc(w.name) + '</span>' +
              '<span class="tile-op">World ' + (i + 1) + ': ' + esc(w.op) + '</span></span>' +
              '<span class="stars-count">' + ICONS.star + '<span>' + best + '/' + MISSIONS_PER_WORLD + '</span></span>' +
              (isNext ? '<span class="badge">Next!</span>' : '') + '</button>';
          }).join('');
          // P5 (DESIGN 16.2): a Ninja Check tile above the worlds while a check is waiting (R3: from the cache)
          const checkId = checkUI.tileRunId();
          if (checkId) {
            extra.unshift('<button type="button" class="world-tile tile-white check-tile" data-action="check" data-run="' + esc(checkId) +
              '" aria-label="Ninja Check">' + studsHTML(4) + '<span class="tile-symbol">' + ICONS.tick + '</span>' +
              '<span class="tile-text"><span class="tile-name">Ninja Check</span><span class="tile-op">12 quick questions</span></span></button>');
          }
          const on = prefs.get('sound');
          const many = manyPlayers() && state.currentStudent;
          const listClass = extra.length >= 2 ? ' has-extra has-extra-2' : (extra.length ? ' has-extra' : '');
          return '<section class="screen home-screen" data-screen="home"><header class="bar">' +
            faceHTML(currentHero().id, 'home-hero') + '<span class="hello">Hi, ' + esc(many ? state.currentStudent.name : currentHero().name) + '!</span>' +
            (many ? iconBtn('change-player', 'players', 'Change player') : '') +
            iconBtn('picker', 'swap', 'Change hero') +
            iconBtn('sound', on ? 'soundOn' : 'soundOff', on ? 'Sound on' : 'Sound off', ' aria-pressed="' + on + '"') +
            '</header><h1 class="home-title">Ninja Brick Academy</h1><div class="world-list' + listClass + '">' +
            extra.join('') + tiles + '</div>' +
            (teacherHold ? '<div class="home-foot"><button type="button" class="teacher-btn" aria-label="Teacher mode">' + ICONS.teacher + '</button></div>' : '') +
            '</section>';
        },
        after(sec) {
          const b = $('.teacher-btn', sec);
          if (b && teacherHold) teacherHold(b); // listeners live on this button only (DESIGN 17.1)
        }
      });

      screens.register('story', {
        render(p) {
          const w = worldById(p.worldId);
          return '<section class="screen story-screen" data-screen="story" data-world="' + w.id + '"><header class="bar">' +
            iconBtn('home', 'home', 'Home') + '<h1 class="screen-title">World ' + (worldIndex(w.id) + 1) + ' of ' + WORLDS.length + '</h1></header>' +
            '<div class="card story-card">' +
            '<div class="banner tile-' + w.colour + '">' + studsHTML(5) + '<span class="tile-symbol">' + esc(w.symbol) + '</span>' +
            '<span class="banner-name outlined">' + esc(w.name) + '</span></div>' +
            '<div class="story-art">' + faceHTML(currentHero().id, 'story-hero') + villainHTML('story-villain') + '</div>' +
            '<p class="story-text">' + esc(fill(w.story)) + '</p>' +
            '<button type="button" class="big-btn btn-green go-btn" data-action="go"><span>Go!</span>' + ICONS.next + '</button>' +
            '</div></section>';
        },
        after(sec, p) {
          state.storyWorldId = p.worldId;
          later(() => SPEECH.say(fill(worldById(p.worldId).story)), TIMING.STORY_SPEAK);
        }
      });

      screens.register('complete', {
        render(p) {
          const w = worldById(p.worldId);
          const next = WORLDS[worldIndex(w.id) + 1];
          let stars = '';
          for (let k = 0; k < MISSIONS_PER_WORLD; k++) stars += '<span class="star' + (k < p.stars ? ' on' : '') + '">' + ICONS.star + '</span>';
          return '<section class="screen complete-screen" data-screen="complete" data-world="' + w.id + '">' +
            '<div class="confetti" aria-hidden="true">' + confettiHTML() + '</div>' +
            faceHTML(currentHero().id, 'win-hero') +
            '<h1 class="win-title">World complete!</h1>' +
            '<div id="win-stars" class="win-stars">' + stars + '</div>' +
            '<p class="win-count">' + p.stars + ' of ' + MISSIONS_PER_WORLD + ' stars</p>' +
            (p.newBest ? '<p id="new-best" class="new-best">New best!</p>' : '') +
            '<p class="win-line">' + esc(fill(w.win)) + '</p>' +
            (w.finale ? '<p id="master-line" class="master-line">' + esc(fill(w.finale)) + '</p>' : '') +
            (elapsedPlayMs() >= REST_AFTER_MS ? '<p id="rest-line" class="rest-line">' + esc(REST_LINE) + '</p>' : '') +
            '<div class="win-buttons">' +
            (next ? '<button type="button" class="big-btn btn-green wide" data-action="nextworld"><span>Next world</span>' + ICONS.next + '</button>' : '') +
            '<button type="button" class="big-btn btn-yellow" data-action="again">' + ICONS.again + '<span>Play again</span></button>' +
            '<button type="button" class="big-btn btn-white" data-action="home">' + ICONS.home + '<span>Home</span></button>' +
            '</div></section>';
        },
        after(sec, p) {
          state.completeWorldId = p.worldId;
          const w = worldById(p.worldId);
          const lines = [fill(w.win)];
          if (w.finale) lines.push(fill(w.finale));
          if (elapsedPlayMs() >= REST_AFTER_MS) lines.push(REST_LINE);
          AUDIO.play('fanfare');
          later(() => SPEECH.say(lines.join(' ')), TIMING.STORY_SPEAK);
          later(() => { const c = $('.confetti', sec); if (c) c.remove(); }, TIMING.CONFETTI);
        }
      });

      /** P6 (16.2, 16.6): the end of an assignment sitting. Play again only while it is still incomplete. */
      const ASSIGNMENT_END = 'Great work, {hero}!';
      screens.register('assignment-end', {
        render(p) {
          const a = learning.assignment(p.assignmentId);
          const again = learning.homeAssignments().some((x) => x.id === p.assignmentId);
          return '<section class="screen story-screen assignment-end-screen" data-screen="assignment-end"><header class="bar">' +
            '<h1 class="screen-title">Special mission</h1></header>' +
            '<div class="card story-card"><div class="banner tile-white check-banner">' + studsHTML(5) +
            '<span class="tile-symbol">' + ICONS.star + '</span><span class="banner-name">' + esc(a ? a.name : 'Special mission') + '</span></div>' +
            '<div class="story-art">' + faceHTML(currentHero().id, 'story-hero') + '</div>' +
            '<p class="story-text"><strong>Special mission done!</strong> ' + esc(fill(ASSIGNMENT_END)) + '</p>' +
            '<div class="win-buttons">' +
            (again ? '<button type="button" class="big-btn btn-yellow" data-action="assignment" data-assignment="' + esc(p.assignmentId) + '">' +
              ICONS.again + '<span>Play again</span></button>' : '') +
            '<button type="button" class="big-btn btn-green" data-action="home">' + ICONS.home + '<span>Home</span></button>' +
            '</div></div></section>';
        },
        after() {
          AUDIO.play('star');
          later(() => SPEECH.say('Special mission done! ' + fill(ASSIGNMENT_END)), TIMING.STORY_SPEAK);
        }
      });

      /** P5-N1: every way into a world or assignment opens a waiting required baseline first. */
      function lockedOpen() {
        const locked = checkUI.lockedRunId();
        if (locked) { checkUI.start(locked, { locked: true }); return true; }
        return false;
      }

      /** P6: refresh the active students the players screen lists (boot, return from teacher mode, tests). */
      async function refreshPlayers() {
        try { state.activeStudents = await roster.activeStudents(); } catch (e) { state.activeStudents = state.currentStudent ? [state.currentStudent] : []; }
        return state.activeStudents;
      }

      /** P6: make an active student the current player: their hero, stars and learning cache. */
      async function selectStudent(id) {
        let s = (state.activeStudents || []).find((x) => x.id === id) || null;
        if (!s) { try { s = await roster.get(id); } catch (e) { s = null; } }
        if (!s || s.status !== 'active') return null;
        missionUI.leaveRun();
        state.run = null;
        await learning.loadStudent(s.id);
        state.currentStudent = s;
        prefs.set('lastStudentId', s.id);
        if (s.heroId) prefs.set('lastHeroId', s.heroId);
        return s;
      }

      /**
       * P6 (17.1): back from teacher mode. The current student is read again (it may have been edited),
       * replaced by another active student or the default when archived or deleted (17.2), its learning
       * cache reloaded, then Home is shown.
       */
      async function returnFromTeacher() {
        const cur = state.currentStudent;
        let s = null;
        try { s = await roster.ensurePlayer(cur ? cur.id : null); } catch (e) { s = cur; }
        await refreshPlayers();
        if (s) {
          await learning.loadStudent(s.id);
          state.currentStudent = s;
          prefs.set('lastStudentId', s.id);
        }
        state.run = null;
        showScreen('home');
        return s;
      }

      screens.registerActions({
        play() {
          AUDIO.unlock();
          if (!state.session.startedAt) state.session.startedAt = Date.now();
          if (manyPlayers()) { // P6 (D4): "Who's playing?" only with 2 or more active students
            state.playersFromHome = false;
            showScreen('players');
            SPEECH.say("Who's playing?", { now: true });
            return;
          }
          state.pickerFirstRun = !screens.studentHeroId();
          showScreen(state.pickerFirstRun ? 'picker' : 'home');
          // Spoken inside the tap: this also unlocks speech on iOS.
          SPEECH.say(state.pickerFirstRun ? 'Pick your hero!' : "Let's go, " + currentHero().name + '!', { now: true });
        },
        player(el) {
          const id = el.getAttribute('data-student');
          $all('.player-card').forEach((c) => { c.disabled = true; });
          selectStudent(id).then((s) => {
            if (!s) { showScreen('players'); return; }
            state.pickerFirstRun = !screens.studentHeroId();
            showScreen(state.pickerFirstRun ? 'picker' : 'home');
            SPEECH.say(state.pickerFirstRun ? 'Pick your hero!' : "Let's go, " + currentHero().name + '!');
          });
        },
        'change-player'() {
          missionUI.leaveRun();
          state.playersFromHome = true;
          showScreen('players');
          SPEECH.say("Who's playing?");
        },
        hero(el) {
          const h = heroById(el.getAttribute('data-hero'));
          if (!h) return;
          clearTimers(); // a second quick pick restarts the wait
          screens.setHero(h.id);
          $all('.hero-card').forEach((c) => {
            c.classList.toggle('chosen', c === el);
            c.setAttribute('aria-pressed', String(c === el));
          });
          replayClass(el, 'pop');
          AUDIO.play('star');
          SPEECH.say('You picked ' + h.name + '!');
          state.pickerFirstRun = false;
          later(() => showScreen('home'), TIMING.PICK_TO_HOME);
        },
        home() { missionUI.leaveRun(); showScreen('home'); }, // leaving a run records an abandoned question, ends the session
        picker() { state.pickerFirstRun = false; showScreen('picker'); },
        sound(el) {
          const on = !prefs.get('sound');
          prefs.set('sound', on);
          el.setAttribute('aria-pressed', String(on));
          el.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
          el.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
          if (on) { AUDIO.play('tap'); SPEECH.say('Sound on!'); } else SPEECH.cancel();
        },
        world(el) {
          // P5 (DESIGN 15.4): a student whose baseline is still waiting plays it before the worlds
          if (lockedOpen()) return;
          const w = worldById(el.getAttribute('data-world'));
          if (w) showScreen('story', { worldId: w.id });
        },
        check(el) { checkUI.start(el.getAttribute('data-run')); },
        assignment(el) {
          if (lockedOpen()) return; // DESIGN 15.4: the baseline comes before assignments too
          if (!missionUI.startAssignment(el.getAttribute('data-assignment'))) showScreen('home');
        },
        go() { if (!lockedOpen()) missionUI.startWorld(state.storyWorldId || WORLDS[0].id, 0); },
        again() { if (!lockedOpen()) showScreen('story', { worldId: state.completeWorldId || WORLDS[0].id }); },
        nextworld() {
          if (lockedOpen()) return;
          const next = WORLDS[worldIndex(state.completeWorldId) + 1];
          if (next) showScreen('story', { worldId: next.id });
        }
      }, ['hero', 'sound']);

      return { setTeacherHold, hasTeacherHold: () => !!teacherHold, returnFromTeacher, selectStudent, refreshPlayers };
    });
}());
