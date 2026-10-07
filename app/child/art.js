/*
 * art (L5): hero and villain SVG, icons and icon buttons (moved from v1 section 7).
 * All art is original, flat fills and strokes only (no <defs> or ids, so the
 * same face can appear many times on one screen).
 */
(function () {
  'use strict';

  NBA.define('art', ['util', 'catalog'], (util, catalog) => {
    const { esc } = util;
    const { heroById, DEFAULT_HERO } = catalog;

    const STROKE = 'stroke="#111" stroke-linecap="round" stroke-linejoin="round"';
    function icon(body) { return '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' + body + '</svg>'; }

    /** Inline SVG icons for every essential control (no emoji). */
    const ICONS = {
      home: icon('<path d="M8 14v13h6v-7h4v7h6V14" fill="#ffd500" ' + STROKE + ' stroke-width="3"/><path d="M4 15.5 16 5l12 10.5" fill="none" ' + STROKE + ' stroke-width="3.4"/>'),
      speaker: icon('<path d="M4 12h5l7-6v20l-7-6H4z" fill="#ffd500" ' + STROKE + ' stroke-width="2.8"/><path d="M20.5 11.5a6.4 6.4 0 0 1 0 9M24.5 8a11.4 11.4 0 0 1 0 16" fill="none" ' + STROKE + ' stroke-width="2.8"/>'),
      soundOn: icon('<path d="M4 12h5l7-6v20l-7-6H4z" fill="#00a03c" ' + STROKE + ' stroke-width="2.8"/><path d="M20.5 11.5a6.4 6.4 0 0 1 0 9M24.5 8a11.4 11.4 0 0 1 0 16" fill="none" ' + STROKE + ' stroke-width="2.8"/>'),
      soundOff: icon('<path d="M4 12h5l7-6v20l-7-6H4z" fill="#a4a8ad" ' + STROKE + ' stroke-width="2.8"/><path d="M20 12l8 8M28 12l-8 8" fill="none" ' + STROKE + ' stroke-width="3.2"/>'),
      star: icon('<path d="M16 2.8l4 8.2 9 1.2-6.6 6.2 1.7 8.9L16 23l-8.1 4.3 1.7-8.9L3 12.2l9-1.2z" fill="#ffd500" ' + STROKE + ' stroke-width="2.4"/>'),
      undo: icon('<path d="M11 7 5 13l6 6" fill="none" ' + STROKE + ' stroke-width="3.4"/><path d="M6 13h12a7 7 0 0 1 0 14h-5" fill="none" ' + STROKE + ' stroke-width="3.4"/>'),
      next: icon('<path d="M5 16h19M16 8l8 8-8 8" fill="none" ' + STROKE + ' stroke-width="3.8"/>'),
      play: icon('<path d="M10 5.5v21L26 16z" fill="#fff" ' + STROKE + ' stroke-width="3"/>'),
      swap: icon('<path d="M5 11h19l-5-5M27 21H8l5 5" fill="none" ' + STROKE + ' stroke-width="3.2"/>'),
      tick: icon('<path d="M6 17l6 6L26 9" fill="none" ' + STROKE + ' stroke-width="4.2"/>'),
      again: icon('<path d="M25.5 17a9.5 9.5 0 1 1-3.2-8.2" fill="none" ' + STROKE + ' stroke-width="3.2"/><path d="M23.5 3.5v6.2h-6.2" fill="none" ' + STROKE + ' stroke-width="3.2"/>'),
      // P6: "Change player" (two heads) and the small Teacher mode button (a clipboard)
      players: icon('<rect x="3" y="9" width="12" height="12" rx="4" fill="#ffd23f" ' + STROKE + ' stroke-width="2.6"/><rect x="17" y="9" width="12" height="12" rx="4" fill="#ffd23f" ' +
        STROKE + ' stroke-width="2.6"/><path d="M3 28c1-4 11-4 12 0M17 28c1-4 11-4 12 0" fill="none" ' + STROKE + ' stroke-width="2.6"/>'),
      teacher: icon('<rect x="7" y="6" width="18" height="23" rx="2.5" fill="#fff" ' + STROKE + ' stroke-width="2.6"/><rect x="12" y="3.5" width="8" height="5" rx="1.5" fill="#a4a8ad" ' +
        STROKE + ' stroke-width="2.2"/><path d="M11 15h10M11 20h10M11 25h6" fill="none" ' + STROKE + ' stroke-width="2.4"/>')
    };

    /** Shared minifigure-style head: a stud on top of a rounded head. */
    function headBase(fill, studHi) {
      return '<rect x="36" y="3" width="28" height="13" rx="3" fill="' + fill + '" stroke="#111" stroke-width="5"/>' +
        (studHi ? '<rect x="40.5" y="6.5" width="8" height="4.5" rx="2" fill="' + studHi + '"/>' : '') +
        '<rect x="12" y="14" width="76" height="80" rx="24" fill="' + fill + '" stroke="#111" stroke-width="5"/>';
    }

    /** One forehead emblem per ninja, centred near (50, 26). */
    const EMBLEMS = {
      flame: '<path d="M50 16C57 23 60 28 57 33Q50 39 43 33C40 28 43 23 50 16Z" fill="#ff7e14" ' + STROKE + ' stroke-width="2.5"/>' +
        '<path d="M50 24C53 28 54 31 52 33Q50 35 48 33C46 31 47 28 50 24Z" fill="#ffd500"/>',
      bolt: '<path d="M54 15 42 29h7l-4 9 13-14h-7l4-9z" fill="#ffd500" ' + STROKE + ' stroke-width="2.5"/>',
      leaf: '<path d="M37 34C38 22 50 17 63 18C62 30 52 36 37 34Z" fill="#f2b705" ' + STROKE + ' stroke-width="2.5"/>' +
        '<path d="M40 32 58 21" fill="none" ' + STROKE + ' stroke-width="2"/>',
      moon: '<path d="M54 16.5A9.5 9.5 0 0 0 54 35.5A12 12 0 0 1 54 16.5Z" fill="#c7ccd1" stroke="#c7ccd1" stroke-width="1.5" stroke-linejoin="round"/>',
      snow: '<g fill="none" stroke="#0057c8" stroke-width="3" stroke-linecap="round"><path d="M50 17v19M41.8 21.8l16.4 9.4M58.2 21.8l-16.4 9.4"/></g>' +
        '<path d="M46.5 18.5 50 21.5l3.5-3M46.5 34.5 50 31.5l3.5 3" fill="none" stroke="#0057c8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    };

    /** Ninja: coloured hood, skin-coloured eye band, brave brows, emblem, knot tails. */
    function drawNinja(h) {
      return '<path d="M83 52 97 45 95 58ZM83 60 97 64 91 74Z" fill="' + h.hood + '" stroke="#111" stroke-width="3" stroke-linejoin="round"/>' +
        headBase(h.hood, h.studHi) +
        (h.rim ? '<rect x="17.5" y="19.5" width="65" height="69" rx="19" fill="none" stroke="' + h.rim + '" stroke-width="2.5"/>' : '') +
        '<rect x="18" y="38" width="64" height="27" rx="12" fill="#ffd23f" stroke="' + h.trim + '" stroke-width="4.5"/>' +
        '<path d="M27 44 44 47.5M73 44 56 47.5" fill="none" ' + STROKE + ' stroke-width="4"/>' +
        '<ellipse cx="38" cy="54.5" rx="5.5" ry="6.5" fill="#111"/><ellipse cx="62" cy="54.5" rx="5.5" ry="6.5" fill="#111"/>' +
        '<circle cx="40" cy="52" r="2" fill="#fff"/><circle cx="64" cy="52" r="2" fill="#fff"/>' +
        '<path d="M31 79Q50 85 69 79" fill="none" stroke="' + (h.seam || 'rgba(0,0,0,.3)') + '" stroke-width="3" stroke-linecap="round"/>' +
        EMBLEMS[h.emblem];
    }

    /** Web-mask hero: full mask, 6 web spokes plus 2 rings, big white lenses. */
    function drawWeb(h) {
      return headBase(h.mask, h.studHi) +
        '<g fill="none" stroke="' + h.web + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M50 56V18M50 56 84 36M50 56 84 76M50 56V91M50 56 16 76M50 56 16 36"/>' +
          '<path d="M50 41Q55.6 46.3 63 48.5Q61.3 56 63 63.5Q55.6 65.7 50 71Q44.4 65.7 37 63.5Q38.7 56 37 48.5Q44.4 46.3 50 41Z"/>' +
          '<path d="M50 26Q61.7 35.7 76 41Q73.4 56 76 71Q61.7 76.3 50 86Q38.3 76.3 24 71Q26.6 56 24 41Q38.3 35.7 50 26Z"/>' +
        '</g>' +
        (h.spot ? '<circle cx="50" cy="27" r="4.5" fill="' + h.spot + '" stroke="#111" stroke-width="2"/>' : '') +
        '<path d="M20 45Q28 33 45 42Q46 58 31 60Q20 58 20 45Z" fill="#fff" stroke="' + h.rim + '" stroke-width="5" stroke-linejoin="round"/>' +
        '<path d="M80 45Q72 33 55 42Q54 58 69 60Q80 58 80 45Z" fill="#fff" stroke="' + h.rim + '" stroke-width="5" stroke-linejoin="round"/>';
    }

    /** Armour hero: red helmet, gold faceplate, glowing cyan eye slits. */
    function drawArmour() {
      const slits = 'M28 52 44 55.5M72 52 56 55.5';
      return headBase('#e3000b', '#ff6b6b') +
        '<path d="M20 37Q50 29 80 37L78 70Q73 89 50 91Q27 89 22 70Z" fill="#f2b705" ' + STROKE + ' stroke-width="4.5"/>' +
        '<path d="M50 31v7" fill="none" stroke="#111" stroke-width="2.5"/>' +
        '<path d="' + slits + '" fill="none" stroke="#111" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="' + slits + '" fill="none" stroke="#7df9ff" stroke-opacity=".45" stroke-width="12" stroke-linecap="round"/>' +
        '<path d="' + slits + '" fill="none" stroke="#7df9ff" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M39 77h22" fill="none" ' + STROKE + ' stroke-width="3.5"/>';
    }

    const HERO_LOOKS = { ninja: drawNinja, web: drawWeb, armour: drawArmour };

    /** Inline SVG face for a hero id (falls back to the default hero). */
    function heroSVG(id) {
      const h = heroById(id) || heroById(DEFAULT_HERO);
      return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + HERO_LOOKS[h.look](h) + '</svg>';
    }

    /** Rumble: a grumpy, silly grey robot with mismatched eyes and pink cheeks. */
    function villainSVG() {
      return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
        '<path d="M50 27C44 20 57 16 50 10" fill="none" ' + STROKE + ' stroke-width="4"/>' +
        '<circle cx="50" cy="8" r="6" fill="#e3000b" stroke="#111" stroke-width="3"/>' +
        '<rect x="4" y="49" width="11" height="19" rx="3" fill="#7d8287" stroke="#111" stroke-width="3.5"/>' +
        '<rect x="85" y="49" width="11" height="19" rx="3" fill="#7d8287" stroke="#111" stroke-width="3.5"/>' +
        '<rect x="13" y="26" width="74" height="67" rx="10" fill="#a4a8ad" stroke="#111" stroke-width="5"/>' +
        '<g fill="#6b7075"><circle cx="21" cy="34" r="3"/><circle cx="79" cy="34" r="3"/><circle cx="21" cy="85" r="3"/><circle cx="79" cy="85" r="3"/></g>' +
        '<circle cx="36" cy="55" r="12" fill="#fff" stroke="#111" stroke-width="4"/><circle cx="39" cy="58" r="5.5" fill="#111"/>' +
        '<circle cx="66" cy="57" r="8.5" fill="#fff" stroke="#111" stroke-width="4"/><circle cx="64" cy="59" r="4" fill="#111"/>' +
        '<path d="M22 40 78 45" fill="none" ' + STROKE + ' stroke-width="6.5"/>' +
        '<circle cx="23" cy="73" r="4.5" fill="#ff8fb1"/><circle cx="77" cy="73" r="4.5" fill="#ff8fb1"/>' +
        '<path d="M37 84Q50 72 63 84Z" fill="#5c6166" ' + STROKE + ' stroke-width="3.5"/>' +
        '<path d="M44 80.5v2M50 78.5v4M56 80.5v2" fill="none" stroke="#d9dde1" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>';
    }

    /** A face wrapped in a sized box. */
    function faceHTML(id, cls, extraAttr) {
      return '<span class="face ' + (cls || '') + '"' + (extraAttr || '') + '>' + heroSVG(id) + '</span>';
    }
    function villainHTML(cls) {
      return '<span class="face villain ' + (cls || '') + '">' + villainSVG() + '</span>';
    }

    function iconBtn(action, iconName, label, extra) {
      return '<button type="button" class="icon-btn" data-action="' + action + '" aria-label="' + esc(label) + '"' +
        (extra || '') + '>' + ICONS[iconName] + '</button>';
    }

    return { ICONS, heroSVG, villainSVG, faceHTML, villainHTML, iconBtn };
  });
}());
