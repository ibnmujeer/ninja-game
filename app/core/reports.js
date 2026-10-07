/*
 * reports (L2): the teacher reports (DESIGN 17.3 to 17.5), pure. No DOM, no clock: `now` is passed in.
 * All teacher wording lives here as fixed text: levels (text plus a shape, never colour alone), trend,
 * hint use, "possible/observed pattern" sentences (13.2), reasonCode sentences, the check comparison
 * note (15.5). The same input always gives the same output (the Pulse unit test checks this).
 *
 *   classDashboard(input)  17.3   studentProfile(input)  17.4   weeklyPulse(input)  17.5
 *   levelMoves(attempts)   P4-N3: level changes from adaptive decisions only (v1_default and
 *                          adaptive_off decisions are never counted as moves)
 *   wording helpers: levelInfo, trendText, hintText, patternSentence, reasonSentence, actionText,
 *   conceptName, activityName, representationName, kindText, COMPARISON_NOTE, CHECK_STATUS
 */
(function () {
  'use strict';

  NBA.define('reports', ['config', 'util', 'catalog', 'masteryEngine', 'assessmentEngine', 'targets'],
    (config, util, catalog, masteryEngine, assessmentEngine, targets) => {
      const DAY = 24 * 60 * 60 * 1000;

      /* ---------- fixed teacher wording ---------- */
      const LEVELS = {
        strong: { text: 'Strong', shape: '\u25CF', shapeName: 'filled circle' },
        developing: { text: 'Developing', shape: '\u25D0', shapeName: 'half circle' },
        needs_support: { text: 'Needs support', shape: '\u25CB', shapeName: 'ring' },
        insufficient_data: { text: 'Not enough data yet', shape: '\u2013', shapeName: 'dash' }
      };
      const TREND = { improving: 'Improving', steady: 'Steady', declining: 'Going down', unknown: 'Not enough yet' };
      const HINT = { low: 'Low', some: 'Some', high: 'High' };
      const CONFIDENCE = { none: 'none', low: 'low', medium: 'medium', high: 'high' };
      const KIND = { play: 'World', assignment: 'Assignment', assessment: 'Ninja Check' };
      const CHECK_STATUS = { none: 'Not asked', pending: 'Waiting', in_progress: 'Started', complete: 'Complete', cancelled: 'Cancelled' };
      const COMPARISON_NOTE = 'This shows how scores changed between the two checks. It does not show what caused the change.';
      const ACTIVITY_NAMES = {
        build: 'Build a tower', add: 'Add brick pictures', more: 'How many more (pictures)', bigger: 'Bigger tower',
        knock: 'Knock bricks down (pictures)', groups: 'Equal groups', share: 'Fair sharing',
        'add-build': 'Add by building', 'sub-build': 'Take away by building', 'add-line': 'Add on a number line',
        'sub-line': 'Take away on a number line', 'add-sym': 'Addition, numbers only', 'sub-sym': 'Subtraction, numbers only',
        'add-word': 'Addition word problem', 'sub-word': 'Subtraction word problem'
      };
      /** 13.2: what each pattern label describes (never a cause). */
      const PATTERN_TEXT = {
        counting: 'built answers often 1 brick away from the right number',
        calculation: 'built answers often 2 or 3 bricks away from the right number',
        'place-value': 'built answers often 10 bricks away from the right number',
        guessing: 'quick wrong taps, or trying every button in turn',
        'hint-dependence': 'often right straight after a hint (hints appear after a wrong answer)',
        'word-problem-comprehension': 'word problems right first time less often than other kinds of question',
        'representation-transition': 'numbers-only questions go well while bricks, pictures or the number line go less well'
      };
      const OPERATION_TEXT = {
        built_wrong_way: 'built the tower the other way (adding instead of taking away, or the reverse)',
        result_above_start: 'often picked an answer bigger than the starting number',
        result_below_part: 'often picked an answer smaller than one of the parts'
      };
      /** Automatic decisions: why (reasonCode) and what happens next (action). */
      const REASON = {
        no_data: 'Not enough answers yet.',
        adaptive_off: 'Automatic choices are switched off.',
        concept_default: 'This is the starting point for this concept.',
        recent_low_accuracy: 'Recent answers were often not right first time.',
        consecutive_incorrect: 'The last answers were not right first time.',
        cooldown_active: 'The level changed only recently, so it stays for now.',
        at_easiest_level: 'This is already the easiest level.',
        repeated_pattern: 'An observed pattern came up in recent answers.',
        symbolic_strong_transfer_weak: 'Numbers-only questions go well; other ways of showing it are not yet as secure.',
        solved_after_hint_pattern: 'Answers are often right only after a hint.',
        consistent_success: 'Recent answers were right first time.',
        consistent_success_max_difficulty: 'Recent answers were right first time at the hardest level.',
        success_building_evidence: 'Recent answers went well; a few more at this level come first.',
        concept_strong: 'This concept looks strong.',
        developing_continue: 'Answers are on their way.'
      };
      const ACTION = {
        v1_default: 'The game uses its usual questions.',
        change_representation: 'The next questions show it in a different way.',
        more_concrete: 'The next questions use bricks or pictures more.',
        reduce_difficulty: 'The next questions use an easier level.',
        maintain: 'The next questions stay at this level.',
        introduce_transfer: 'The next questions try another way of showing it.',
        increase_difficulty: 'The next questions use a harder level.',
        less_concrete: 'The next questions use fewer pictures.',
        concept_default: 'The next questions start at the usual level.'
      };
      /** masteryEngine recommendedAction (12.4) as plain text. */
      const NEXT_ACTION = {
        gather_more_practice: 'More practice is needed before a level is shown.',
        step_down: 'Practise at an easier level or with bricks.',
        continue: 'Keep practising.',
        introduce_transfer: 'Try other ways of showing it.',
        step_up: 'Ready for a harder level.',
        next_concept: 'Ready for the next concept.'
      };

      const levelInfo = (level) => Object.assign({ level: level }, LEVELS[level] || LEVELS.insufficient_data);
      const trendText = (t) => TREND[t] || TREND.unknown;
      const hintText = (band) => (band && HINT[band]) || 'Not enough yet';
      const conceptName = (id) => { const c = catalog.conceptById(id); return c ? c.name : String(id); };
      const activityName = (id) => ACTIVITY_NAMES[id] || String(id);
      const representationName = (id) => { const r = catalog.representationById(id); return r ? r.name : String(id); };
      const kindText = (k) => KIND[k] || String(k);
      const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null);
      const pctText = (x) => (pct(x) === null ? 'n/a' : pct(x) + '%');
      const answersText = (n) => 'based on ' + n + (n === 1 ? ' answer' : ' answers');

      /** "Possible pattern: ..." or "Observed pattern: ..." with the counts it rests on (13.2). */
      function patternSentence(p) {
        const head = p.status === 'observed' ? 'Observed pattern: ' : 'Possible pattern: ';
        let body = PATTERN_TEXT[p.label] || p.label;
        let counts = '(' + p.count + ' of the last ' + p.of + ')';
        if (p.label === 'operation-misunderstanding') {
          const key = Object.keys(OPERATION_TEXT).find((k) => String(p.reasonCode).indexOf('obs_' + k) === 0) || 'built_wrong_way';
          body = OPERATION_TEXT[key];
          if (key !== 'built_wrong_way') counts = '(' + p.count + ' of ' + p.of + ' questions where that was offered)';
        } else if (p.label === 'hint-dependence') {
          counts = '(' + p.count + ' of ' + p.of + ' questions with a wrong first try)';
        } else if (p.label === 'word-problem-comprehension' || p.label === 'representation-transition') {
          counts = '(' + answersText(p.of) + ')';
        }
        return head + body + ' ' + counts;
      }

      /** The plain sentence for an automatic decision (reasonCode, then action). */
      function reasonSentence(decision) {
        if (!decision) return 'No suggestion yet.';
        const code = String(decision.reasonCode || '').replace(/\+variety$/, '');
        const reason = code.indexOf('repeated_pattern') === 0 ? REASON.repeated_pattern : (REASON[code] || '');
        const action = ACTION[decision.action] || ACTION[decision.adaptiveAction] || '';
        return (reason + ' ' + action).trim() || 'No suggestion yet.';
      }
      const actionText = (a) => NEXT_ACTION[a] || '';

      /** What an override or suggestion sets: "Level 2, Number line, Add on a number line" (Auto omitted). */
      function targetText(t) {
        const parts = [];
        const d = t.toDifficulty !== undefined ? t.toDifficulty : t.difficulty;
        if (typeof d === 'number') parts.push('level ' + d);
        if (t.representation && t.representation !== 'auto') parts.push(representationName(t.representation));
        if (t.activityId && t.activityId !== 'auto') parts.push(activityName(t.activityId));
        return parts.length ? parts.join(', ') : 'everything else automatic';
      }

      /** P4-N3: level moves counted from adaptive decisions only; v1_default and adaptive_off never count. */
      function levelMoves(attempts) {
        const out = { up: 0, down: 0 };
        (attempts || []).forEach((a) => {
          const d = a && a.decision;
          if (!a || a.decisionSource !== 'adaptive' || !d || d.action === 'v1_default' || d.reasonCode === 'adaptive_off') return;
          if (typeof d.fromDifficulty !== 'number' || typeof d.toDifficulty !== 'number') return;
          if (d.toDifficulty > d.fromDifficulty) out.up++;
          else if (d.toDifficulty < d.fromDifficulty) out.down++;
        });
        return out;
      }

      /* ---------- shared calculations ---------- */
      const ADAPTIVE = catalog.CONCEPTS.filter((c) => c.adaptive).map((c) => c.id);
      const ORDER = catalog.CONCEPTS.map((c) => c.id);
      const PRIORITY = ['needs_support', 'developing', 'insufficient_data'];
      const cmp = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
      const byName = (a, b) => cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase()) ||
        cmp(String(a.localId || ''), String(b.localId || '')) || cmp(a.id, b.id);
      const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
      const snapOf = (mastery, sid, c) => (own(mastery, sid) && own(mastery[sid], c) ? mastery[sid][c] : null);
      function evaluate(snap, c, now) {
        return masteryEngine.evaluate(snap || masteryEngine.empty(null, c), config.mastery, now, config.error);
      }
      function lastActiveOf(snaps) {
        let t = null;
        Object.keys(snaps || {}).forEach((c) => { const x = snaps[c] && snaps[c].lastAttemptAt; if (typeof x === 'number' && (t === null || x > t)) t = x; });
        return t;
      }
      /** Session minutes: endedAt, else the session's last attempt, else its start (16.5). */
      function sessionMinutes(sessions, attempts) {
        const last = {};
        (attempts || []).forEach((a) => { if (a.sessionId && (!last[a.sessionId] || a.timestamp > last[a.sessionId])) last[a.sessionId] = a.timestamp; });
        const ms = (sessions || []).reduce((sum, s) => {
          const end = typeof s.endedAt === 'number' ? s.endedAt : (last[s.id] || s.startedAt);
          return sum + Math.max(0, end - s.startedAt);
        }, 0);
        return Math.round(ms / 60000);
      }
      /** { assignmentId: { studentId: { count, totalMs } } } from assignment attempts (17.6). */
      function assignmentProgress(attempts) {
        const out = {};
        (attempts || []).forEach((a) => {
          if (!a || !a.assignmentId) return;
          const byStu = out[a.assignmentId] || (out[a.assignmentId] = {});
          const p = byStu[a.studentId] || (byStu[a.studentId] = { count: 0, totalMs: 0 });
          p.count++;
          p.totalMs += typeof a.totalMs === 'number' ? a.totalMs : 0;
        });
        return out;
      }
      /** The active students an assignment targets (listed students, or the whole class). */
      function targetedIds(asg, students) {
        const ids = asg.studentIds || [];
        return students.filter((s) => s.status === 'active' && (ids.length ? ids.indexOf(s.id) >= 0 : (!!asg.classId && s.classId === asg.classId)))
          .map((s) => s.id);
      }
      function checkState(runs, form) {
        const mine = (runs || []).filter((r) => r.form === form && r.status !== 'cancelled')
          .sort((a, b) => (b.createdAt - a.createdAt) || cmp(b.id, a.id));
        const done = mine.filter((r) => r.status === 'complete').sort((a, b) => b.completedAt - a.completedAt)[0];
        const open = mine.find((r) => r.status === 'pending' || r.status === 'in_progress');
        const r = open || done || null;
        const score = done ? assessmentEngine.scoreRun(done) : null;
        return { status: r ? r.status : 'none', statusText: CHECK_STATUS[r ? r.status : 'none'], runId: r ? r.id : null,
          completeRunId: done ? done.id : null, score: score ? { correct: score.correct, total: score.total, percent: score.percent } : null };
      }

      /** 17.3: the class dashboard. input = { students, mastery: { sid: { c: snap } }, attempts, sessions, assessments, assignments, assignmentAttempts, now } */
      function classDashboard(input) {
        const x = input || {};
        const now = x.now, cfg = x.cfg || config.reports;
        const students = (x.students || []).filter((s) => s.status === 'active').slice().sort(byName);
        const ids = students.map((s) => s.id);
        const winStart = now - cfg.windowDays * DAY;
        const inWin = (t) => typeof t === 'number' && t > winStart && t <= now;
        const atts = (x.attempts || []).filter((a) => ids.indexOf(a.studentId) >= 0 && inWin(a.timestamp));
        const sess = (x.sessions || []).filter((s) => ids.indexOf(s.studentId) >= 0 && inWin(s.startedAt));
        const evals = {};
        students.forEach((s) => { evals[s.id] = {}; ADAPTIVE.forEach((c) => { evals[s.id][c] = evaluate(snapOf(x.mastery, s.id, c), c, now); }); });
        const activity = students.map((s) => {
          const mine = atts.filter((a) => a.studentId === s.id);
          const last = lastActiveOf(own(x.mastery, s.id) ? x.mastery[s.id] : null);
          return { studentId: s.id, name: s.name, localId: s.localId || '', lastActiveAt: last, lastActive: last === null ? 'Never' : util.localDate(last),
            questions: mine.length, minutes: sessionMinutes(sess.filter((z) => z.studentId === s.id), mine), levelMoves: levelMoves(mine) };
        });
        const share = (level, min) => ADAPTIVE.map((c) => {
          const withData = students.filter((s) => evals[s.id][c].level !== 'insufficient_data');
          const n = withData.filter((s) => evals[s.id][c].level === level).length;
          return { conceptId: c, name: conceptName(c), count: n, withData: withData.length };
        }).filter((r) => r.withData > 0 && r.count >= min * r.withData - 1e-9 && r.count > 0);
        const strengths = share('strong', cfg.strengthShare).map((r) => Object.assign(r, { text: 'Strong for ' + r.count + ' of ' + r.withData + ' students' }));
        const attention = share('needs_support', cfg.attentionShare).map((r) => Object.assign(r, { text: 'Needs support for ' + r.count + ' of ' + r.withData + ' students' }));
        const minA = config.mastery.minAttemptsForLevel;
        const insufficient = [];
        students.forEach((s, i) => {
          const few = ADAPTIVE.every((c) => { const sn = snapOf(x.mastery, s.id, c); return !sn || sn.total < minA; });
          const last = activity[i].lastActiveAt;
          const idle = last === null || last <= now - cfg.inactiveDays * DAY;
          if (few || idle) insufficient.push({ studentId: s.id, name: s.name, localId: s.localId || '', fewAnswers: few, inactive: idle,
            text: few && idle ? 'Fewer than ' + minA + ' answers in every concept, and no practice in ' + cfg.inactiveDays + ' days'
              : (few ? 'Fewer than ' + minA + ' answers in every concept' : 'No practice in ' + cfg.inactiveDays + ' days') });
        });
        const runs = x.assessments || [];
        const count = (form) => students.filter((s) => runs.some((r) => r.studentId === s.id && r.form === form && r.status === 'complete')).length;
        const checks = { baseline: { complete: count('baseline'), total: students.length }, post: { complete: count('post'), total: students.length } };
        const prog = assignmentProgress(x.assignmentAttempts);
        const today = util.localDate(now);
        const assignments = (x.assignments || []).filter((a) => a.status === 'open').map((a) => {
          const target = targetedIds(a, students);
          const complete = target.filter((sid) => targets.assignmentComplete(a, prog[a.id] && prog[a.id][sid])).length;
          return { assignmentId: a.id, name: a.name, complete: complete, targeted: target.length, dueDate: a.dueDate || null,
            overdue: !!a.dueDate && a.dueDate < today };
        }).filter((r) => r.targeted > 0).sort((a, b) => cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase()) || cmp(a.assignmentId, b.assignmentId));
        return { activeCount: students.length, windowDays: cfg.windowDays, activity, strengths, attention, insufficient, checks, assignments };
      }

      /** 17.4: one student's profile. input = { student, mastery: { c: snap }, recommendations: { c: rec }, overrides, sessions, attempts, assessments, assignments, now } */
      function studentProfile(input) {
        const x = input || {};
        const now = x.now, cfg = x.cfg || config.reports;
        const snaps = x.mastery || {};
        const atts = x.attempts || [];
        const asgName = {};
        (x.assignments || []).forEach((a) => { asgName[a.id] = a.name; });
        const sessions = (x.sessions || []).slice().sort((a, b) => (b.startedAt - a.startedAt) || cmp(b.id, a.id)).slice(0, cfg.recentSessions)
          .map((s) => {
            const mine = atts.filter((a) => a.sessionId === s.id);
            const w = s.worldId ? catalog.worldById(s.worldId) : null;
            const label = s.kind === 'play' ? (w ? w.name : 'World') : (s.kind === 'assignment' ? (asgName[s.assignmentId] || 'Assignment') : 'Ninja Check');
            return { sessionId: s.id, startedAt: s.startedAt, date: util.localDate(s.startedAt), kind: s.kind, kindText: kindText(s.kind), label: label,
              questions: mine.length || s.attemptCount || 0, firstTry: mine.filter((a) => a.firstAttemptCorrect).length };
          });
        const concepts = ORDER.filter((c) => snaps[c] && snaps[c].total > 0).map((c) => {
          const e = evaluate(snaps[c], c, now), m = e.metrics;
          return {
            conceptId: c, name: conceptName(c), level: levelInfo(e.level), confidence: e.confidence, confidenceText: answersText(m.totalAttempts),
            attempts: m.totalAttempts, accuracy: pctText(m.accuracy), firstAttemptAccuracy: pctText(m.firstAttemptAccuracy),
            trend: trendText(m.recentTrend), hintUse: hintText(m.hintBand),
            representations: Object.keys(m.representationCoverage).map((r) => ({ id: r, name: representationName(r),
              answers: m.representationCoverage[r].n, firstTry: pctText(m.representationCoverage[r].firstAttemptAccuracy) })),
            patterns: e.patterns.map(patternSentence), nextStep: actionText(e.recommendedAction.action)
          };
        });
        const recs = x.recommendations || {};
        const suggestions = targets.SELECTABLE.filter((c) => recs[c] && recs[c].decision).map((c) => ({
          conceptId: c, name: conceptName(c), sentence: reasonSentence(recs[c].decision), target: targetText(recs[c].decision)
        }));
        const overrides = (x.overrides || []).filter((o) => o.status === 'active').sort((a, b) => b.createdAt - a.createdAt || cmp(a.id, b.id))
          .map((o) => ({ overrideId: o.id, conceptId: o.conceptId, name: conceptName(o.conceptId), target: targetText(o), date: util.localDate(o.createdAt) }));
        const runs = x.assessments || [];
        const picked = assessmentEngine.pickRuns(runs);
        const comparison = assessmentEngine.compare(picked.baseline, picked.post);
        return {
          studentId: x.student ? x.student.id : null, sessions, concepts, suggestions, overrides,
          checks: { baseline: checkState(runs, 'baseline'), post: checkState(runs, 'post'), comparison: comparison, note: COMPARISON_NOTE },
          levelMoves: levelMoves(atts)
        };
      }

      const PULSE_NOTE = 'Levels are as of today and use every answer so far. "What they practised" covers only the selected 7 days.';
      const NO_PRACTICE = 'No practice recorded in these 7 days.';

      /** 17.5: the Weekly Learning Pulse. input = { students, attempts, sessions, mastery, recommendations, overrides, now, weeksBack } */
      function weeklyPulse(input) {
        const x = input || {};
        const now = x.now, cfg = x.cfg || config.reports;
        const back = Math.max(0, Math.floor(Number(x.weeksBack) || 0));
        const end = now - back * cfg.windowDays * DAY, start = end - cfg.windowDays * DAY;
        const inWin = (t) => typeof t === 'number' && t > start && t <= end;
        const students = (x.students || []).filter((s) => s.status === 'active').slice().sort(byName);
        const rows = students.map((s) => {
          const atts = (x.attempts || []).filter((a) => a.studentId === s.id && inWin(a.timestamp));
          const sess = (x.sessions || []).filter((z) => z.studentId === s.id && inWin(z.startedAt));
          const tally = (key) => {
            const m = {};
            atts.forEach((a) => { m[a[key]] = (m[a[key]] || 0) + 1; });
            return Object.keys(m).map((k) => ({ id: k, answers: m[k] })).sort((a, b) => (b.answers - a.answers) || cmp(a.id, b.id));
          };
          const snaps = own(x.mastery, s.id) ? x.mastery[s.id] : {};
          const evals = ORDER.filter((c) => snaps[c] && snaps[c].total > 0).map((c) => ({ c: c, e: evaluate(snaps[c], c, now) }));
          const recs = own(x.recommendations, s.id) ? x.recommendations[s.id] : {};
          const ovs = (Array.isArray(x.overrides) ? x.overrides : []).filter((o) => o.studentId === s.id && o.status === 'active')
            .sort((a, b) => b.createdAt - a.createdAt || cmp(a.id, b.id));
          let next = null;
          if (ovs.length) {
            next = { kind: 'override', label: 'Your override', conceptId: ovs[0].conceptId, name: conceptName(ovs[0].conceptId),
              sentence: 'Practise ' + conceptName(ovs[0].conceptId) + ' (' + targetText(ovs[0]) + ').' };
          } else {
            const level = (c) => evaluate(snaps[c] || null, c, now).level;
            const cands = targets.SELECTABLE.filter((c) => recs[c] && recs[c].decision && PRIORITY.indexOf(level(c)) >= 0)
              .sort((a, b) => (PRIORITY.indexOf(level(a)) - PRIORITY.indexOf(level(b))) || (ORDER.indexOf(a) - ORDER.indexOf(b)));
            if (cands.length) {
              const c = cands[0];
              next = { kind: 'suggestion', label: 'Automatic suggestion', conceptId: c, name: conceptName(c), sentence: reasonSentence(recs[c].decision) };
            }
          }
          return {
            studentId: s.id, name: s.name, localId: s.localId || '', noActivity: atts.length === 0, noActivityText: atts.length ? '' : NO_PRACTICE,
            practised: tally('conceptId').map((r) => ({ conceptId: r.id, name: conceptName(r.id), answers: r.answers })),
            representations: tally('representation').map((r) => ({ id: r.id, name: representationName(r.id), answers: r.answers })),
            minutes: sessionMinutes(sess, atts), levelMoves: levelMoves(atts),
            strengths: evals.filter((v) => v.e.level === 'strong' && (v.e.confidence === 'medium' || v.e.confidence === 'high')).map((v) => conceptName(v.c)),
            developing: evals.filter((v) => v.e.level === 'developing').map((v) => conceptName(v.c)),
            patterns: [].concat.apply([], evals.map((v) => v.e.patterns.map((p) => conceptName(v.c) + '. ' + patternSentence(p)))),
            next: next
          };
        });
        return { windowStart: start, windowEnd: end, from: util.localDate(start + 1), to: util.localDate(end), weeksBack: back, note: PULSE_NOTE, students: rows };
      }

      return {
        classDashboard, studentProfile, weeklyPulse, levelMoves, assignmentProgress, targetedIds, sessionMinutes,
        levelInfo, trendText, hintText, patternSentence, reasonSentence, actionText, targetText,
        conceptName, activityName, representationName, kindText,
        LEVELS, COMPARISON_NOTE, CHECK_STATUS, PULSE_NOTE, NO_PRACTICE, ACTIVITY_NAMES
      };
    });
}());
