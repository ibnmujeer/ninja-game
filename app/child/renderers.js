/*
 * renderers (L5): render(stage, q) and afterShow(stage, q) for every question type
 * (moved from v1 section 8; P3 adds the V2 representations of DESIGN 16.3), attached to
 * questionTypes with attachRenderer(). render() draws the picture into #stage and returns a
 * fit spec { wu, hu, wpx?, hpx?, prep? } for bricks.fitStage().
 */
(function () {
  'use strict';

  NBA.define('renderers', ['config', 'util', 'catalog', 'dom', 'audio', 'art', 'bricks', 'screens', 'questionTypes'],
    (config, util, catalog, dom, audio, art, bricks, screens, questionTypes) => {
      const { GROUP_COLOURS, SHARE_ROW, SHARE_FACE_GAP, SIZE, TIMING } = config;
      const { clamp, range, repeat } = util;
      const { HEROES } = catalog;
      const { $, $all, later, reducedMotion } = dom;
      const { AUDIO } = audio;
      const { faceHTML, villainHTML } = art;
      const { bandColour, brickHTML, stackHTML, stackW, stackH, colsFor, rowsFor } = bricks;

      /** Fit spec for brick stacks. Stacked bricks share their 3px outlines, so each row is 3px shorter. */
      function stackFit(wu, rows) { return { wu: wu, hu: stackH(rows), hpx: -3 * rows }; }

      /** The chosen hero first, then the next heroes in HEROES order (skipping the chosen one). */
      function teamIds(k) {
        const chosen = screens.currentHeroId();
        return [chosen].concat(HEROES.map((h) => h.id).filter((id) => id !== chosen)).slice(0, k);
      }

      const RENDERERS = {
        build: {
          render(stage, q) {
            // Empty columns sized for the full capacity, so bricks never resize while building.
            stage.innerHTML = '<div class="scene">' + stackHTML(0, { cols: colsFor(q.cap) }, 'build-stack') + '</div>';
            return stackFit(stackW(colsFor(q.cap)), rowsFor(q.cap));
          }
        },

        add: {
          render(stage, q) {
            const a = q.numbers.a, b = q.numbers.b;
            stage.innerHTML = '<div class="scene">' + stackHTML(a, { colourAt: () => 'red' }) +
              '<div class="plus" aria-hidden="true">+</div>' + stackHTML(b, { colourAt: () => 'blue' }) + '</div>';
            // The "+" is 1.5u wide with 0.6u of space on each side.
            return stackFit(stackW(colsFor(a)) + 2.7 + stackW(colsFor(b)), Math.max(rowsFor(a), rowsFor(b)));
          }
        },

        more: {
          render(stage, q) {
            const t = q.numbers.total;
            stage.innerHTML = '<div class="scene">' + stackHTML(t, { dashedFrom: q.numbers.have }) + '</div>';
            return stackFit(stackW(colsFor(t)), rowsFor(t));
          }
        },

        bigger: {
          render(stage, q) {
            const x = q.numbers;
            const tower = (h, v, c1, c2, label) =>
              '<button class="tower" type="button" data-action="tower" data-value="' + v + '" aria-label="' + label + '">' +
              stackHTML(h, { rows: h, colourAt: (i) => (Math.floor(i / 5) % 2 ? c2 : c1) }) + '</button>';
            stage.innerHTML = '<div class="scene towers">' + tower(x.left, 0, 'red', 'orange', 'Left tower') +
              tower(x.right, 1, 'blue', 'green', 'Right tower') + '</div>';
            // Two single towers of 3u-wide bricks (3.5u with the plate), plus each
            // button's 0.5rem padding and 3px borders, and the 1.25rem gap between them.
            const fit = stackFit(7, Math.max(x.left, x.right));
            fit.prep = (W, H, rem) => ({ wpx: 2 * (rem + 6) + 1.25 * rem, hpx: fit.hpx + rem + 6 });
            return fit;
          }
        },

        knock: {
          render(stage, q) {
            const a = q.numbers.a;
            stage.innerHTML = '<div class="scene knock-scene">' + stackHTML(a, {}, 'knock-tower') +
              '<div class="knock-side">' + villainHTML('knock-villain') + '<div class="fallen-pile"></div></div></div>';
            // Tower, 1.5u gap, then the pile column (3 bricks of 2.1u side by side).
            return stackFit(stackW(colsFor(a)) + 1.5 + 6.3, rowsFor(a));
          },
          /** Rumble lunges, the top B bricks fly off (inside the clipped stage) and land in the pile. */
          afterShow(stage, q) {
            const a = q.numbers.a, b = q.numbers.b;
            const top = $all('.knock-tower .brick', stage).filter((el) => Number(el.getAttribute('data-i')) >= a - b);
            const land = () => {
              top.forEach((el) => el.remove());
              const pile = $('.fallen-pile', stage);
              if (pile) pile.innerHTML = range(1, b).map((i) => brickHTML(bandColour(a - i), 'fallen')).join('');
            };
            if (reducedMotion()) { later(() => { AUDIO.play('knock'); land(); }, TIMING.KNOCK_START); return; }
            later(() => {
              const v = $('.knock-villain', stage);
              if (v) v.classList.add('lunge');
              AUDIO.play('knock');
              top.forEach((el, i) => { el.style.animationDelay = (i * 25) + 'ms'; el.classList.add('fly'); });
            }, TIMING.KNOCK_START);
            later(land, TIMING.KNOCK_PILE);
          }
        },

        groups: {
          render(stage, q) {
            const g = q.numbers.g, s = q.numbers.s;
            let html = '';
            for (let k = 0; k < g; k++) html += stackHTML(s, { colourAt: () => GROUP_COLOURS[k % GROUP_COLOURS.length] }, 'group');
            stage.innerHTML = '<div class="scene groups-scene">' + html + '</div>';
            // g stacks of one column (2.5u each) with 1.25u between groups.
            return stackFit(g * stackW(1) + (g - 1) * 1.25, s);
          }
        },

        share: {
          render(stage, q) {
            const n = q.numbers.n, k = q.numbers.k;
            const rows = Math.ceil(n / SHARE_ROW);
            let wall = '';
            for (let r = 0; r < rows; r++) {
              const inRow = Math.min(SHARE_ROW, n - r * SHARE_ROW);
              wall += '<div class="row">' + repeat(brickHTML(r % 2 ? 'orange' : 'gold'), inRow).join('') + '</div>';
            }
            const team = teamIds(k).map((id) => faceHTML(id, 'share-face')).join('');
            stage.innerHTML = '<div class="scene share-scene"><div class="stack treasure"><div class="wall">' + wall +
              '</div><div class="plate"></div></div><div class="team">' + team + '</div></div>';
            const fit = stackFit(SHARE_ROW * 2 + (SHARE_ROW - 1) * 0.15 + 0.5, rows);
            // Faces get the width they need first; the bricks fit into what is left.
            fit.prep = (W, H, rem) => {
              const f = clamp(Math.floor((W - (k - 1) * SIZE.FACE_GAP) / k), SIZE.FACE_MIN, SIZE.FACE_MAX_REM * rem);
              stage.style.setProperty('--face', f + 'px');
              return { hpx: fit.hpx + f + SHARE_FACE_GAP };
            };
            return fit;
          }
        }
      };

      /* ---------- V2 representations (DESIGN 16.3) ---------- */

      /** Colour of brick i on a build stage: add-build shows A red bricks, then the added ones blue. */
      function brickColour(q, i) {
        if (q && q.typeId === 'add-build') return i < q.start ? 'red' : 'blue';
        return bandColour(i);
      }

      /** The v1 build stage with colsFor(cap) columns of 10, pre-filled with q.start bricks. */
      function buildStage(stage, q) {
        const cols = colsFor(q.cap);
        stage.innerHTML = '<div class="scene">' +
          stackHTML(q.start || 0, { cols: cols, colourAt: (i) => brickColour(q, i) }, 'build-stack') + '</div>';
        return stackFit(stackW(cols), rowsFor(q.cap));
      }

      const NL_PITCH = 2.2; // tile 2u plus a 0.2u gap
      /** Small arrow showing that the line continues past a cut end (or an empty slot of the same width). */
      function lineEnd(show, dir) {
        if (!show) return '<span class="nl-end" aria-hidden="true"></span>';
        const d = dir < 0 ? 'M9 2 3 6l6 4' : 'M3 2l6 4-6 4';
        return '<span class="nl-end" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="' + d +
          '" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
      }

      /**
       * One row of 11 numbered tiles: 0 to 10 at tier 10; the window [s, s + 10] of 0 to 20 at tier 20,
       * s = clamp(min(start, landing) - 1, 0, 10). Arcs show each hop of 1 (staggered in CSS, so reduced
       * motion and the test speed-up both apply); the hero face marks the start; the landing shows "?".
       */
      function numberLine(stage, q, dir) {
        const a = q.numbers.a, land = q.answer;
        const s = q.max > 10 ? clamp(Math.min(a, land) - 1, 0, 10) : 0;
        const tiles = range(s, s + 10).map((n) => '<span class="nl-tile' + (n === a ? ' nl-start' : '') + (n === land ? ' nl-land' : '') +
          '" data-n="' + n + '">' + (n === land ? '?' : n) + '</span>').join('');
        let arcs = '';
        for (let k = 0; k < Math.abs(land - a); k++) {
          const x1 = (a + dir * k - s) * NL_PITCH + 1, x2 = x1 + dir * NL_PITCH;
          arcs += '<path d="M' + x1.toFixed(2) + ' 1.9Q' + ((x1 + x2) / 2).toFixed(2) + ' -.5 ' + x2.toFixed(2) + ' 1.9" style="animation-delay:' +
            (150 + k * 120) + 'ms"/>';
        }
        const faceLeft = ((a - s) * NL_PITCH).toFixed(2);
        stage.innerHTML = '<div class="scene scene-mid"><div class="nl' + (dir < 0 ? ' nl-back' : '') + '">' + lineEnd(s > 0, -1) +
          '<div class="nl-main"><svg class="nl-arcs" viewBox="0 0 24 2" focusable="false" aria-hidden="true">' + arcs + '</svg>' +
          '<div class="nl-row">' + tiles + '</div>' +
          '<div class="nl-marks">' + faceHTML(screens.currentHeroId(), 'nl-face', ' style="left:calc(var(--u) * ' + faceLeft + ')"') + '</div></div>' +
          lineEnd(q.max > 10 && s + 10 < 20, 1) + '</div></div>';
        // 1u arrow slot + 0.2u gap on each side of the 24u row; arcs 2u, tiles 2u, face 2u, two 0.2u gaps.
        return { wu: 26.4, hu: 6.4 };
      }

      /** Numerals and signs only, on a plain brick-outlined card (font never below 28 px, in CSS). */
      function symCard(stage, q) {
        const text = q.display[0];
        stage.innerHTML = '<div class="scene scene-mid"><div class="sym-card">' + util.esc(text) + '</div></div>';
        return { wu: text.length * 1.85 + 2.4, hu: 5.2 };
      }

      /** The story's scene: the hero, one object brick, and the friend (or Rumble when he takes some). */
      function wordScene(stage, q) {
        const s = q.scene || {};
        const other = s.villain ? villainHTML('ws-face') : faceHTML(s.friendId || 'jade', 'ws-face');
        stage.innerHTML = '<div class="scene scene-mid word-scene">' + faceHTML(s.heroId || screens.currentHeroId(), 'ws-face') +
          '<div class="ws-object">' + brickHTML(s.object || 'red') + '</div>' + other + '</div>';
        // Two 4u faces, a 2u brick, and 1u gaps.
        return { wu: 12, hu: 4.4 };
      }

      Object.assign(RENDERERS, {
        'add-build': { render: buildStage },
        'sub-build': { render: buildStage },
        'add-line': { render: (stage, q) => numberLine(stage, q, 1) },
        'sub-line': { render: (stage, q) => numberLine(stage, q, -1) },
        'add-sym': { render: symCard },
        'sub-sym': { render: symCard },
        'add-word': { render: wordScene },
        'sub-word': { render: wordScene }
      });

      Object.keys(RENDERERS).forEach((id) => questionTypes.attachRenderer(id, RENDERERS[id]));
      const missing = questionTypes.ids().filter((id) => !RENDERERS[id]);
      if (missing.length) throw new Error('[NBA] no renderer for ' + missing.join(', '));

      return { teamIds, stackFit, brickColour };
    });
}());
