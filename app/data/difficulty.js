/*
 * Difficulty levels 1 to 4 (DESIGN 6.2; JSON-compatible data only). Each level is a subset of one
 * v1 tier (q.max 10 or 20), so every question keeps the v1 number rules of its tier. Levels 2 and 4
 * are exactly v1's max-10 and max-20 rules, and v1Default (2 for missions 1 to 4, 4 for 5 to 8) is
 * v1's MAX_BY_MISSION, so a student with no data plays exactly as in v1.
 *   families  number rules per activity family and level (the generation constraints):
 *     add        a, b >= min, b <= bMax (when set), sumMin <= a + b <= sumMax
 *     take-away  aMin <= a <= aMax, bMin <= b <= bMax, a - b >= leftMin
 *     more       tMin <= total <= tMax, mMin <= total - have <= mMax, have >= 1
 *     build      nMin <= n <= nMax
 *     bigger     lo <= both heights <= hi, 1 <= difference <= dMax, taller >= largerMin (when set)
 *     groups, share   v1's fixed lists ([g, s] and [n, k])
 *   extra     per activity and level: add-line keeps b <= 9 and a >= b at levels 3 and 4
 */
NBA.data.difficulty = {
  "levels": [1, 2, 3, 4],
  "tierByLevel": { "1": 10, "2": 10, "3": 20, "4": 20 },
  "levelByTier": { "10": 2, "20": 4 },
  "v1Default": [2, 2, 2, 2, 4, 4, 4, 4],
  "families": {
    "add": {
      "1": { "min": 1, "bMax": 3, "sumMin": 4, "sumMax": 7 },
      "2": { "min": 1, "sumMin": 4, "sumMax": 10 },
      "3": { "min": 2, "bMax": 5, "sumMin": 11, "sumMax": 20 },
      "4": { "min": 2, "sumMin": 11, "sumMax": 20 }
    },
    "take-away": {
      "1": { "aMin": 4, "aMax": 7, "bMin": 1, "bMax": 3, "leftMin": 1 },
      "2": { "aMin": 4, "aMax": 10, "bMin": 1, "bMax": 5, "leftMin": 1 },
      "3": { "aMin": 11, "aMax": 20, "bMin": 2, "bMax": 5, "leftMin": 2 },
      "4": { "aMin": 11, "aMax": 20, "bMin": 2, "bMax": 9, "leftMin": 2 }
    },
    "more": {
      "1": { "tMin": 4, "tMax": 7, "mMin": 1, "mMax": 3 },
      "2": { "tMin": 4, "tMax": 10, "mMin": 1, "mMax": 5 },
      "3": { "tMin": 11, "tMax": 20, "mMin": 2, "mMax": 5 },
      "4": { "tMin": 11, "tMax": 20, "mMin": 2, "mMax": 9 }
    },
    "build": {
      "2": { "nMin": 3, "nMax": 10 },
      "4": { "nMin": 11, "nMax": 20 }
    },
    "bigger": {
      "2": { "lo": 2, "hi": 10, "dMax": 4 },
      "4": { "lo": 8, "hi": 20, "dMax": 3, "largerMin": 11 }
    },
    "groups": {
      "2": { "list": [[2, 2], [2, 3], [2, 4], [2, 5], [3, 2], [3, 3], [4, 2], [5, 2]] },
      "4": { "list": [[3, 4], [3, 5], [4, 3], [4, 4], [4, 5], [5, 3], [5, 4]] }
    },
    "share": {
      "2": { "list": [[4, 2], [6, 2], [8, 2], [10, 2], [6, 3], [9, 3], [8, 4], [10, 5]] },
      "4": { "list": [[12, 2], [14, 2], [16, 2], [18, 2], [20, 2], [12, 3], [15, 3], [18, 3], [12, 4], [16, 4], [20, 4], [15, 5], [20, 5]] }
    }
  },
  "extra": {
    "add-line": {
      "3": { "bMax": 9, "aGteB": true },
      "4": { "bMax": 9, "aGteB": true }
    }
  }
};
