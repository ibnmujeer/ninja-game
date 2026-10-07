/*
 * targets (L2): teacher targets (DESIGN 14.8, 17.4, 17.6), pure. learningEngine re-exports every
 * function here, so callers use learningEngine.resolveTarget, candidateList, validateAssignment
 * and validateOverride; the module is split out only to keep learning-engine.js short.
 *
 *   resolveTarget(c, fixed, where, cache, cfg) -> { conceptId, driverConceptId, activityId,
 *       representation, difficulty, template, clamped, adaptive (the decide result used, or null) }
 *     fixed = { activityIds: [], representation: rep | null, difficulty: 1-4 | null }
 *     where = { kind: 'assignment', j, rot } | { kind: 'slot', slotConceptId, v1Default: { activityId, difficulty } }
 *     cache = { mastery: { conceptId: snapshot }, now }
 *   candidateList(c, fixed, driver?)  F(c) of 14.8 step 2 (for addsub.mixed: only the driver's row)
 *   validateOverride(o) / validateAssignment(a, { now, creating })  -> [{ field, code, conceptId?, activityId? }]
 *   familyOf(conceptId)  'addition' | 'subtraction' | 'mixed' | null
 */
(function () {
  'use strict';

  NBA.define('targets', ['config', 'util', 'catalog', 'masteryEngine', 'adaptiveEngine'],
    (config, util, catalog, masteryEngine, adaptiveEngine) => {
      const C = catalog.CURRICULUM;
      const own = (o, k) => !!o && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
      const tableOf = (c) => (own(C.assignable, c) ? C.assignable[c] : null);
      const SELECTABLE = Object.keys(C.assignable);
      const isLevel = (x) => Number.isInteger(x) && x >= 1 && x <= 4;
      const repOf = (id) => { const a = catalog.activityById(id); return a ? a.representation : null; };
      const inRow = (driver, id) => !!adaptiveEngine.repInRow(driver, id);

      function familyOf(c) {
        if (c === 'addsub.mixed') return 'mixed';
        if (typeof c !== 'string') return null;
        if (c.indexOf('add.') === 0) return 'addition';
        if (c.indexOf('sub.') === 0) return 'subtraction';
        return null;
      }

      /** The default driver of c at occurrence j (addsub.mixed: add row when j is even, sub row when odd). */
      function defaultDriver(c, j) {
        const A = tableOf(c);
        if (!A) return null;
        return A.mixed && j % 2 === 1 ? A.oddDriver : A.defaultDriver;
      }
      /** Every driver c's table names (default, odd and activity drivers). */
      function namedDrivers(c) {
        const A = tableOf(c);
        if (!A) return [];
        const out = [A.defaultDriver];
        if (A.oddDriver) out.push(A.oddDriver);
        Object.keys(A.activityDriver).forEach((k) => out.push(A.activityDriver[k]));
        return out.filter((x, i) => out.indexOf(x) === i);
      }

      /** Normalise the teacher's fields: Auto ('auto', null, missing) becomes null / []. */
      function normFixed(f) {
        const x = f || {};
        const ids = Array.isArray(x.activityIds) ? x.activityIds.filter((a) => typeof a === 'string' && a !== 'auto')
          : (typeof x.activityId === 'string' && x.activityId !== 'auto' ? [x.activityId] : []);
        const rep = typeof x.representation === 'string' && x.representation !== 'auto' ? x.representation : null;
        const diff = isLevel(x.difficulty) ? x.difficulty : null;
        return { activityIds: ids, representation: rep, difficulty: diff };
      }

      function candidateList(c, fixed, driver) {
        const A = tableOf(c);
        if (!A) return [];
        const f = normFixed(fixed);
        const listed = f.activityIds.filter((id) => A.activities.indexOf(id) >= 0);
        // addsub.mixed: only the driver's matrix row (the even or odd row, or the slot concept's row)
        const d = driver || A.defaultDriver;
        const base = A.mixed ? C.matrixColumns.map((r) => adaptiveEngine.activityFor(d, r)).filter((x) => x) : A.activities;
        // listed activities that fit c; every fitting activity only when the teacher listed none (N4)
        let F = f.activityIds.length ? listed : base.slice();
        if (f.representation) F = F.filter((id) => repOf(id) === f.representation);
        if (A.mixed) F = F.filter((id) => inRow(d, id));
        return F;
      }

      function evaluate(cache, c, cfg) {
        const snap = cache && cache.mastery ? cache.mastery[c] : null;
        return { snap: snap || null, m: masteryEngine.evaluate(snap || masteryEngine.empty(null, c), cfg.mastery, cache && cache.now, cfg.error) };
      }
      function decideOn(driver, fallback, cache, cfg) {
        const e = evaluate(cache, driver, cfg);
        return adaptiveEngine.decide({ conceptId: driver, mastery: e.m, snapshot: e.snap, fallback: fallback, now: cache && cache.now }, cfg.adaptive);
      }
      const hasData = (cache, c, cfg) => evaluate(cache, c, cfg).m.level !== 'insufficient_data';

      function resolveTarget(c, fixed, where, cache, cfg0) {
        const cfg = Object.assign({ mastery: config.mastery, adaptive: config.adaptive, error: config.error }, cfg0 || {});
        const A = tableOf(c);
        if (!A) return null;
        const w = where || { kind: 'assignment', j: 0 };
        const j = Math.max(0, Math.floor(Number(w.j) || 0));
        const f = normFixed(fixed);
        // 1. preferred driver
        let p = defaultDriver(c, j);
        const sc = w.kind === 'slot' ? w.slotConceptId : null;
        if (sc && (sc === c || namedDrivers(c).indexOf(sc) >= 0 || A.mixed) && adaptiveEngine.isMatrixConcept(sc)) p = sc;
        // the no-data default: the slot's v1 default when p is the slot concept, else the table default
        const nd0 = sc && p === sc && w.v1Default ? w.v1Default : (A.mixed && j % 2 === 1 ? A.oddDefault : A.default);
        const noData = { activityId: nd0.activityId, difficulty: nd0.difficulty, representation: repOf(nd0.activityId) };
        // 2. candidate list
        let F = candidateList(c, f, p);
        if (!F.length && A.mixed && sc) {
          const rep = adaptiveEngine.nearestAvailable(p, f.representation || 'visual', cfg.adaptive);
          const act = rep ? adaptiveEngine.activityFor(p, rep) : null;
          if (act) F = [act];
        }
        // 3. activity
        const anyFixed = f.activityIds.length > 0 || !!f.representation;
        let activityId = null, dec = null;
        if (anyFixed && F.length) {
          if (w.kind === 'assignment') {
            const rot = Math.max(0, Math.floor(Number(w.rot !== undefined ? w.rot : j) || 0));
            activityId = F[rot % F.length];
          } else activityId = F.find((id) => inRow(p, id)) || F[0];
        } else if (!anyFixed && hasData(cache, p, cfg)) {
          dec = decideOn(p, noData, cache, cfg);
          activityId = dec.activityId;
        }
        if (!activityId || (A.activities.indexOf(activityId) < 0 && !(A.mixed && inRow(p, activityId)))) {
          activityId = F.length ? (F.indexOf(noData.activityId) >= 0 ? noData.activityId : F[0]) : noData.activityId;
        }
        // 4. driver
        const driver = inRow(p, activityId) ? p : (own(A.activityDriver, activityId) ? A.activityDriver[activityId] : defaultDriver(c, j));
        // 5. difficulty
        let difficulty;
        if (f.difficulty) difficulty = f.difficulty;
        else if (hasData(cache, driver, cfg)) {
          const d2 = dec && driver === p ? dec : decideOn(driver, noData, cache, cfg);
          if (!dec) dec = d2;
          difficulty = d2.toDifficulty;
        } else difficulty = noData.difficulty;
        let clamped = false;
        if (A.levels.indexOf(difficulty) < 0) {
          const lo = A.levels[0], hi = A.levels[A.levels.length - 1];
          difficulty = util.clamp(difficulty, lo, hi);
          clamped = true;
        }
        // 6. template
        const meta = catalog.activityById(activityId);
        const template = meta && meta.templates ? (driver === 'sub.difference' ? 'diff' : 'take') : null;
        return { conceptId: c, driverConceptId: driver, activityId, representation: repOf(activityId), difficulty, template, clamped, adaptive: dec };
      }

      /** The candidate lists validation checks: { even, odd } for addsub.mixed, else { all }. */
      function listsFor(c, fixed) {
        const A = tableOf(c);
        if (!A) return {};
        return A.mixed ? { even: candidateList(c, fixed, A.defaultDriver), odd: candidateList(c, fixed, A.oddDriver) } : { all: candidateList(c, fixed) };
      }

      /** Per-concept checks shared by overrides and assignments (17.4, 17.6). */
      function conceptProblems(c, fixed, out) {
        const A = tableOf(c);
        const lists = listsFor(c, fixed);
        const keys = Object.keys(lists);
        if (keys.some((k) => !lists[k].length)) { out.push({ field: 'conceptIds', code: 'no_activity_fits', conceptId: c }); return; }
        const f = normFixed(fixed);
        if (f.difficulty) {
          const acts = [];
          keys.forEach((k) => lists[k].forEach((id) => acts.push(id)));
          const ok = A.levels.indexOf(f.difficulty) >= 0 && acts.every((id) => catalog.activityById(id).difficulties.indexOf(f.difficulty) >= 0);
          if (!ok) out.push({ field: 'difficulty', code: 'level_not_available', conceptId: c });
        }
      }

      function validateOverride(o) {
        const x = o || {};
        const out = [];
        const c = x.conceptId;
        if (typeof c !== 'string' || !c) return [{ field: 'conceptId', code: 'concept_required' }];
        const A = tableOf(c);
        if (!A) return [{ field: 'conceptId', code: 'concept_not_selectable', conceptId: c }];
        const f = normFixed(x);
        if (x.difficulty !== undefined && x.difficulty !== null && x.difficulty !== 'auto' && !isLevel(x.difficulty)) {
          out.push({ field: 'difficulty', code: 'bad_level' });
        }
        if (f.representation && !catalog.representationById(f.representation)) out.push({ field: 'representation', code: 'unknown_representation' });
        if (f.activityIds.length) {
          if (A.mixed) out.push({ field: 'activityId', code: 'activity_not_offered' });
          else if (A.activities.indexOf(f.activityIds[0]) < 0) out.push({ field: 'activityId', code: 'activity_does_not_fit', activityId: f.activityIds[0], conceptId: c });
        }
        if (!out.length) conceptProblems(c, f, out);
        return out;
      }

      const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
      function validDate(s) {
        const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
        if (!m) return false;
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const dt = new Date(Date.UTC(y, mo - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
      }

      function validateAssignment(a, opts) {
        const x = a || {};
        const o = opts || {};
        const out = [];
        if (typeof x.name !== 'string' || !x.name.trim()) out.push({ field: 'name', code: 'name_required' });
        else if (x.name.length > 60) out.push({ field: 'name', code: 'name_too_long' });
        const concepts = Array.isArray(x.conceptIds) ? x.conceptIds : [];
        if (!concepts.length) out.push({ field: 'conceptIds', code: 'concepts_required' });
        concepts.forEach((c) => { if (!tableOf(c)) out.push({ field: 'conceptIds', code: 'concept_not_selectable', conceptId: c }); });
        const good = concepts.filter((c) => tableOf(c));
        const f = normFixed(x);
        if (x.difficulty !== 'auto' && !isLevel(x.difficulty)) out.push({ field: 'difficulty', code: 'bad_level' });
        if (x.representation !== 'auto' && !catalog.representationById(x.representation)) out.push({ field: 'representation', code: 'unknown_representation' });
        f.activityIds.forEach((id) => {
          if (!good.some((c) => tableOf(c).activities.indexOf(id) >= 0)) out.push({ field: 'activityIds', code: 'activity_does_not_fit', activityId: id });
        });
        good.forEach((c) => conceptProblems(c, f, out));
        const hasCount = x.questionCount !== null && x.questionCount !== undefined;
        const hasMinutes = x.targetMinutes !== null && x.targetMinutes !== undefined;
        if (hasCount === hasMinutes) out.push({ field: 'questionCount', code: 'one_target_required' });
        else if (hasCount && !(Number.isInteger(x.questionCount) && x.questionCount >= 5 && x.questionCount <= 20)) out.push({ field: 'questionCount', code: 'count_out_of_range' });
        else if (hasMinutes && !(Number.isInteger(x.targetMinutes) && x.targetMinutes >= 3 && x.targetMinutes <= 20)) out.push({ field: 'targetMinutes', code: 'minutes_out_of_range' });
        if (x.dueDate !== null && x.dueDate !== undefined) {
          if (!validDate(x.dueDate)) out.push({ field: 'dueDate', code: 'bad_due_date' });
          else if (o.creating && typeof o.now === 'number' && x.dueDate < util.localDate(o.now)) out.push({ field: 'dueDate', code: 'due_date_past' });
        }
        const ids = Array.isArray(x.studentIds) ? x.studentIds : [];
        // A closed assignment may list nobody (its only student was deleted: review P6-2); reopening needs someone.
        if (!x.classId && !ids.length && x.status !== 'closed') out.push({ field: 'studentIds', code: 'who_required' });
        return out;
      }

      /**
       * 14.8 families: the active overrides a new one ends when saved (same family; mixed ends
       * addition and subtraction; addition or subtraction ends mixed), so at most one applies to a slot.
       */
      function overridesToEnd(next, active) {
        const f = familyOf(next && next.conceptId);
        return (Array.isArray(active) ? active : []).filter((o) => {
          if (!o || o.status !== 'active' || o.studentId !== next.studentId || o.id === next.id) return false;
          const g = familyOf(o.conceptId);
          return g === f || f === 'mixed' || g === 'mixed';
        });
      }

      /**
       * DESIGN 17.6: completion is derived, never stored. Count mode: attempts >= questionCount; minutes
       * mode: the summed totalMs of every sitting >= targetMinutes x 60000. progress = { count, totalMs }.
       */
      function assignmentComplete(a, progress) {
        const p = progress || { count: 0, totalMs: 0 };
        if (!a) return false;
        if (typeof a.questionCount === 'number') return (p.count || 0) >= a.questionCount;
        if (typeof a.targetMinutes === 'number') return (p.totalMs || 0) >= a.targetMinutes * 60000;
        return false;
      }

      return { resolveTarget, candidateList, listsFor, validateOverride, validateAssignment, familyOf, defaultDriver, normFixed,
        overridesToEnd, assignmentComplete, SELECTABLE };
    });
}());
