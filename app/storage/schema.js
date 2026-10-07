/*
 * schema (L3): the IndexedDB database definition and record validation (DESIGN 9.2, 9.3).
 * DB_VERSION is the browser database version; SCHEMA_VERSION is the data format version
 * (recorded in meta.schema and in every export). Step 1 of migrations.idbSteps creates
 * every store and index below, so later phases add validators, never a version bump.
 *
 * validate(store, record) -> string[] of problems (empty = valid). Generic rules for every
 * store: the record is a plain object, values are JSON-compatible, no key named __proto__,
 * constructor or prototype at any depth (forbidden_key), and no unknown top-level field
 * (unknown_field:<name>). A store without a validator yet rejects every write (no_validator).
 */
(function () {
  'use strict';

  NBA.define('schema', ['config', 'util', 'catalog', 'targets'], (config, util, catalog, targets) => {
    const validateOverride = targets.validateOverride;
    const DB_NAME = 'ninjaBrickAcademy';
    const DB_VERSION = 1;
    const SCHEMA_VERSION = 1;
    const APP_VERSION = '2.0.0';

    /** store -> { keyPath, indexes: [[name, keyPath]] } (DESIGN 9.2). */
    const STORES = {
      meta: { keyPath: 'key', indexes: [] },
      classes: { keyPath: 'id', indexes: [['status', 'status']] },
      students: { keyPath: 'id', indexes: [['classId', 'classId'], ['status', 'status']] },
      worldProgress: { keyPath: ['studentId', 'worldId'], indexes: [['studentId', 'studentId']] },
      sessions: { keyPath: 'id', indexes: [['studentId', 'studentId']] },
      attempts: {
        keyPath: 'id',
        indexes: [['studentId', 'studentId'], ['studentTime', ['studentId', 'timestamp']], ['sessionId', 'sessionId'],
          ['assignmentId', 'assignmentId'], ['assessmentId', 'assessmentId']]
      },
      mastery: { keyPath: ['studentId', 'conceptId'], indexes: [['studentId', 'studentId']] },
      recommendations: { keyPath: ['studentId', 'conceptId'], indexes: [['studentId', 'studentId']] },
      overrides: { keyPath: 'id', indexes: [['studentId', 'studentId'], ['status', 'status']] },
      assignments: { keyPath: 'id', indexes: [['classId', 'classId'], ['status', 'status']] },
      assessments: { keyPath: 'id', indexes: [['studentId', 'studentId']] }
    };
    const STORE_NAMES = Object.keys(STORES);

    const ID_RE = {
      cls: /^cls_[a-z0-9]{16}$/,
      stu: /^stu_[a-z0-9]{16}$/,
      ses: /^ses_[a-z0-9]{16}$/,
      att: /^att_[a-z0-9]{16}$/,
      asg: /^asg_[a-z0-9]{16}$/,
      asm: /^asm_[a-z0-9]{16}$/,
      ovr: /^ovr_[a-z0-9]{16}$/
    };
    /** A world mission, an assignment question or an assessment cell (DESIGN 9.2). */
    const MISSION_RE = /^([a-z]+\.m[1-8]|asg_[a-z0-9]{16}\.q\d+|ninja-check\.v1\.c\d{2})$/;
    const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
    const STATUS = ['active', 'archived'];
    const WP_SOURCES = ['play', 'v1-migration', 'import'];
    const MIGRATION_STATUS = ['done', 'failed'];

    /** The primary key of a record for its store (an array for compound key paths). */
    function keyOf(store, record) {
      const kp = STORES[store].keyPath;
      return Array.isArray(kp) ? kp.map((p) => record[p]) : record[kp];
    }

    function isPlainObject(x) {
      if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
      const proto = Object.getPrototypeOf(x);
      return proto === Object.prototype || proto === null;
    }

    /** JSON-compatible value check with forbidden keys at any depth. */
    function checkValue(v, path, out, depth) {
      if (depth > 32) { out.push('too_deep:' + path); return; }
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number') { if (!Number.isFinite(v)) out.push('not_json:' + path); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => checkValue(x, path + '[' + i + ']', out, depth + 1)); return; }
      if (isPlainObject(v)) {
        Object.getOwnPropertyNames(v).forEach((k) => {
          if (FORBIDDEN.has(k)) { out.push('forbidden_key:' + path + '.' + k); return; }
          checkValue(v[k], path + '.' + k, out, depth + 1);
        });
        return;
      }
      out.push('not_json:' + path);
    }

    // ---------- field helpers: each returns a problem string or null ----------
    const isInt = (x) => typeof x === 'number' && Number.isInteger(x);
    const time = (x) => (isInt(x) && x >= 0 ? null : 'bad_time');
    const bool = (x) => (typeof x === 'boolean' ? null : 'not_boolean');
    const oneOf = (list) => (x) => (list.indexOf(x) >= 0 ? null : 'not_one_of:' + list.join('|'));
    const text = (min, max) => (x) => (typeof x === 'string' && x.trim().length >= min && x.length <= max ? null : 'bad_text_' + min + '_' + max);
    // eslint-disable-next-line no-control-regex
    const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
    /** P6 (17.2): teacher-entered names: trimmed length in range and no control characters. */
    const plainText = (min, max) => (x) => (typeof x === 'string' && !CONTROL_RE.test(x) ? text(min, max)(x) : 'bad_text_' + min + '_' + max);
    const LOCAL_ID_RE = /^[A-Za-z0-9 _-]{0,20}$/;
    const id = (re) => (x) => (typeof x === 'string' && re.test(x) ? null : 'bad_id');
    const nullable = (f) => (x) => (x === null ? null : f(x));
    const hero = (x) => (typeof x === 'string' && catalog.heroById(x) ? null : 'unknown_hero');
    const world = (x) => (typeof x === 'string' && catalog.worldById(x) ? null : 'unknown_world');
    const intRange = (lo, hi) => (x) => (isInt(x) && x >= lo && x <= hi ? null : 'bad_int_' + lo + '_' + hi);
    const str = (x) => (typeof x === 'string' ? null : 'not_string');
    const obj = (x) => (isPlainObject(x) ? null : 'not_object');
    const intMin = (lo) => (x) => (isInt(x) && x >= lo ? null : 'bad_int_min_' + lo);
    const anyInt = (x) => (isInt(x) ? null : 'not_int');
    const ints = (x) => (Array.isArray(x) && x.every(isInt) ? null : 'not_int_array');
    const strs = (x) => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? null : 'not_string_array');
    const known = (lookup, what) => (x) => (typeof x === 'string' && lookup(x) ? null : 'unknown_' + what);
    const concept = known(catalog.conceptById, 'concept');
    const activity = known(catalog.activityById, 'activity');
    const concepts = (x) => (Array.isArray(x) && x.length > 0 && x.every((c) => !concept(c)) && new Set(x).size === x.length ? null : 'bad_concepts');
    const intObject = (x) => (isPlainObject(x) && Object.keys(x).every((k) => isInt(x[k])) ? null : 'not_int_object');
    const speed = (x) => (typeof x === 'number' && x > 0 && x <= 1 ? null : 'bad_speed');
    const mission = (x) => (typeof x === 'string' && MISSION_RE.test(x) ? null : 'bad_mission_id');
    const CONTEXTS = ['play', 'assignment', 'assessment'];
    const SOURCES = ['assignment', 'override', 'adaptive', 'default', 'assessment'];

    // ---------- assessments (P5): items, answers and result ----------
    const ASM_STATUS = ['pending', 'in_progress', 'complete', 'cancelled'];
    const ITEM = {
      cellId: text(1, 10), activityId: activity, conceptId: concept, representation: known(catalog.representationById, 'representation'),
      difficulty: intRange(1, 4), template: nullable(oneOf(['take', 'diff'])), transfer: bool, seed: intRange(0, 4294967295),
      questionId: text(1, 60), numbers: intObject, instanceReused: bool
    };
    /** Exactly the ITEM fields on every item (no more, no fewer). */
    function fieldsOk(x, spec) {
      if (!isPlainObject(x)) return false;
      const keys = Object.keys(x);
      return keys.length === Object.keys(spec).length && keys.every((k) => Object.prototype.hasOwnProperty.call(spec, k) && !spec[k](x[k]));
    }
    const asmItems = (x) => (Array.isArray(x) && x.length > 0 && x.every((it) => fieldsOk(it, ITEM)) ? null : 'bad_items');
    const SCORE = { correct: intMin(0), total: intMin(0), percent: nullable((p) => (typeof p === 'number' && p >= 0 && p <= 100 ? null : 'bad_percent')) };
    const scoreMap = (m) => isPlainObject(m) && Object.keys(m).every((k) => fieldsOk(m[k], SCORE));
    const asmResult = (x) => (fieldsOk(x, Object.assign({}, SCORE, { byConcept: (m) => (scoreMap(m) ? null : 'bad'), byRepresentation: (m) => (scoreMap(m) ? null : 'bad') }))
      ? null : 'bad_result');
    const ANSWER = { attemptId: id(ID_RE.att), submitted: anyInt, correct: bool };
    /** Items follow the blueprint's cells in order; answers name items; the status fits the answers. */
    function asmCross(r) {
      const out = [];
      const bp = catalog.blueprintById(r.blueprintId);
      const cells = bp.cells.map((c) => c.id);
      if (r.items.map((it) => it.cellId).join() !== cells.join()) out.push('items:not_the_blueprint_cells');
      const answered = Object.keys(r.answers);
      if (!answered.every((k) => cells.indexOf(k) >= 0 && fieldsOk(r.answers[k], ANSWER))) out.push('answers:bad_answer');
      if ((r.status === 'pending' || r.status === 'cancelled') && answered.length) out.push('status:answers_present');
      if (r.status === 'in_progress' && (!answered.length || r.startedAt === null)) out.push('status:in_progress_without_answers');
      if (r.status === 'complete' && (answered.length !== cells.length || r.completedAt === null || r.result === null)) out.push('status:complete_unfinished');
      if (r.status !== 'complete' && (r.completedAt !== null || r.result !== null)) out.push('status:result_before_complete');
      if (r.status === 'cancelled' && !r.cancelledAt) out.push('status:cancelled_without_time');
      return out;
    }

    /** store -> { required: { field: check }, optional: { field: check } }, or a function of the record. */
    const RECORDS = {
      classes: {
        required: { id: id(ID_RE.cls), name: plainText(1, 40), status: oneOf(STATUS), createdAt: time, updatedAt: time },
        optional: {}
      },
      students: {
        required: {
          id: id(ID_RE.stu), name: plainText(1, 30), classId: nullable(id(ID_RE.cls)), status: oneOf(STATUS),
          isDefault: bool, baselineRequired: bool, createdAt: time, updatedAt: time
        },
        optional: { localId: (x) => (typeof x === 'string' && LOCAL_ID_RE.test(x) ? null : 'bad_local_id'), heroId: nullable(hero),
          archivedWithClass: nullable(id(ID_RE.cls)) }
      },
      /** DESIGN 17.6 (P6): the teacher's assignment; the rules are learningEngine.validateAssignment. */
      assignments: {
        required: {
          id: id(ID_RE.asg), name: plainText(1, 60), classId: nullable(id(ID_RE.cls)),
          studentIds: (x) => (Array.isArray(x) && x.every((s) => !id(ID_RE.stu)(s)) ? null : 'bad_student_ids'),
          conceptIds: strs, activityIds: strs,
          difficulty: (x) => (x === 'auto' || (isInt(x) && x >= 1 && x <= 4) ? null : 'bad_difficulty'),
          representation: (x) => (x === 'auto' || (typeof x === 'string' && catalog.representationById(x)) ? null : 'bad_representation'),
          questionCount: nullable(intRange(5, 20)), targetMinutes: nullable(intRange(3, 20)),
          dueDate: nullable((x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? null : 'bad_date')),
          status: oneOf(['open', 'closed']), createdAt: time, updatedAt: time
        },
        optional: {},
        cross(r) { return targets.validateAssignment(r, {}).map((p) => p.field + ':' + p.code); }
      },
      worldProgress: {
        required: {
          studentId: id(ID_RE.stu), worldId: world, best: intRange(0, config.MISSIONS_PER_WORLD), done: bool,
          updatedAt: time, source: oneOf(WP_SOURCES)
        },
        optional: {}
      },
      sessions: {
        required: { id: id(ID_RE.ses), studentId: id(ID_RE.stu), kind: oneOf(CONTEXTS), startedAt: time, attemptCount: intMin(0) },
        optional: { endedAt: nullable(time), worldId: nullable(world), assignmentId: nullable(id(ID_RE.asg)), assessmentId: nullable(id(ID_RE.asm)) }
      },
      /** DESIGN 11: every field is required (null where it does not apply), so no attempt lacks one. */
      attempts: {
        required: {
          id: id(ID_RE.att), schemaVersion: intRange(1, 1), timestamp: time, shownAt: time, studentId: id(ID_RE.stu),
          sessionId: id(ID_RE.ses), context: oneOf(CONTEXTS), assignmentId: nullable(id(ID_RE.asg)),
          assessmentId: nullable(id(ID_RE.asm)), assessmentForm: nullable(oneOf(['baseline', 'post'])),
          assessmentCellId: nullable(text(1, 40)), worldId: nullable(world), missionId: mission, missionIndex: intRange(0, 999),
          activityId: activity, questionType: activity, operation: text(1, 20), conceptId: concept, conceptIds: concepts,
          difficulty: intRange(1, 4), max: oneOf([10, 20]), representation: known(catalog.representationById, 'representation'),
          questionId: text(1, 60), seed: intRange(0, 4294967295), numbers: intObject, template: nullable(oneOf(['take', 'diff'])),
          correctAnswer: anyInt, choices: nullable(ints), submittedAnswers: ints, submittedAnswer: nullable(anyInt),
          correct: bool, outcome: oneOf(['correct', 'incorrect', 'abandoned']), firstAttemptCorrect: bool,
          wrongCount: intMin(0), hintUsed: bool, hintsShown: intMin(0), responseMs: nullable(intMin(0)), totalMs: nullable(intMin(0)),
          decisionSource: oneOf(SOURCES), decision: nullable(obj), inputMode: oneOf(['choices', 'build', 'towers']),
          observations: strs, starEarned: nullable(bool), speed: speed
        },
        optional: {},
        cross(r) {
          const out = [];
          if (r.questionType !== r.activityId) out.push('questionType:differs_from_activityId');
          if (Array.isArray(r.conceptIds) && r.conceptIds[0] !== r.conceptId) out.push('conceptIds:primary_not_first');
          const a = catalog.activityById(r.activityId);
          if (a && (a.representation !== r.representation || a.inputMode !== r.inputMode || a.operation !== r.operation)) out.push('activity_metadata_mismatch');
          if (r.context === 'play' && !r.worldId) out.push('worldId:required_in_play');
          if ((r.outcome === 'correct') !== r.correct) out.push('correct:differs_from_outcome');
          return out;
        }
      },
      /** DESIGN 12.2: the mastery snapshot (a cache that can be rebuilt from attempts). */
      mastery: {
        required: {
          studentId: id(ID_RE.stu), conceptId: concept, updatedAt: nullable(time), lastAttemptAt: nullable(time),
          total: intMin(0), correctAttempts: intMin(0), firstCorrect: intMin(0), submissions: intMin(0), correctSubmissions: intMin(0),
          hinted: intMin(0), abandoned: intMin(0), byRepresentation: obj, byDifficulty: obj,
          consecutiveCorrect: intMin(0), consecutiveIncorrect: intMin(0),
          recent: (x) => (Array.isArray(x) && x.length <= config.mastery.recentWindow && x.every(isPlainObject) ? null : 'bad_recent'),
          play: nullable(obj)
        },
        optional: {}
      },
      /** DESIGN 9.2: one automatic recommendation per student and concept. */
      recommendations: {
        required: { studentId: id(ID_RE.stu), conceptId: concept, createdAt: time, source: oneOf(['adaptive']), decision: obj },
        optional: {}
      },
      /** DESIGN 9.2, 17.4: teacher overrides; null fields are Auto. */
      overrides: {
        required: { id: id(ID_RE.ovr), studentId: id(ID_RE.stu), conceptId: concept, status: oneOf(['active', 'ended']), createdAt: time },
        optional: {
          difficulty: nullable(intRange(1, 4)), representation: nullable(known(catalog.representationById, 'representation')),
          activityId: nullable(activity), endedAt: nullable(time), note: text(0, 200)
        },
        cross(r) { return validateOverride ? validateOverride(r).map((p) => p.field + ':' + p.code) : []; }
      },
      /** DESIGN 15.4 (P5, N15): one Ninja Check run with its items, single answers and result. */
      assessments: {
        required: {
          id: id(ID_RE.asm), studentId: id(ID_RE.stu), form: oneOf(['baseline', 'post']),
          blueprintId: known(catalog.blueprintById, 'blueprint'), status: oneOf(ASM_STATUS), createdAt: time,
          createdBy: oneOf(['teacher', 'system']), startedAt: nullable(time), completedAt: nullable(time),
          items: asmItems, answers: obj, result: nullable(asmResult)
        },
        optional: { cancelledAt: nullable(time) },
        cross: asmCross
      },
      meta(record) {
        if (record.key === 'schema') {
          return {
            required: { key: str, schemaVersion: intRange(1, 1000), appVersion: text(1, 20), createdAt: time, updatedAt: time },
            optional: {}
          };
        }
        if (record.key === 'v1Migration') {
          return {
            required: { key: str, status: oneOf(MIGRATION_STATUS), sourceHash: (x) => (typeof x === 'string' && /^[0-9a-f]{8}$/.test(x) ? null : 'bad_hash') },
            optional: { migratedAt: nullable(time), studentId: nullable(id(ID_RE.stu)), report: obj }
          };
        }
        if (record.key === 'lastImport') { // N12 (P7): what the latest import brought in (DESIGN 18.4 step 8)
          return {
            required: { key: str, at: time, sourceSchemaVersion: intRange(1, 1000), sourceAppVersion: text(1, 20),
              sourceExportedAt: text(1, 40), sourceOrigin: text(0, 200), counts: intObject },
            optional: {}
          };
        }
        return null;
      }
    };

    /** Problems with one record for one store; [] when it may be written. */
    function validate(store, record) {
      if (!Object.prototype.hasOwnProperty.call(STORES, store)) return ['unknown_store:' + store];
      if (!isPlainObject(record)) return ['not_object'];
      const out = [];
      checkValue(record, '$', out, 0);
      if (out.length) return out;
      let def = RECORDS[store];
      if (typeof def === 'function') def = def(record);
      if (!def) return [store === 'meta' ? 'unknown_meta_key:' + String(record.key) : 'no_validator:' + store];
      Object.keys(record).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(def.required, k) && !Object.prototype.hasOwnProperty.call(def.optional, k)) {
          out.push('unknown_field:' + k);
        }
      });
      Object.keys(def.required).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(record, k)) { out.push('missing_field:' + k); return; }
        const p = def.required[k](record[k]);
        if (p) out.push(k + ':' + p);
      });
      Object.keys(def.optional).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(record, k)) return;
        const p = def.optional[k](record[k]);
        if (p) out.push(k + ':' + p);
      });
      if (!out.length && typeof def.cross === 'function') out.push.apply(out, def.cross(record));
      return out;
    }

    return {
      DB_NAME, DB_VERSION, SCHEMA_VERSION, APP_VERSION, STORES, STORE_NAMES, ID_RE, MISSION_RE,
      keyOf, validate, isValidKey: util.isValidKey
    };
  });
}());
