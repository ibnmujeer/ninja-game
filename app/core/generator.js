/*
 * generator (L2): questions, answer buttons and mission plans (v1 sections 5 and 8; seeded in P3,
 * DESIGN 4.3 and 8.3). A question's numbers, its story names and object, its distractors and its
 * button order come only from rngFrom(seed), so a recorded attempt (seed, numbers, template)
 * reproduces it exactly. Plans take an rng too.
 *
 *   generate(typeId, level, used, seed, opts?)       a fresh candidate not in `used` (v1 rule)
 *   createQuestion(typeId, numbers, levelOrMax, seed?, opts?)  from given numbers (the test hook);
 *       levelOrMax 1 to 4 is a level, 10 or 20 a v1 max (level 2 or 4); no seed: util.newSeed()
 *   opts = { heroId, template, exclude? }   the child's hero (word problems), the sub-word template
 *       and a Set of question keys to avoid while other fresh candidates remain (generate only)
 */
(function () {
  'use strict';

  NBA.define('generator', ['config', 'util', 'catalog', 'questionTypes'], (config, util, catalog, questionTypes) => {
    const { MISSIONS_PER_WORLD } = config;
    const { pick, repeat, shuffle, noRepeatsInARow, rngFrom } = util;
    const { HEROES, DEFAULT_HERO, DIFFICULTY, heroById, tierOfLevel, rangeConcept } = catalog;
    const { tier } = questionTypes;

    /**
     * Mission plan from 4 type ids: each half (missions 1-4 and 5-8) uses all 4
     * in a fresh random order. Tries to avoid the same type twice in a row; if
     * that is impossible (World 2 has three "knock"), the last try is used.
     */
    function halves(types4, rng) {
      let plan = [];
      for (let t = 0; t < 50; t++) {
        plan = shuffle(types4, rng).concat(shuffle(types4, rng));
        if (noRepeatsInARow(plan)) break;
      }
      return plan;
    }

    /**
     * World 5 plan: each half has one question from each of worlds 1 to 4.
     * World 1 part: build/add/more/bigger (build at most once per run).
     * World 2 part: knock or more (knock when the World 1 part is already "more").
     */
    function masterPlan(rng) {
      const plan = [];
      let usedBuild = false;
      for (let h = 0; h < 2; h++) {
        const w1 = pick(usedBuild ? ['add', 'more', 'bigger'] : ['build', 'add', 'more', 'bigger'], rng);
        if (w1 === 'build') usedBuild = true;
        const w2 = (w1 === 'more') ? 'knock' : pick(['knock', 'more'], rng);
        const half = [w1, w2, 'groups', 'share'];
        let order = shuffle(half, rng);
        for (let t = 0; t < 50 && plan.length && order[0] === plan[plan.length - 1]; t++) order = shuffle(half, rng);
        plan.push.apply(plan, order);
      }
      return plan;
    }
    /** Every type id masterPlan() can use. */
    const MASTER_TYPES = ['build', 'add', 'more', 'bigger', 'knock', 'groups', 'share'];

    /** The 8 question type ids (the v1 slot labels) for one run of a world. */
    function buildPlan(world, rng) {
      const spec = world.plan;
      if (spec.kind === 'halves') return halves(spec.types, rng);
      if (spec.kind === 'repeat') return repeat(spec.type, MISSIONS_PER_WORLD);
      if (spec.kind === 'master') return masterPlan(rng);
      throw new Error('[NBA] unknown plan kind ' + spec.kind + ' in world ' + world.id);
    }

    /** Every type id a world's plan can contain (no randomness). */
    function planTypes(world) {
      const spec = world.plan;
      if (spec.kind === 'halves') return spec.types.filter((t, i) => spec.types.indexOf(t) === i);
      if (spec.kind === 'repeat') return [spec.type];
      if (spec.kind === 'master') return MASTER_TYPES.slice();
      throw new Error('[NBA] unknown plan kind ' + spec.kind + ' in world ' + world.id);
    }

    /**
     * Three answer buttons: the answer plus 2 close numbers from +-1 and +-2
     * (+-3 only if needed). All are at least 1 and different; the position of
     * the right answer is uniformly random.
     */
    function makeChoices(ans, rng) {
      const picks = shuffle([ans - 1, ans + 1, ans - 2, ans + 2].filter((v) => v >= 1), rng).slice(0, 2);
      const far = shuffle([ans - 3, ans + 3].filter((v) => v >= 1), rng);
      while (picks.length < 2 && far.length) picks.push(far.shift());
      return shuffle([ans].concat(picks), rng);
    }

    /** The level of a levelOrMax argument: 1 to 4 as given; 10 or 20 (any max) through the v1 tier. */
    function levelOf(levelOrMax) {
      const x = Number(levelOrMax);
      if (Number.isInteger(x) && x >= 1 && x <= 4) return x;
      return DIFFICULTY.levelByTier[String(tier(x))];
    }

    /** The template a sub-word question uses (take unless diff is asked for); null for other types. */
    function templateFor(T, opts) {
      if (!T.templates) return null;
      return opts && opts.template === 'diff' ? 'diff' : 'take';
    }

    /** The concept a question shows when no slot decision names one (DESIGN 6.3, 8.1). */
    function questionConcept(T, t, template) {
      if (T.representation === 'symbolic') return rangeConcept(T.operation, t) || T.conceptId;
      if (template === 'diff') return 'sub.difference';
      return T.conceptId;
    }

    /** The create() context: the child's hero and a seed-picked friend (word problems only). */
    function storyContext(T, rng, opts, template) {
      const ctx = { heroId: null, heroName: null, friendId: null, friendName: null, rng: rng, template: template };
      if (T.representation !== 'word-problem') return ctx;
      const hero = heroById(opts && opts.heroId) || heroById(DEFAULT_HERO);
      const friend = pick(HEROES.filter((h) => h.id !== hero.id), rng);
      return Object.assign(ctx, { heroId: hero.id, heroName: hero.name, friendId: friend.id, friendName: friend.name });
    }

    /** Build the full question object of DESIGN 8.3 from given numbers. */
    function finish(typeId, numbers, level, seed, rng, opts) {
      const T = questionTypes.get(typeId);
      const template = templateFor(T, opts);
      const t = tierOfLevel(level);
      const q = T.create(numbers, storyContext(T, rng, opts, template));
      q.typeId = typeId;
      q.activityId = typeId;
      q.difficulty = level;
      q.max = t;
      q.numbers = Object.assign({}, numbers);
      q.key = T.key(numbers, template);
      q.questionId = q.key;
      q.seed = seed;
      q.template = template;
      q.representation = T.representation;
      q.conceptId = questionConcept(T, t, template);
      if (T.inputMode === 'choices') q.choices = makeChoices(q.answer, rng);
      return q;
    }

    /** Build a full question from given numbers (also used by the ?test hook). */
    function createQuestion(typeId, numbers, levelOrMax, seed, opts) {
      const s = (seed === undefined || seed === null) ? util.newSeed() : (Number(seed) >>> 0);
      return finish(typeId, numbers, levelOf(levelOrMax), s, rngFrom(s), opts);
    }

    /** A new question of this type at a declared level, never one already used this run (v1 rule). */
    function generate(typeId, level, used, seed, opts) {
      const T = questionTypes.get(typeId);
      const s = Number(seed) >>> 0;
      const rng = rngFrom(s);
      const template = templateFor(T, opts);
      const all = T.candidates(level, template); // throws for a level the type does not declare
      const fresh = all.filter((x) => !used.has(T.key(x, template)));
      // opts.exclude (P4, DESIGN 14.4): the student's recent question ids, skipped while fresh ones remain
      const ex = opts && opts.exclude;
      const fresher = ex && ex.size ? fresh.filter((x) => !ex.has(T.key(x, template))) : fresh;
      return finish(typeId, pick(fresher.length ? fresher : (fresh.length ? fresh : all), rng), level, s, rng, opts);
    }

    return { halves, masterPlan, buildPlan, planTypes, makeChoices, createQuestion, generate, levelOf };
  });
}());
