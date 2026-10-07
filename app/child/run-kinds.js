/*
 * runKinds (L5): what differs between world, assignment and Ninja Check runs on the one mission
 * screen (DESIGN 16.6), so missionUI keeps a single copy of the markup and actions.
 *   newAssignmentRun(a, start), newCheckRun(checkRun)  the run objects (every v1 field plus kind fields)
 *   header(run)       { title (HTML-escaped), label }: world name / "Special mission: <name>" / "Ninja Check"
 *   progressHTML(run) the v1 8-brick bar (world runs) or the "4 of 10" counter in the same box
 *   counterText(run)  its text; isLast(run) the last-question rule; sessionArgs(run, sid); attemptWhere(run)
 */
(function () {
  'use strict';

  NBA.define('runKinds', ['config', 'util', 'catalog', 'learning', 'assessmentEngine', 'art'], (config, util, catalog, learning, assessmentEngine, art) => {
    const { MISSIONS_PER_WORLD } = config;
    const { esc, repeat } = util;
    const base = () => ({ firstTry: true, wrongCount: 0, locked: false, buildCount: 0, sessionId: null, slot: null, activities: [], q: null,
      stars: 0, prevBest: 0, used: new Set(), sittingCount: 0, worldId: null, assignmentId: null, checkRunId: null });

    /** P6 (17.6): missionIndex starts at this student's attempts so far (rotation and missionId continue). */
    function newAssignmentRun(a, start) {
      return Object.assign(base(), { kind: 'assignment', assignmentId: a.id, assignment: a,
        total: typeof a.questionCount === 'number' ? a.questionCount : null, plan: [], missionIndex: start, results: [] });
    }
    function newCheckRun(checkRun) {
      const items = checkRun.items;
      return Object.assign(base(), { kind: 'check', checkRunId: checkRun.id, checkRun: checkRun, cellId: null, total: items.length,
        plan: items.map((it) => it.activityId), missionIndex: 0, results: repeat(null, items.length) });
    }

    function header(run) {
      const i = run.missionIndex + 1;
      if (run.kind === 'check') return { title: 'Ninja Check', label: 'Question ' + i + ' of ' + run.total };
      if (run.kind === 'assignment') return { title: 'Special mission: ' + esc(run.assignment.name), label: run.total ? 'Question ' + i + ' of ' + run.total : 'Question ' + i };
      return { title: esc(catalog.worldById(run.worldId).name), label: 'Mission ' + i + ' of ' + MISSIONS_PER_WORLD };
    }

    /** "4 of 12" answered (check); "4 of 10" or "4" (assignment, this student's questions so far). */
    function counterText(run) {
      if (run.kind === 'check') return Object.keys(run.checkRun.answers).length + ' of ' + run.total;
      const n = learning.assignmentProgress(run.assignmentId).count;
      return run.total ? Math.min(n, run.total) + ' of ' + run.total : String(n);
    }
    /** World runs: the v1 8-brick progress bar (one brick per solved mission, a star for a first try); others: the counter. */
    function progressHTML(run) {
      if (run.kind !== 'world') return '<p id="progress" class="run-count">' + counterText(run) + '</p>';
      const w = catalog.worldById(run.worldId);
      let html = '<div id="progress" class="progress" aria-hidden="true">';
      for (let i = 0; i < MISSIONS_PER_WORLD; i++) {
        const r = run.results[i];
        html += '<span class="pbrick' + (r ? ' filled c-' + w.colour : '') + (r === 'star' ? ' star' : '') +
          (!r && i === run.missionIndex ? ' current' : '') + '">' + (r === 'star' ? art.ICONS.star : '') + '</span>';
      }
      return html + '</div>';
    }

    /**
     * The last question: mission 8; a check with no unanswered cell after this one; an assignment at its
     * count, or in minutes mode at the 30-question sitting cap, or at the target time (every sitting,
     * this answer included) once 3 questions of this sitting are done.
     */
    function isLast(run) {
      if (run.kind === 'check') return assessmentEngine.nextCell(run.checkRun, run.cellId) === null;
      if (run.kind === 'assignment') {
        const A = config.teacher.assignment, a = run.assignment;
        if (run.total) return run.missionIndex + 1 >= run.total;
        return run.sittingCount >= A.sittingCap || (run.sittingCount >= A.sittingFloor && learning.assignmentProgress(a.id).totalMs >= a.targetMinutes * 60000);
      }
      return run.missionIndex >= MISSIONS_PER_WORLD - 1;
    }

    function sessionArgs(run, studentId) {
      if (run.kind === 'check') return { studentId: studentId, kind: 'assessment', assessmentId: run.checkRunId };
      if (run.kind === 'assignment') return { studentId: studentId, kind: 'assignment', assignmentId: run.assignmentId };
      return { studentId: studentId, kind: 'play', worldId: run.worldId };
    }
    /** Context, ids and missionId of a world or assignment attempt (DESIGN 9.2 missionId patterns). */
    function attemptWhere(run) {
      return run.kind === 'assignment'
        ? { context: 'assignment', assignmentId: run.assignmentId, worldId: null, missionId: run.assignmentId + '.q' + run.missionIndex }
        : { context: 'play', worldId: run.worldId, missionId: run.worldId + '.m' + (run.missionIndex + 1) };
    }

    return { newAssignmentRun, newCheckRun, header, counterText, progressHTML, isLast, sessionArgs, attemptWhere };
  });
}());
