/*
 * bricks (L5): brick rendering, the global UI scale and stage fitting (moved from v1 section 6).
 * Bricks are plain divs: the body is the box (3px black outline) and the two
 * studs are ::before/::after. Sizes are multiples of --u (see fitStage):
 * brick 2u wide (3u in "bigger"), 1.2u tall; studs 0.35u; plate 0.5u.
 */
(function () {
  'use strict';

  NBA.define('bricks', ['config', 'util'], (config, util) => {
    const { BAND_CYCLE, COL_ROWS, SIZE } = config;
    const { clamp } = util;

    /** Colour of brick i in a banded tower: it changes every 5 bricks. */
    function bandColour(i) { return BAND_CYCLE[Math.floor(i / 5) % BAND_CYCLE.length]; }

    function brickHTML(colour, extraClass, attrs) {
      return '<div class="brick c-' + colour + (extraClass ? ' ' + extraClass : '') + '"' + (attrs || '') + '></div>';
    }

    /**
     * `count` bricks in columns (bottom-up, then the next column to the right).
     * opt.rows: bricks per column (default COL_ROWS); opt.cols: force a column
     * count (empty build columns); opt.colourAt(i): colour of brick i;
     * opt.dashedFrom: bricks from this index on are dashed "missing" bricks.
     */
    function columnsHTML(count, opt) {
      const o = opt || {};
      const rows = o.rows || COL_ROWS;
      const cols = o.cols || Math.max(1, Math.ceil(count / rows));
      let html = '';
      for (let c = 0; c < cols; c++) {
        html += '<div class="col">';
        for (let r = 0; r < rows; r++) {
          const i = c * rows + r;
          if (i >= count) break;
          const attr = ' data-i="' + i + '"';
          if (o.dashedFrom != null && i >= o.dashedFrom) html += '<div class="brick dashed"' + attr + '></div>';
          else html += brickHTML(o.colourAt ? o.colourAt(i) : bandColour(i), '', attr);
        }
        html += '</div>';
      }
      return html;
    }

    /** Columns of bricks standing on a green baseplate. */
    function stackHTML(count, opt, cls) {
      return '<div class="stack' + (cls ? ' ' + cls : '') + '"><div class="cols">' + columnsHTML(count, opt) +
        '</div><div class="plate"></div></div>';
    }

    /** Stack size in u. Width: 2u columns, 0.5u gaps, 0.25u plate overhang each side. */
    function stackW(cols) { return cols * 2 + (cols - 1) * 0.5 + 0.5; }
    /** Height: rows of 1.2u, plus 0.35u studs on top, plus the 0.5u plate. */
    function stackH(rows) { return 1.2 * rows + 0.85; }
    function colsFor(count) { return Math.max(1, Math.ceil(count / COL_ROWS)); }
    function rowsFor(count) { return clamp(count, 1, COL_ROWS); }

    /** Small studs along the top of a brick-style label or banner. */
    function studsHTML(n) { return '<span class="studs" aria-hidden="true">' + '<i></i>'.repeat(n) + '</span>'; }

    /**
     * Global UI scale: root font-size = 16px * s, s = clamp(min(w/400, h/720), 1, 1.45).
     * s never drops below 1, so phones keep every minimum size; tablets scale up.
     */
    function applyScale() {
      const s = clamp(Math.min(window.innerWidth / 400, window.innerHeight / 720), 1, 1.45);
      document.documentElement.style.fontSize = (16 * s).toFixed(2) + 'px';
    }
    function rootPx() { return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }

    /**
     * Pick the stud pitch u so the current picture fits #stage. render() leaves
     * stage._fit = { wu, hu, wpx, hpx, prep }: the picture is (wu*u + wpx) wide
     * and (hu*u + hpx) tall; prep(W, H, rem) may size fixed-px parts first (hero
     * faces, tower buttons) and return new wpx/hpx. The stage's own size never
     * depends on its contents (flex: 1 1 0), so this cannot loop.
     * Called after render, when the hint appears, and on resize.
     */
    function fitStage() {
      const stage = document.getElementById('stage');
      if (!stage || !stage._fit) return;
      const cs = getComputedStyle(stage);
      const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const rem = rootPx();
      const f = Object.assign({ wpx: 0, hpx: 0 }, stage._fit);
      if (f.prep) Object.assign(f, f.prep(W, H, rem));
      let u = Math.min((W - f.wpx) / f.wu, (H - f.hpx) / f.hu) * SIZE.FIT_SAFETY;
      u = clamp(Math.floor(u * 4) / 4, SIZE.U_MIN, SIZE.U_MAX_REM * rem);
      stage.style.setProperty('--u', u + 'px');
    }

    return {
      bandColour, brickHTML, columnsHTML, stackHTML, stackW, stackH, colsFor, rowsFor, studsHTML,
      applyScale, rootPx, fitStage
    };
  });
}());
