/*
 * exporter (L3): JSON and CSV export (DESIGN 18.1 to 18.3, D10). Nothing leaves the device: every
 * file is built in memory as a string and handed to the browser as a Blob download.
 *
 *   collect(scope, studentId?)   reads every store; scope 'all', or 'student' (that student's records,
 *                                their class, the assignments that target them and the classes those name)
 *   references(data, current?)   records whose studentId or classId names nothing in data or current
 *                                (the import step 5 check; assignment studentIds lists are not references)
 *   withoutOrphans(data)         { data, leftOut }: records with no student (or class) are left out, so the
 *                                device's own export always passes its own import check
 *   bundle(data, { scope, studentId, now, origin })   the 18.2 envelope with counts and checksum
 *   attemptsCsv(data) / masterySummaryCsv(data, now) / assessmentsCsv(data)   the 18.3 files: UTF-8 BOM,
 *                                CRLF, RFC 4180 quoting, ISO UTC times, | lists, the formula guard on
 *                                every text cell (cell(); numbers stay numbers), and the header row
 *                                even with no data rows
 *   exportJson({ scope, studentId }) / exportCsv(kind)   { ok, name, text, mime, ... } ready to download
 *   download(name, text, mime)   Blob + object URL + a temporary <a download>; the URL is revoked after
 *                                the click. Without Blob or URL.createObjectURL: { ok: false, message }
 *                                ("Export is not available in this browser.") and one console.warn.
 * create({ repo?, now?, origin? }) makes an independent exporter (tests); the module itself is the app's.
 */
(function () {
  'use strict';

  NBA.define('exporter', ['config', 'util', 'catalog', 'schema', 'masteryEngine', 'assessmentEngine', 'repo'],
    (config, util, catalog, schema, masteryEngine, assessmentEngine, appRepo) => {
      const FORMAT = 'nba-export';
      const BOM = '\ufeff';
      const CRLF = '\r\n';
      /** Stores whose records belong to one student, and stores whose records name a class. */
      const STUDENT_STORES = ['worldProgress', 'sessions', 'attempts', 'mastery', 'recommendations', 'overrides', 'assessments'];
      const CLASS_STORES = ['students', 'assignments'];
      const NOT_AVAILABLE = 'Export is not available in this browser.';

      /** DESIGN 18.3 headers (export.test.js compares them with the design's lists). */
      const COLUMNS = {
        attempts: ['attempt_id', 'timestamp', 'student_id', 'student_name', 'local_id', 'class_id', 'session_id', 'context',
          'assignment_id', 'assessment_id', 'assessment_form', 'world_id', 'mission_id', 'activity_id', 'question_type', 'operation',
          'concept_id', 'concept_ids', 'difficulty', 'max', 'representation', 'question_id', 'seed', 'correct_answer',
          'submitted_answers', 'submitted_answer', 'correct', 'outcome', 'first_attempt_correct', 'wrong_count', 'hint_used',
          'hints_shown', 'response_ms', 'total_ms', 'decision_source', 'decision_action', 'decision_reason', 'observations'],
        mastery: ['student_id', 'student_name', 'local_id', 'class_id', 'concept_id', 'concept_name', 'level', 'confidence',
          'total_attempts', 'correct_attempts', 'accuracy', 'first_attempt_accuracy', 'recent_accuracy',
          'recent_first_attempt_accuracy', 'recent_trend', 'hint_dependence', 'hint_band', 'representations_covered',
          'consecutive_correct', 'consecutive_incorrect', 'patterns', 'recommended_action', 'recommended_reason',
          'active_override', 'last_attempt', 'computed_at'],
        assessments: ['assessment_id', 'student_id', 'student_name', 'local_id', 'class_id', 'form', 'blueprint_id', 'status',
          'created_at', 'completed_at', 'cell_id', 'concept_id', 'representation', 'difficulty', 'activity_id', 'question_id',
          'seed', 'correct_answer', 'submitted_answer', 'item_correct', 'instance_reused', 'run_correct', 'run_total', 'run_percent']
      };
      /** File-name part and download type of each CSV (all data; DESIGN 18.1 names hold no student names). */
      const CSV_KINDS = { attempts: 'attempts', mastery: 'mastery-summary', assessments: 'assessments' };

      const listOf = (data, store) => (data && Array.isArray(data[store]) ? data[store] : []);
      const byId = (list) => { const m = {}; list.forEach((r) => { m[r.id] = r; }); return m; };
      const cmpStr = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

      /* ---------- formatting (DESIGN 18.3) ---------- */
      const iso = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : '');
      const ratio = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '');
      const list = (a) => (Array.isArray(a) ? a.join('|') : '');
      const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
      /**
       * One CSV field, used for every cell of every CSV: booleans as true/false, RFC 4180 quoting, and
       * the formula guard (a leading ') on any text that starts with = + - @ tab or CR, whatever the
       * column. Only finite numbers and lists of finite numbers (joined with |) are left as they are:
       * they hold no formula, and a negative number stays a number.
       */
      function cell(v) {
        if (v === null || v === undefined) return '';
        let s;
        if (typeof v === 'boolean') s = v ? 'true' : 'false';
        else if (isNum(v)) s = String(v);
        else if (Array.isArray(v) && v.every(isNum)) s = v.join('|');
        else {
          s = Array.isArray(v) ? v.join('|') : String(v);
          if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
        }
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      /** BOM + header + one CRLF-terminated line per row. */
      function csv(kind, rows) {
        const cols = COLUMNS[kind];
        const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(',')));
        return BOM + lines.join(CRLF) + CRLF;
      }
      function stamp(ms) {
        const d = new Date(ms);
        const p = (n) => (n < 10 ? '0' : '') + n;
        return util.localDate(ms) + '_' + p(d.getHours()) + p(d.getMinutes());
      }
      /** ninja-brick-academy_<scope>_<YYYY-MM-DD_HHmm>.<ext> (local time). */
      const fileName = (scope, ext, ms) => 'ninja-brick-academy_' + scope + '_' + stamp(ms) + '.' + ext;
      /** student-<id8>: the last 8 characters of the id (its random part), never the name. */
      const studentScope = (id) => 'student-' + String(id).slice(-8);

      /* ---------- references and orphans (DESIGN 18.1, 18.4 step 5) ---------- */
      function references(data, current) {
        const ids = (store) => new Set(listOf(data, store).concat(listOf(current, store)).map((r) => r.id));
        const students = ids('students'), classes = ids('classes');
        const out = [];
        STUDENT_STORES.forEach((store) => listOf(data, store).forEach((r, i) => {
          if (!students.has(r.studentId)) out.push({ store: store, index: i, field: 'studentId', value: r.studentId });
        }));
        CLASS_STORES.forEach((store) => listOf(data, store).forEach((r, i) => {
          if (r.classId !== null && r.classId !== undefined && !classes.has(r.classId)) {
            out.push({ store: store, index: i, field: 'classId', value: r.classId });
          }
        }));
        return out;
      }

      /** Leave out records that belong to no student (or name a missing class), repeated until none. */
      function withoutOrphans(data) {
        const out = {};
        schema.STORE_NAMES.forEach((s) => { out[s] = listOf(data, s).slice(); });
        const leftOut = [];
        for (let round = 0; round < 4; round++) {
          const problems = references(out, null);
          if (!problems.length) break;
          const drop = {};
          problems.forEach((p) => { (drop[p.store] = drop[p.store] || new Set()).add(p.index); });
          Object.keys(drop).forEach((store) => {
            out[store] = out[store].filter((r, i) => {
              if (!drop[store].has(i)) return true;
              leftOut.push({ store: store, key: schema.keyOf(store, r), field: problems.find((p) => p.store === store && p.index === i).field });
              return false;
            });
          });
        }
        return { data: out, leftOut: leftOut };
      }

      /** An assignment targets the student: listed by id, or their whole class (no ids listed). */
      function aimsAt(a, student) {
        const ids = a.studentIds || [];
        return ids.length ? ids.indexOf(student.id) >= 0 : (!!a.classId && !!student.classId && a.classId === student.classId);
      }

      /** One student's records, their class, the assignments that target them and the classes those name. */
      function forStudent(all, studentId) {
        const student = listOf(all, 'students').find((s) => s.id === studentId);
        if (!student) return null;
        const out = {};
        schema.STORE_NAMES.forEach((s) => { out[s] = []; });
        out.meta = listOf(all, 'meta').slice();
        out.students = [student];
        STUDENT_STORES.forEach((s) => { out[s] = listOf(all, s).filter((r) => r.studentId === studentId); });
        out.assignments = listOf(all, 'assignments').filter((a) => aimsAt(a, student));
        const classIds = new Set([student.classId].concat(out.assignments.map((a) => a.classId)).filter(Boolean));
        out.classes = listOf(all, 'classes').filter((c) => classIds.has(c.id));
        return out;
      }

      /** The DESIGN 18.2 envelope; counts leave out meta, which is exported for information only. */
      function bundle(data, o) {
        const counts = {};
        schema.STORE_NAMES.filter((s) => s !== 'meta').forEach((s) => { counts[s] = listOf(data, s).length; });
        const scope = o && o.scope === 'student' ? 'student' : 'all';
        return {
          format: FORMAT, schemaVersion: schema.SCHEMA_VERSION, appVersion: schema.APP_VERSION, exportedAt: iso(o.now),
          sourceOrigin: o.origin, scope: scope, studentIds: scope === 'student' ? [o.studentId] : null,
          counts: counts, data: data, checksum: util.fnv1a32(JSON.stringify(data))
        };
      }

      /* ---------- CSV rows (DESIGN 18.3) ---------- */
      const studentCols = (s) => ({ student_name: s ? s.name : null, local_id: s && s.localId ? s.localId : null, class_id: s ? s.classId : null });

      /** attempts.csv: one row per attempt, ordered by timestamp (then id). */
      function attemptsCsv(data) {
        const st = byId(listOf(data, 'students'));
        const rows = listOf(data, 'attempts').slice().sort((a, b) => (a.timestamp - b.timestamp) || cmpStr(a.id, b.id)).map((a) => {
          const d = a.decision || {};
          return Object.assign({
            attempt_id: a.id, timestamp: iso(a.timestamp), student_id: a.studentId, session_id: a.sessionId, context: a.context,
            assignment_id: a.assignmentId, assessment_id: a.assessmentId, assessment_form: a.assessmentForm, world_id: a.worldId,
            mission_id: a.missionId, activity_id: a.activityId, question_type: a.questionType, operation: a.operation,
            concept_id: a.conceptId, concept_ids: list(a.conceptIds), difficulty: a.difficulty, max: a.max,
            representation: a.representation, question_id: a.questionId, seed: a.seed, correct_answer: a.correctAnswer,
            submitted_answers: Array.isArray(a.submittedAnswers) ? a.submittedAnswers : null, submitted_answer: a.submittedAnswer, correct: a.correct,
            outcome: a.outcome, first_attempt_correct: a.firstAttemptCorrect, wrong_count: a.wrongCount, hint_used: a.hintUsed,
            hints_shown: a.hintsShown, response_ms: a.responseMs, total_ms: a.totalMs, decision_source: a.decisionSource,
            decision_action: d.action, decision_reason: d.reasonCode, observations: list(a.observations)
          }, studentCols(st[a.studentId]));
        });
        return csv('attempts', rows);
      }

      /**
       * mastery_summary.csv: one row per student and concept with at least 1 counted attempt,
       * recomputed at export time (masteryEngine.rebuild, then evaluate at `now`).
       */
      function masterySummaryCsv(data, now) {
        const attemptsOf = {};
        listOf(data, 'attempts').forEach((a) => { (attemptsOf[a.studentId] = attemptsOf[a.studentId] || []).push(a); });
        const reps = catalog.REPRESENTATIONS.map((r) => r.id);
        const rows = [];
        listOf(data, 'students').slice().sort((a, b) => cmpStr(a.id, b.id)).forEach((s) => {
          const atts = attemptsOf[s.id] || [];
          if (!atts.length) return;
          const active = listOf(data, 'overrides').filter((o) => o.studentId === s.id && o.status === 'active');
          catalog.CONCEPTS.forEach((c) => {
            const snap = masteryEngine.rebuild(atts, s.id, c.id, config.mastery);
            if (!snap.total) return;
            const ev = masteryEngine.evaluate(snap, config.mastery, now, config.error);
            const m = ev.metrics, cov = m.representationCoverage || {};
            rows.push(Object.assign({
              student_id: s.id, concept_id: c.id, concept_name: c.name, level: ev.level, confidence: ev.confidence,
              total_attempts: m.totalAttempts, correct_attempts: m.correctAttempts, accuracy: ratio(m.accuracy),
              first_attempt_accuracy: ratio(m.firstAttemptAccuracy), recent_accuracy: ratio(m.recentAccuracy),
              recent_first_attempt_accuracy: ratio(m.recentFirstAttemptAccuracy), recent_trend: m.recentTrend,
              hint_dependence: ratio(m.hintDependence), hint_band: m.hintBand,
              representations_covered: reps.filter((r) => cov[r] && cov[r].n > 0).join('|'),
              consecutive_correct: m.consecutiveCorrect, consecutive_incorrect: m.consecutiveIncorrect,
              patterns: (ev.patterns || []).map((p) => p.label + ':' + p.status).join('|'),
              recommended_action: ev.recommendedAction.action, recommended_reason: ev.recommendedAction.reasonCode,
              active_override: active.filter((o) => o.conceptId === c.id).map((o) => o.id).join('|'),
              last_attempt: iso(snap.lastAttemptAt), computed_at: iso(now)
            }, studentCols(s)));
          });
        });
        return csv('mastery', rows);
      }

      /** The right answer of an item: from its stored attempt, or the item's own question. */
      function itemAnswer(item, answer, attempts) {
        const att = answer && attempts[answer.attemptId];
        if (att && typeof att.correctAnswer === 'number') return att.correctAnswer;
        try { return assessmentEngine.questionFor(item, null).answer; } catch (e) { return null; }
      }

      /** assessments.csv: one row per item of every run (long format), runs oldest first. */
      function assessmentsCsv(data) {
        const st = byId(listOf(data, 'students'));
        const attempts = byId(listOf(data, 'attempts'));
        const rows = [];
        listOf(data, 'assessments').slice().sort((a, b) => (a.createdAt - b.createdAt) || cmpStr(a.id, b.id)).forEach((r) => {
          const res = r.result || null;
          (r.items || []).forEach((it) => {
            const ans = (r.answers || {})[it.cellId] || null;
            rows.push(Object.assign({
              assessment_id: r.id, student_id: r.studentId, form: r.form, blueprint_id: r.blueprintId, status: r.status,
              created_at: iso(r.createdAt), completed_at: iso(r.completedAt), cell_id: it.cellId, concept_id: it.conceptId,
              representation: it.representation, difficulty: it.difficulty, activity_id: it.activityId, question_id: it.questionId,
              seed: it.seed, correct_answer: itemAnswer(it, ans, attempts), submitted_answer: ans ? ans.submitted : null,
              item_correct: ans ? ans.correct : null, instance_reused: it.instanceReused,
              run_correct: res ? res.correct : null, run_total: res ? res.total : null, run_percent: res ? res.percent : null
            }, studentCols(st[r.studentId])));
          });
        });
        return csv('assessments', rows);
      }

      /* ---------- downloads (DESIGN 18.1) ---------- */
      function download(name, text, mime) {
        const g = typeof window !== 'undefined' ? window : globalThis;
        if (typeof g.Blob !== 'function' || !g.URL || typeof g.URL.createObjectURL !== 'function' || typeof document === 'undefined') {
          try { console.warn('[NBA] export is not available in this browser (no Blob or URL.createObjectURL)'); } catch (e) { /* ignore */ }
          return { ok: false, message: NOT_AVAILABLE };
        }
        const url = g.URL.createObjectURL(new g.Blob([text], { type: mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.hidden = true;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { g.URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 0);
        return { ok: true, name: name };
      }

      function pageOrigin() {
        try {
          const l = window.location;
          return l.protocol === 'file:' ? 'file://' : l.origin;
        } catch (e) { return ''; }
      }

      function create(options) {
        const o = options || {};
        const repo = o.repo || appRepo;
        const now = typeof o.now === 'function' ? o.now : () => util.now();
        const origin = typeof o.origin === 'string' ? o.origin : pageOrigin();

        async function collect(scope, studentId) {
          const all = {};
          for (const s of schema.STORE_NAMES) all[s] = (await repo.getAll(s)) || [];
          return scope === 'student' ? forStudent(all, studentId) : all;
        }

        /** { ok, name, text, mime, bundle, leftOut } or { ok: false, message } (no such student). */
        async function exportJson(args) {
          const a = args || {};
          const scope = a.scope === 'student' ? 'student' : 'all';
          const raw = await collect(scope, a.studentId);
          if (!raw) return { ok: false, message: 'This student no longer exists.' };
          const clean = withoutOrphans(raw);
          const t = now();
          const b = bundle(clean.data, { scope: scope, studentId: a.studentId, now: t, origin: origin });
          return { ok: true, name: fileName(scope === 'student' ? studentScope(a.studentId) : 'all', 'json', t),
            text: JSON.stringify(b), mime: 'application/json', bundle: b, leftOut: clean.leftOut };
        }

        /** kind: 'attempts' | 'mastery' | 'assessments' (all data). */
        async function exportCsv(kind) {
          if (!Object.prototype.hasOwnProperty.call(CSV_KINDS, kind)) throw new Error('[NBA] unknown CSV export: ' + kind);
          const data = withoutOrphans(await collect('all')).data;
          const t = now();
          const text = kind === 'attempts' ? attemptsCsv(data) : (kind === 'mastery' ? masterySummaryCsv(data, t) : assessmentsCsv(data));
          return { ok: true, name: fileName(CSV_KINDS[kind], 'csv', t), text: text, mime: 'text/csv;charset=utf-8' };
        }

        return { collect, exportJson, exportCsv, origin };
      }

      const app = create();
      return Object.assign({
        create, FORMAT, COLUMNS, STUDENT_STORES, CLASS_STORES, NOT_AVAILABLE,
        cell, csv, iso, fileName, studentScope, references, withoutOrphans, forStudent, bundle,
        attemptsCsv, masterySummaryCsv, assessmentsCsv, download
      }, app);
    });
}());
