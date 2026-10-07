/*
 * catalog (L2): lookups over NBA.data and their boot-time validation (DESIGN 3.2, 4.2 step 2, 5).
 *
 * The factory first deep-freezes every NBA.data.* object and then NBA.data itself (R5), so no
 * code can change content at run time. validate({ questionTypes? }) returns a list of problems
 * (empty = valid): ids unique and well formed (DESIGN 5), every reference resolving (concepts,
 * representations, worlds, difficulty families, curriculum slots, plan specs), and, when the
 * question-type registry is passed (main.js does, after every module is built), every activity
 * with logic and a renderer. main.js shows a boot error when the list is not empty.
 */
(function () {
  'use strict';

  NBA.define('catalog', [], () => {
    function deepFreeze(x) {
      if (x && typeof x === 'object' && !Object.isFrozen(x)) {
        Object.freeze(x);
        Object.keys(x).forEach((k) => deepFreeze(x[k]));
      }
      return x;
    }
    Object.keys(NBA.data).forEach((k) => deepFreeze(NBA.data[k]));
    Object.freeze(NBA.data);

    const D = NBA.data;
    const WORLDS = D.worlds.list;
    const HEROES = D.heroes.list;
    const H = D.heroes;
    const CONCEPTS = D.concepts.list;
    const ACTIVITIES = D.activities.list;
    const REPRESENTATIONS = D.representations.list;
    const DIFFICULTY = D.difficulty;
    const CURRICULUM = D.curriculum;

    const byId = (list) => { const m = {}; list.forEach((x) => { m[x.id] = x; }); return m; };
    const heroMap = byId(HEROES), worldMap = byId(WORLDS), conceptMap = byId(CONCEPTS);
    const activityMap = byId(ACTIVITIES), repMap = byId(REPRESENTATIONS);
    const own = (m, id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(m, id);

    function heroById(id) { return own(heroMap, id) ? heroMap[id] : null; }
    function worldById(id) { return own(worldMap, id) ? worldMap[id] : null; }
    function worldIndex(id) { return WORLDS.findIndex((w) => w.id === id); }
    function conceptById(id) { return own(conceptMap, id) ? conceptMap[id] : null; }
    function activityById(id) { return own(activityMap, id) ? activityMap[id] : null; }
    function representationById(id) { return own(repMap, id) ? repMap[id] : null; }
    /** The v1 tier (q.max) of a difficulty level. */
    function tierOfLevel(level) { return DIFFICULTY.tierByLevel[String(level)] || null; }
    /** The range concept credited by operation and tier (addition and subtraction only), or null. */
    function rangeConcept(operation, tier) {
      const r = D.concepts.range[operation];
      return r ? r[String(tier)] || null : null;
    }
    /** An assessment blueprint (DESIGN 15.1), or null. */
    function blueprintById(id) { return own(CURRICULUM.blueprints || {}, id) ? CURRICULUM.blueprints[id] : null; }
    /** The curriculum slot family of a v1 plan label in a world, or null. */
    function slotFamily(worldId, label) {
      const w = CURRICULUM.slots[worldId];
      return w && own(w, label) ? w[label] : null;
    }

    const ID_FORMAT = {
      concept: /^[a-z]+(\.[a-z0-9-]+)+$/,
      activity: /^[a-z][a-z0-9-]*$/,
      world: /^[a-z]+$/,
      hero: /^[a-z]+$/
    };
    const OPERATIONS = ['counting', 'addition', 'subtraction', 'comparison', 'multiplication', 'division'];
    const INPUT_MODES = ['choices', 'build', 'towers'];
    const ANSWER_TYPES = ['integer', 'count', 'tower-index'];

    function validate(opts) {
      const o = opts || {};
      const out = [];
      const ids = (name, list, re) => {
        const seen = new Set();
        list.forEach((x) => {
          if (!x || typeof x.id !== 'string' || !re.test(x.id)) out.push(name + ': bad id ' + JSON.stringify(x && x.id));
          else if (seen.has(x.id)) out.push(name + ': duplicate id ' + x.id);
          else seen.add(x.id);
        });
      };
      ids('concept', CONCEPTS, ID_FORMAT.concept);
      ids('activity', ACTIVITIES, ID_FORMAT.activity);
      ids('world', WORLDS, ID_FORMAT.world);
      ids('hero', HEROES, ID_FORMAT.hero);
      ids('representation', REPRESENTATIONS, ID_FORMAT.activity);
      if (!heroById(H.defaultHero)) out.push('heroes: unknown defaultHero ' + H.defaultHero);
      DIFFICULTY.levels.forEach((l) => { if (!tierOfLevel(l)) out.push('difficulty: level ' + l + ' has no tier'); });
      Object.keys(D.concepts.range).forEach((op) => Object.keys(D.concepts.range[op]).forEach((t) => {
        if (!conceptById(D.concepts.range[op][t])) out.push('concepts.range: unknown ' + D.concepts.range[op][t]);
      }));
      DIFFICULTY.v1Default.forEach((l) => { if (DIFFICULTY.levels.indexOf(l) < 0) out.push('difficulty: bad v1Default ' + l); });
      D.representations.order.forEach((r) => { if (!representationById(r)) out.push('representations.order: unknown ' + r); });
      CONCEPTS.forEach((c) => {
        if (typeof c.name !== 'string' || !c.name) out.push('concept ' + c.id + ': no name');
        if (typeof c.adaptive !== 'boolean') out.push('concept ' + c.id + ': adaptive must be a boolean');
      });
      ACTIVITIES.forEach((a) => {
        const at = 'activity ' + a.id + ': ';
        if (OPERATIONS.indexOf(a.operation) < 0) out.push(at + 'unknown operation ' + a.operation);
        if (!representationById(a.representation)) out.push(at + 'unknown representation ' + a.representation);
        if (!conceptById(a.primaryConcept)) out.push(at + 'unknown primaryConcept ' + a.primaryConcept);
        (a.concepts || []).forEach((c) => { if (!conceptById(c)) out.push(at + 'unknown concept ' + c); });
        if (INPUT_MODES.indexOf(a.inputMode) < 0) out.push(at + 'unknown inputMode ' + a.inputMode);
        if (ANSWER_TYPES.indexOf(a.answerType) < 0) out.push(at + 'unknown answerType ' + a.answerType);
        if (typeof a.hintStrategy !== 'string' || !a.hintStrategy) out.push(at + 'no hintStrategy');
        const fam = DIFFICULTY.families[a.family];
        if (!fam) out.push(at + 'unknown family ' + a.family);
        (a.difficulties || []).forEach((l) => {
          if (DIFFICULTY.levels.indexOf(l) < 0) out.push(at + 'unknown level ' + l);
          else if (fam && !fam[String(l)]) out.push(at + 'family ' + a.family + ' has no level ' + l);
        });
        if (!(a.difficulties || []).length) out.push(at + 'declares no levels');
        Object.keys(a.templates || {}).forEach((t) => { if (!DIFFICULTY.families[a.templates[t]]) out.push(at + 'template ' + t + ' unknown family'); });
        (a.worlds || []).forEach((w) => { if (!worldById(w)) out.push(at + 'unknown world ' + w); });
      });
      Object.keys(DIFFICULTY.extra).forEach((id) => { if (!activityById(id)) out.push('difficulty.extra: unknown activity ' + id); });
      CURRICULUM.conceptOrder.forEach((c) => { if (!conceptById(c)) out.push('curriculum.conceptOrder: unknown ' + c); });
      // P4 (DESIGN 14.2, 14.8): every matrix cell is an activity of that representation; assignable rows resolve
      Object.keys(CURRICULUM.matrix || {}).forEach((c) => {
        if (!conceptById(c)) out.push('curriculum.matrix: unknown concept ' + c);
        Object.keys(CURRICULUM.matrix[c]).forEach((rep) => {
          const a = activityById(CURRICULUM.matrix[c][rep]);
          if (!a || a.representation !== rep) out.push('curriculum.matrix.' + c + '.' + rep + ': not an activity of that representation');
        });
      });
      Object.keys(CURRICULUM.assignable || {}).forEach((c) => {
        const A = CURRICULUM.assignable[c], at = 'curriculum.assignable.' + c + ': ';
        if (!conceptById(c)) out.push(at + 'unknown concept');
        A.activities.forEach((id) => { if (!activityById(id)) out.push(at + 'unknown activity ' + id); });
        [A.defaultDriver, A.oddDriver].concat(Object.keys(A.activityDriver).map((k) => A.activityDriver[k])).forEach((d) => {
          if (d !== undefined && !Object.prototype.hasOwnProperty.call(CURRICULUM.matrix, d)) out.push(at + 'driver ' + d + ' has no matrix row');
        });
        [A.default, A.oddDefault].forEach((x) => {
          if (x && (!activityById(x.activityId) || DIFFICULTY.levels.indexOf(x.difficulty) < 0)) out.push(at + 'bad default');
        });
        A.levels.forEach((l) => { if (DIFFICULTY.levels.indexOf(l) < 0) out.push(at + 'unknown level ' + l); });
      });
      Object.keys(CURRICULUM.slots).forEach((w) => {
        if (!worldById(w)) out.push('curriculum.slots: unknown world ' + w);
        Object.keys(CURRICULUM.slots[w]).forEach((label) => {
          if (!activityById(label)) out.push('curriculum.slots.' + w + ': unknown activity ' + label);
          CURRICULUM.slots[w][label].concepts.forEach((c) => { if (!conceptById(c)) out.push('curriculum.slots.' + w + '.' + label + ': unknown ' + c); });
        });
      });
      // P5 (DESIGN 15.1): every blueprint cell names a known concept and an activity of its
      // representation at a level that activity declares; cell ids are unique
      Object.keys(CURRICULUM.blueprints || {}).forEach((bid) => {
        const B = CURRICULUM.blueprints[bid], at = 'curriculum.blueprints.' + bid + ': ';
        if (!B || B.id !== bid || !Array.isArray(B.cells) || !B.cells.length) { out.push(at + 'bad blueprint'); return; }
        const seen = new Set();
        B.cells.forEach((cell) => {
          const a = activityById(cell.activityId), ct = at + 'cell ' + cell.id + ': ';
          if (typeof cell.id !== 'string' || !/^c\d{2}$/.test(cell.id) || seen.has(cell.id)) out.push(ct + 'bad or duplicate id');
          seen.add(cell.id);
          if (!conceptById(cell.conceptId)) out.push(ct + 'unknown concept ' + cell.conceptId);
          if (!a) { out.push(ct + 'unknown activity ' + cell.activityId); return; }
          if (a.representation !== cell.representation) out.push(ct + 'activity ' + a.id + ' is not ' + cell.representation);
          if ((a.difficulties || []).indexOf(cell.difficulty) < 0) out.push(ct + 'activity ' + a.id + ' has no level ' + cell.difficulty);
          if (cell.template !== null && !(a.templates && Object.prototype.hasOwnProperty.call(a.templates, cell.template))) out.push(ct + 'bad template');
          if (typeof cell.transfer !== 'boolean') out.push(ct + 'transfer must be a boolean');
        });
      });
      WORLDS.forEach((w) => {
        const p = w.plan || {};
        const named = p.kind === 'halves' ? p.types : (p.kind === 'repeat' ? [p.type] : (p.kind === 'master' ? [] : null));
        if (!named) { out.push('world ' + w.id + ': unknown plan kind ' + p.kind); return; }
        named.forEach((t) => {
          if (!activityById(t)) out.push('world ' + w.id + ': plan names unknown activity ' + t);
          else if (!slotFamily(w.id, t)) out.push('world ' + w.id + ': no curriculum slot for ' + t);
        });
      });
      const qt = o.questionTypes;
      if (qt) {
        ACTIVITIES.forEach((a) => {
          const T = qt.get(a.id);
          if (!T || typeof T.create !== 'function' || typeof T.candidates !== 'function' || typeof T.hint !== 'function') {
            out.push('activity ' + a.id + ': no question logic');
          } else if (typeof T.render !== 'function') out.push('activity ' + a.id + ': no renderer');
        });
        qt.ids().forEach((id) => { if (!activityById(id)) out.push('question type ' + id + ': no activity metadata'); });
      }
      return out;
    }

    return {
      WORLDS, HEROES, CONCEPTS, ACTIVITIES, REPRESENTATIONS, DIFFICULTY, CURRICULUM,
      DEFAULT_HERO: H.defaultHero,
      VILLAIN: H.villain,
      PRAISE: H.praise,
      ENCOURAGE: H.encourage,
      REST_LINE: H.restLine,
      heroById, worldById, worldIndex, conceptById, activityById, representationById,
      tierOfLevel, rangeConcept, slotFamily, blueprintById, validate, ID_FORMAT
    };
  });
}());
