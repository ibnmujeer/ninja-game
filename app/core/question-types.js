/*
 * questionTypes (L2): the question registry, pure parts only (v1 section 8, extended in P3 as the
 * learning object model of DESIGN 8.2). Every entry has the same interface, so a new kind of
 * question is one new entry here plus its metadata in data/activities.js:
 *   id, conceptId (= primaryConcept), inputMode, representation, operation, answerType,
 *   hintStrategy, difficulties, family     metadata merged from data/activities.js
 *   candidates(level, template?)  every valid number set for a declared level (data/difficulty.js);
 *                                 throws for anything else (a v1-style candidates(10) fails loudly)
 *   candidatesForMax(10 | 20)     the v1 signature: level 2 or 4
 *   key(n, template?)   stops a question repeating within a run (the question id); v1 keys unchanged
 *   size(n)             biggest number in the picture (the test hook infers max from it)
 *   create(n, ctx)      { display: [lines], speech, answer, cap?, start?, scene? } (pure);
 *                       ctx = { heroId, heroName, friendId, friendName, rng, template }
 *   hint(q, wrongCount, run)  hint text that uses the question's numbers (per hintStrategy)
 * render(stage, q) and the optional afterShow(stage, q) live in child/renderers.js, which attaches
 * them with attachRenderer(id, { render, afterShow }). Display text may use maths symbols;
 * speech and hint text never do. The v1 types keep their v1 key, size, create and hint.
 */
(function () {
  'use strict';

  NBA.define('questionTypes', ['config', 'util', 'catalog'], (config, util, catalog) => {
    const { BUILD_EXTRA } = config;
    const { range } = util;
    const { VILLAIN, DIFFICULTY, ACTIVITIES } = catalog;

    const MINUS = '\u2212', TIMES = '\u00d7', DIVIDE = '\u00f7', DOTS = '\u2026', NBSP = '\u00a0';
    function tier(max) { return max > 10 ? 20 : 10; }

    /* ---------- candidates from the difficulty table (DESIGN 6.2) ---------- */
    const FAMILIES = {
      add(p) {
        const out = [];
        for (let a = p.min; a <= p.sumMax; a++) {
          for (let b = p.min; a + b <= p.sumMax; b++) {
            if (a + b >= p.sumMin && (p.bMax === undefined || b <= p.bMax)) out.push({ a: a, b: b });
          }
        }
        return out;
      },
      'take-away'(p) {
        const out = [];
        for (let a = p.aMin; a <= p.aMax; a++) {
          for (let b = p.bMin; b <= p.bMax; b++) if (a - b >= p.leftMin) out.push({ a: a, b: b });
        }
        return out;
      },
      more(p) {
        const out = [];
        for (let t = p.tMin; t <= p.tMax; t++) {
          for (let m = p.mMin; m <= p.mMax; m++) if (t - m >= 1) out.push({ have: t - m, total: t });
        }
        return out;
      },
      build: (p) => range(p.nMin, p.nMax).map((n) => ({ n: n })),
      bigger(p) {
        const out = [];
        for (let l = p.lo; l <= p.hi; l++) {
          for (let r = p.lo; r <= p.hi; r++) {
            const d = Math.abs(l - r);
            if (d >= 1 && d <= p.dMax && (p.largerMin === undefined || Math.max(l, r) >= p.largerMin)) out.push({ left: l, right: r });
          }
        }
        return out;
      },
      groups: (p) => p.list.map((x) => ({ g: x[0], s: x[1] })),
      share: (p) => p.list.map((x) => ({ n: x[0], k: x[1] }))
    };

    /** "Count by" list: skipList(4, 3) -> "4, 8, 12". */
    function skipList(step, terms) { return range(1, terms).map((i) => i * step).join(', '); }
    /** Up to 3 numbers counting on (dir 1) or back (dir -1) from n: "5, 6, 7..." */
    function countList(n, steps, dir) {
      const k = Math.min(steps, 3);
      return range(1, k).map((i) => n + dir * i).join(', ') + (steps > 3 ? DOTS : '.');
    }
    const plusEq = (a, b) => a + ' + ' + b + ' = ?';
    const minusEq = (a, b) => a + ' ' + MINUS + ' ' + b + ' = ?';
    /** Build-mode cap: +1 stops here (DESIGN 8.1); for build exactly v1's min(n + 5, 25). */
    const capFor = (start, answer) => Math.max(start, Math.min(answer + BUILD_EXTRA, 25));
    // The seed picks the colour of the one object brick on the stage; the story just says "bricks".
    const OBJECTS = [['red', 'bricks'], ['blue', 'bricks'], ['green', 'bricks'], ['gold', 'bricks']];
    function sceneFor(ctx, withVillain) {
      const c = ctx || {};
      const o = OBJECTS[Math.floor((c.rng || (() => 0))() * OBJECTS.length)];
      return { heroId: c.heroId || null, friendId: withVillain ? null : (c.friendId || null), villain: !!withVillain, object: o[0], word: o[1],
        hero: c.heroName || 'Blaze', friend: c.friendName || 'Jade' };
    }

    const QUESTION_TYPES = {
      /* Build a tower of exactly N bricks with +1 / Undo / Done (no live counter: counting is the task). */
      build: {
        key: (x) => 'build:' + x.n,
        size: (x) => x.n,
        create: (x) => ({
          display: ['Build a tower', 'of ' + x.n + ' bricks!'],
          speech: 'Build a tower of ' + x.n + ' bricks! Tap plus 1 for each brick, then tap Done.',
          answer: x.n,
          cap: Math.min(x.n + BUILD_EXTRA, 25) // +1 stops here, so the tower can never overflow
        }),
        hint(q, wrongCount, run) {
          if (wrongCount < 2) return 'Count your bricks: 1, 2, 3' + DOTS + ' We need ' + q.answer + '.';
          return run.buildCount > q.answer ? 'Too tall! Tap Undo. We need ' + q.answer + '.'
            : 'Add more bricks. We need ' + q.answer + '.';
        }
      },

      /* A + B: a red group and a blue group with a big "+" between them. */
      add: {
        key: (x) => 'add:' + x.a + '+' + x.b,
        size: (x) => x.a + x.b,
        create: (x) => ({
          display: [x.a + ' + ' + x.b + ' = ?'],
          speech: x.a + ' bricks and ' + x.b + ' more bricks. ' + x.a + ' plus ' + x.b + '. How many in all?',
          answer: x.a + x.b
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          if (wrongCount < 2) return 'Start at ' + a + '. Count on ' + b + ' more.';
          return 'Count on from ' + a + ': ' + range(a + 1, a + Math.min(b, 3)).join(', ') + (b > 3 ? DOTS : '.');
        }
      },

      /* How many more: H solid bricks plus (T - H) dashed missing bricks. */
      more: {
        key: (x) => 'more:' + x.have + '/' + x.total,
        size: (x) => x.total,
        create: (x) => ({
          display: ['Have ' + x.have + '. Need ' + x.total + '.', 'How many more?'],
          speech: 'You have ' + x.have + ' bricks. You need ' + x.total + '. How many more?',
          answer: x.total - x.have
        }),
        hint(q, wrongCount) {
          const h = q.numbers.have, t = q.numbers.total;
          return wrongCount < 2 ? 'Count on from ' + h + ' to ' + t + '.'
            : 'Count the dashed bricks. ' + h + ' and how many make ' + t + '?';
        }
      },

      /* Tap the bigger tower: each whole tower is a button. Heights are never equal. */
      bigger: {
        key: (x) => 'bigger:' + Math.min(x.left, x.right) + '-' + Math.max(x.left, x.right),
        size: (x) => Math.max(x.left, x.right),
        // No numbers in the speech on purpose: they would give the answer away.
        create: (x) => ({ display: ['Tap the bigger tower!'], speech: 'Tap the bigger tower!', answer: x.left > x.right ? 0 : 1 }),
        hint(q, wrongCount) {
          const lo = Math.min(q.numbers.left, q.numbers.right), hi = Math.max(q.numbers.left, q.numbers.right);
          return wrongCount < 2 ? 'Count each tower. One has ' + lo + ', one has ' + hi + '.'
            : hi + ' is more than ' + lo + '. Tap the taller tower.';
        }
      },

      /* Rumble knocks B bricks off a tower of A. The knocked bricks land in a pile beside it. */
      knock: {
        key: (x) => 'knock:' + x.a + '-' + x.b,
        size: (x) => x.a,
        create: (x) => ({
          display: ['How many are left?', x.a + ' ' + MINUS + ' ' + x.b + ' = ?'],
          speech: VILLAIN.name + ' knocked off ' + x.b + ' bricks! ' + x.a + ' take away ' + x.b + '. How many are left?',
          answer: x.a - x.b
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          // NBSP keeps "back 9." together so the number never sits alone on line 2.
          return wrongCount < 2 ? 'Start at ' + a + ' and count back' + NBSP + b + '.'
            : 'Count the bricks still standing. ' + a + ' take away ' + b + '.';
        }
      },

      /* G groups of S bricks, each group its own colour on its own plate. */
      groups: {
        key: (x) => 'groups:' + x.g + 'x' + x.s,
        size: (x) => x.g * x.s,
        create: (x) => ({
          display: [x.g + ' groups of ' + x.s, x.g + ' ' + TIMES + ' ' + x.s + ' = ?'],
          speech: x.g + ' groups of ' + x.s + ' bricks. ' + x.g + ' times ' + x.s + '. How many in all?',
          answer: x.g * x.s
        }),
        hint(q, wrongCount) {
          const g = q.numbers.g, s = q.numbers.s;
          return 'Count by ' + s + 's: ' + (wrongCount < 2 ? skipList(s, 2) + ', ' + DOTS : skipList(s, g));
        }
      },

      /* N treasure bricks shared by K ninjas: the chosen hero plus K - 1 teammates. */
      share: {
        key: (x) => 'share:' + x.n + '/' + x.k,
        size: (x) => x.n,
        create: (x) => ({
          // NBSP keeps "20 shared by" and "5 ninjas" whole, so a narrow phone breaks
          // line 1 between them instead of leaving "ninjas" alone on its own line.
          display: [x.n + NBSP + 'shared' + NBSP + 'by ' + x.k + NBSP + 'ninjas', x.n + ' ' + DIVIDE + ' ' + x.k + ' = ?'],
          speech: x.n + ' bricks shared by ' + x.k + ' ninjas. How many does each ninja get?',
          answer: x.n / x.k
        }),
        hint(q, wrongCount) {
          const n = q.numbers.n, k = q.numbers.k, each = n / k;
          if (wrongCount < 2) return 'Give each of the ' + k + ' ninjas one brick at a time.';
          const list = each <= 5 ? skipList(k, each) : skipList(k, 3) + ' ' + DOTS + ' ' + n;
          return 'Count by ' + k + 's up to ' + n + ': ' + list + '. How many ' + k + 's?';
        }
      },
      /* ---------- V2 activities (DESIGN 7, 8.1): concrete, number-line, symbolic, word-problem ---------- */

      /* Start with A red bricks and add B more with +1, then Done (no live counter). */
      'add-build': {
        key: (x) => 'add-build:' + x.a + '+' + x.b,
        size: (x) => x.a + x.b,
        create: (x) => ({
          display: ['You have ' + x.a + ' bricks.', 'Add ' + x.b + ' more!'],
          speech: 'You have ' + x.a + ' bricks. Add ' + x.b + ' more. Tap plus 1 for each brick, then tap Done.',
          answer: x.a + x.b, start: x.a, cap: capFor(x.a, x.a + x.b)
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          return wrongCount < 2 ? 'Start at ' + a + '. Add ' + b + ' more bricks, then tap Done.'
            : 'Count on from ' + a + ' as you add: ' + countList(a, b, 1);
        }
      },

      /* Start with A banded bricks and take B away with Undo, then Done. */
      'sub-build': {
        key: (x) => 'sub-build:' + x.a + '-' + x.b,
        size: (x) => x.a,
        create: (x) => ({
          display: ['You have ' + x.a + ' bricks.', 'Take ' + x.b + ' away!'],
          speech: 'You have ' + x.a + ' bricks. Take ' + x.b + ' away. Tap Undo for each brick, then tap Done.',
          answer: x.a - x.b, start: x.a, cap: capFor(x.a, x.a - x.b)
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          return wrongCount < 2 ? 'Take away ' + b + ' bricks with Undo, then tap Done.'
            : 'Count back from ' + a + ' as you tap Undo: ' + countList(a, b, -1);
        }
      },

      /* Start at A on the number line and jump on B. */
      'add-line': {
        key: (x) => 'add-line:' + x.a + '+' + x.b,
        size: (x) => x.a + x.b,
        create: (x) => ({
          display: [plusEq(x.a, x.b)],
          speech: 'Start at ' + x.a + '. Jump on ' + x.b + '. Where do you land?',
          answer: x.a + x.b, start: x.a
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          return wrongCount < 2 ? 'Start at ' + a + '. Jump on ' + b + ', one hop at a time.'
            : 'Count the hops from ' + a + ': ' + countList(a, b, 1);
        }
      },

      /* Start at A on the number line and jump back B. */
      'sub-line': {
        key: (x) => 'sub-line:' + x.a + '-' + x.b,
        size: (x) => x.a,
        create: (x) => ({
          display: [minusEq(x.a, x.b)],
          speech: 'Start at ' + x.a + '. Jump back ' + x.b + '. Where do you land?',
          answer: x.a - x.b, start: x.a
        }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          return wrongCount < 2 ? 'Start at ' + a + '. Jump back ' + b + ', one hop at a time.'
            : 'Count back from ' + a + ': ' + countList(a, b, -1);
        }
      },

      /* "A + B = ?" on a plain card: numerals and signs only. */
      'add-sym': {
        key: (x) => 'add-sym:' + x.a + '+' + x.b,
        size: (x) => x.a + x.b,
        create: (x) => ({ display: [plusEq(x.a, x.b)], speech: 'What is ' + x.a + ' plus ' + x.b + '?', answer: x.a + x.b }),
        hint(q, wrongCount) {
          const big = Math.max(q.numbers.a, q.numbers.b), small = Math.min(q.numbers.a, q.numbers.b);
          return wrongCount < 2 ? 'Start at the bigger number, ' + big + '. Count on ' + small + ' more.'
            : 'Count on from ' + big + ': ' + countList(big, small, 1);
        }
      },

      /* "A - B = ?" on a plain card: count back a small B, or count up from B to A. */
      'sub-sym': {
        key: (x) => 'sub-sym:' + x.a + '-' + x.b,
        size: (x) => x.a,
        create: (x) => ({ display: [minusEq(x.a, x.b)], speech: 'What is ' + x.a + ' take away ' + x.b + '?', answer: x.a - x.b }),
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b, back = b <= a - b;
          if (wrongCount < 2) return back ? 'Start at ' + a + ' and count back ' + b + '.' : 'Count up from ' + b + ' to ' + a + '.';
          return back ? 'Count back from ' + a + ': ' + countList(a, b, -1)
            : 'Count up from ' + b + ': ' + countList(b, a - b, 1) + ' How many steps to ' + a + '?';
        }
      },

      /* A short story read aloud: the hero has A, a friend brings B more. */
      'add-word': {
        key: (x) => 'add-word:' + x.a + '+' + x.b,
        size: (x) => x.a + x.b,
        create(x, ctx) {
          const s = sceneFor(ctx, false);
          const lines = [s.hero + ' has ' + x.a + ' ' + s.word + '.', s.friend + ' brings ' + x.b + ' more.', 'How many now?'];
          return { display: lines, speech: lines.join(' '), answer: x.a + x.b, scene: s };
        },
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          return wrongCount < 2 ? 'First ' + a + ', then ' + b + ' more. Count on from ' + a + '.'
            : 'Count on from ' + a + ': ' + countList(a, b, 1);
        }
      },

      /* A short story: take (Rumble takes B of A) or diff (A and B: how many more?). */
      'sub-word': {
        key: (x, template) => 'sub-word:' + (template === 'diff' ? 'diff' : 'take') + ':' + x.a + '-' + x.b,
        size: (x) => x.a,
        create(x, ctx) {
          const diff = !!ctx && ctx.template === 'diff';
          const s = sceneFor(ctx, !diff);
          const lines = diff
            ? [s.hero + ' has ' + x.a + ' ' + s.word + '.', s.friend + ' has ' + x.b + '.', 'How many more has ' + s.hero + '?']
            : [s.hero + ' has ' + x.a + ' ' + s.word + '.', VILLAIN.name + ' takes ' + x.b + '.', 'How many are left?'];
          return { display: lines, speech: lines.join(' '), answer: x.a - x.b, scene: s };
        },
        hint(q, wrongCount) {
          const a = q.numbers.a, b = q.numbers.b;
          if (q.template === 'diff') {
            return wrongCount < 2 ? 'Count up from ' + b + ' to ' + a + '.'
              : 'Count up from ' + b + ': ' + countList(b, a - b, 1) + ' How many steps to ' + a + '?';
          }
          return wrongCount < 2 ? 'First ' + a + ', then ' + b + ' are taken. Count back from ' + a + '.'
            : 'Count back from ' + a + ': ' + countList(a, b, -1);
        }
      }
    };

    /* ---------- the learning object interface (DESIGN 8.2) ---------- */
    function checkLevel(id, declared, level) {
      if (!Number.isInteger(level) || level < 1 || level > 4) throw new Error('[NBA] candidates: level must be an integer 1 to 4');
      if (declared.indexOf(level) < 0) throw new Error('[NBA] ' + id + ' does not declare level ' + level);
    }

    ACTIVITIES.forEach((meta) => {
      const T = QUESTION_TYPES[meta.id];
      if (!T) return; // catalog.validate() reports an activity without logic
      Object.assign(T, {
        id: meta.id, conceptId: meta.primaryConcept, inputMode: meta.inputMode, representation: meta.representation,
        operation: meta.operation, answerType: meta.answerType, hintStrategy: meta.hintStrategy,
        difficulties: meta.difficulties.slice(), family: meta.family, adaptive: meta.adaptive, v1: meta.v1,
        templates: meta.templates ? Object.keys(meta.templates) : null
      });
      /** Every valid number set for a declared level; sub-word takes the template (take | diff). */
      T.candidates = function (level, template) {
        checkLevel(meta.id, meta.difficulties, level);
        const famName = meta.templates ? meta.templates[template === 'diff' ? 'diff' : 'take'] : meta.family;
        let list = FAMILIES[famName](DIFFICULTY.families[famName][String(level)]);
        if (famName === 'more' && meta.id !== 'more') list = list.map((x) => ({ a: x.total, b: x.have }));
        const extra = DIFFICULTY.extra[meta.id] && DIFFICULTY.extra[meta.id][String(level)];
        if (extra) list = list.filter((x) => (extra.bMax === undefined || x.b <= extra.bMax) && (!extra.aGteB || x.a >= x.b));
        return list;
      };
      /** The v1 signature: max 10 is level 2, max 20 is level 4. */
      T.candidatesForMax = function (max, template) { return T.candidates(DIFFICULTY.levelByTier[String(tier(max))], template); };
    });

    /** The entry for a type id (with render/afterShow once renderers.js has attached them). */
    function get(id) {
      return Object.prototype.hasOwnProperty.call(QUESTION_TYPES, id) ? QUESTION_TYPES[id] : undefined;
    }
    function ids() { return Object.keys(QUESTION_TYPES); }

    /** Called by child/renderers.js for every id: the one place a lower layer holds UI functions. */
    function attachRenderer(id, fns) {
      const T = get(id);
      if (!T) throw new Error('[NBA] attachRenderer: unknown question type ' + id);
      if (T.render) throw new Error('[NBA] attachRenderer: ' + id + ' already has a renderer');
      if (typeof fns.render !== 'function') throw new Error('[NBA] attachRenderer: ' + id + ' needs render()');
      T.render = fns.render;
      if (fns.afterShow) T.afterShow = fns.afterShow;
    }

    return { get, ids, attachRenderer, tier };
  });
}());
