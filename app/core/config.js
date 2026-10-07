/*
 * config (L2): palette, sizes, timings and limits (moved from v1 section 1).
 * Text lines, heroes and worlds are data (app/data/*.js), looked up through catalog.
 */
(function () {
  'use strict';

  NBA.define('config', [], () => {
    /** Brick colours (the same values are CSS variables in :root). */
    const PALETTE = {
      red: '#e3000b', blue: '#0057c8', yellow: '#ffd500', green: '#00a03c', orange: '#ff7e14',
      black: '#1d1d1d', white: '#ffffff', grey: '#a4a8ad', gold: '#f2b705', skin: '#ffd23f', sky: '#dff3ff'
    };
    /** Towers change colour every 5 bricks to make counting easier. */
    const BAND_CYCLE = ['red', 'blue', 'yellow', 'green', 'orange'];
    /** In "groups" questions every group has its own colour. */
    const GROUP_COLOURS = ['red', 'blue', 'green', 'orange', 'yellow'];

    const MISSIONS_PER_WORLD = 8;
    /** Missions 1 to 4 use numbers up to 10; missions 5 to 8 use numbers up to 20. */
    const MAX_BY_MISSION = [10, 10, 10, 10, 20, 20, 20, 20];

    /** Every built-in wait, in ms. Short on purpose: 40 missions should take 10 to 15 minutes. */
    const TIMING = {
      SCREEN_FADE: 200,    // screen enter animation (matches the CSS .enter rule)
      QUESTION_SPEAK: 300, // read the question aloud this long after it appears
      STORY_SPEAK: 300,    // same for story cards and the win screen
      SPEAK_DEFER: 60,     // gap between speechSynthesis.cancel() and speak()
      NEXT_CARD: 800,      // correct answer -> Next card
      PICK_TO_HOME: 1200,  // hero picked -> Home, long enough to hear "You picked ..."
      KNOCK_START: 250,    // Rumble lunges at the tower
      KNOCK_PILE: 850,     // knocked bricks land in the pile (the CSS flight takes 500)
      SHAKE: 450,          // wrong-answer shake (the CSS animation is 400)
      STAR_SOUND: 250,     // star ping after the happy sound
      BOUNCE: 500,         // hero bounce after a correct answer
      CONFETTI: 2600,      // the confetti layer is removed after this
      INPUT_GUARD: 350     // taps are ignored this long after a new screen or the Next card appears,
                           // so the second tap of a double-tap cannot answer an unseen question
    };
    /** Soft rest reminder after this much play time (counted from the first Play tap). */
    const REST_AFTER_MS = 15 * 60 * 1000;

    /** Brick picture sizes. u is the stud pitch in px; fitStage() picks u per question. */
    const SIZE = {
      U_MIN: 6,          // px, never smaller
      U_MAX_REM: 2.2,    // rem, never bigger
      FIT_SAFETY: 0.97,  // leave a little room around the picture
      FACE_GAP: 8,       // px between hero faces in "share"
      FACE_MIN: 40,      // px
      FACE_MAX_REM: 4    // rem
    };
    const COL_ROWS = 10;       // towers taller than 10 bricks split into columns of 10
    const BUILD_EXTRA = 5;     // "build" lets the tower grow to N + 5
    const SHARE_ROW = 5;       // "share" treasure bricks are laid out in rows of 5
    const SHARE_FACE_GAP = 12; // px between the treasure pile and the hero faces
    const CONFETTI_COUNT = 26;

    /** The v1 save key. V2 only reads it (migrations.migrateV1); it never writes or deletes it. */
    const STORAGE_KEY = 'ninjaBrickAcademy.v1';
    const SAVE_VERSION = 1;
    /** The v2 lightweight preferences key (sound, last hero, last student). */
    const PREFS_KEY = 'ninjaBrickAcademy.v2.prefs';
    const PREFS_VERSION = 2;

    /** Boot: a plain "Loading..." line appears if storage takes longer than this. */
    const boot = { slowMs: 1500 };
    /** Storage limits (DESIGN 9.4, 9.5). */
    const storage = {
      openTimeoutMs: 3000, // IndexedDB open (also the wait for a blocked upgrade)
      retryMax: 500,       // failed writes kept for retry; beyond this the oldest are dropped and counted
      degradedAfter: 3     // consecutive failed writes before repo.state becomes 'degraded'
    };

    /** Attempt records (DESIGN 11): longer response times are stored as null; recent question ids kept. */
    const attempt = { maxResponseMs: 600000, recentLimit: 200 };
    /**
     * Error observations and patterns (DESIGN 13.1, 13.2). A wrong first answer faster than quickMs at
     * real speed is quick-wrong. Pattern thresholds count attempts in the recent window (the two
     * cross-representation labels use all attempts per representation). Product heuristics only.
     */
    const error = {
      quickMs: 1200,
      distance: { possible: 2, observed: 3 },                      // counting, calculation, place-value
      wrongWay: { possible: 2, observed: 3 },                      // built-wrong-way attempts
      result: { possible: 2, possibleShare: 0.5, observed: 4, observedShare: 0.75 }, // result-* of offered-*
      guessing: { possible: 2, observed: 3, observedShare: 0.3 },
      hintDependence: { possibleMin: 6, observedMin: 8, firstAccuracyMax: 0.5, solvedShare: 0.8 },
      wordProblem: { wordMax: 0.5, otherMin: 0.8, possibleMin: 3, observedMin: 5 },
      transition: { symbolicMin: 0.8, otherMax: 0.5, possibleMin: 3, observedMin: 5 }
    };

    /** Mastery levels (DESIGN 12.1): simple rules on recent answers, not scientific measures. */
    const mastery = {
      recentWindow: 10,
      minAttemptsForLevel: 3,
      strong: {
        recentAccuracy: 0.85, minAttempts: 5, firstAttemptAccuracy: 0.70, firstAttemptScope: 'recent',
        nonSymbolicEvidence: { minAttempts: 2, firstAttemptAccuracy: 0.70 }
      },
      developing: { recentAccuracyMin: 0.60 },
      needsSupport: { recentAccuracyBelow: 0.60, repeatedPatternTriggers: true },
      trend: { minRecent: 6, delta: 0.15 },
      hintDependence: { some: 0.30, high: 0.50 },
      confidence: { low: 3, medium: 5, high: 10 },
      includeContexts: ['play', 'assignment', 'assessment']
    };

    /** Adaptive rules (DESIGN 14.6). enabled is the default of learning.isAdaptive(); test mode can turn it off. */
    const adaptive = {
      enabled: true,
      struggleRun: 2, successRun: 4, successFirstAccuracy: 0.8, minAttemptsAtLevel: 3, cooldownAttempts: 2,
      minLevel: 1, maxLevel: 4,
      maxSameActivityRun: 2, recentQuestionWindow: 20,
      transfer: { symbolicMin: 0.8, symbolicMinAttempts: 3, otherMax: 0.6, otherMinAttempts: 2 },
      concretenessOrder: ['concrete', 'visual', 'number-line', 'symbolic']
    };

    /**
     * The Ninja Check (DESIGN 15): one blueprint for both forms, a fixed length (the blueprint's 12
     * cells) and no time cut-off; targetMinutes is the intended length, checked by the pacing test.
     */
    const assessment = { blueprintId: 'ninja-check.v1', targetMinutes: 5, forms: ['baseline', 'post'] };

    /**
     * Teacher reports (DESIGN 17.3 to 17.5): a concept is a class strength when at least strengthShare
     * of the students with data are Strong, and needs attention when at least attentionShare are Needs
     * support. windowDays is the report window; inactiveDays marks students with no recent practice.
     */
    const reports = { strengthShare: 0.5, attentionShare: 0.34, windowDays: 7, inactiveDays: 14, recentSessions: 10, pulseWeeksBack: 4 };
    /**
     * Teacher mode (DESIGN 17.1, 17.6): the Home button hold, the adult gate sum (two numbers from
     * gateMin to gateMax; a new sum after gateTries wrong answers) and the assignment limits.
     */
    const teacher = {
      holdMs: 2000, gateMin: 21, gateMax: 59, gateTries: 3,
      assignment: { minCount: 5, maxCount: 20, minMinutes: 3, maxMinutes: 20, sittingFloor: 3, sittingCap: 30 }
    };
    /**
     * Import (DESIGN 18.4, P7): the largest file read, the most records accepted in one file, how many
     * validation problems the rejection lists and how many conflicts the plan summary shows.
     */
    const dataImport = { maxBytes: 20 * 1024 * 1024, maxRecords: 250000, problemsShown: 50, conflictsShown: 20 };

    return {
      PALETTE, BAND_CYCLE, GROUP_COLOURS, MISSIONS_PER_WORLD, MAX_BY_MISSION, TIMING, REST_AFTER_MS,
      SIZE, COL_ROWS, BUILD_EXTRA, SHARE_ROW, SHARE_FACE_GAP, CONFETTI_COUNT, STORAGE_KEY, SAVE_VERSION,
      PREFS_KEY, PREFS_VERSION, boot, storage, attempt, error, mastery, adaptive, assessment, reports, teacher,
      import: dataImport
    };
  });
}());
