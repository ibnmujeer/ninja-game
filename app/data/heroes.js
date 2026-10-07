/*
 * Heroes, villain and the shared text lines (moved from v1 section 1; JSON-compatible data only).
 *   list        the 8 original heroes. `look` picks the drawing in child/art.js:
 *               'ninja' = hood, eye band and forehead emblem; 'web' = full mask, web lines
 *               and big lenses; 'armour' = helmet, gold faceplate and glowing eye slits.
 *   defaultHero used until a hero is picked
 *   villain     the (silly, not scary) villain, drawn by art.villainSVG()
 *   praise      shown and spoken after a correct answer. {hero} becomes the hero's name.
 *   encourage   start of every hint: kind words only, never "wrong".
 *   restLine    soft rest reminder on the World Complete screen
 */
NBA.data.heroes = {
  "list": [
    { "id": "blaze", "name": "Blaze", "look": "ninja", "hood": "#e3000b", "trim": "#111", "emblem": "flame" },
    { "id": "storm", "name": "Storm", "look": "ninja", "hood": "#0057c8", "trim": "#111", "emblem": "bolt" },
    { "id": "jade", "name": "Jade", "look": "ninja", "hood": "#00a03c", "trim": "#111", "emblem": "leaf" },
    { "id": "shadow", "name": "Shadow", "look": "ninja", "hood": "#1d1d1d", "trim": "#c7ccd1", "emblem": "moon", "studHi": "#c7ccd1", "rim": "#6d737a", "seam": "#6d737a" },
    { "id": "frost", "name": "Frost", "look": "ninja", "hood": "#ffffff", "trim": "#8fd3ff", "emblem": "snow", "studHi": "#dbe9f5", "seam": "#9fb3c4" },
    { "id": "webflash", "name": "Web Flash", "look": "web", "mask": "#e3000b", "web": "#111", "rim": "#111", "studHi": "#ff6b6b" },
    { "id": "nightweb", "name": "Night Web", "look": "web", "mask": "#1d1d1d", "web": "#d9dde1", "rim": "#8a9096", "spot": "#e3000b", "studHi": "#6d737a" },
    { "id": "rocket", "name": "Rocket", "look": "armour" }
  ],
  "defaultHero": "blaze",
  "villain": { "name": "Rumble" },
  "praise": ["Brilliant!", "You got it!", "Super ninja maths!", "Great job, {hero}!",
    "Ninja power, {hero}!", "Awesome building!", "Yes! Well done!"],
  "encourage": ["Nearly!", "Good try!", "So close!"],
  "restLine": "Super training today! Time for a ninja rest?"
};
