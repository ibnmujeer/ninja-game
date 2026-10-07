/*
 * Curriculum (DESIGN 6, 14.1, 14.2, 14.8; JSON-compatible data only). P5 adds the Ninja Check blueprint.
 *   conceptOrder  the teaching order of the ten add/sub concepts the spec lists (ties in 14.4)
 *   levelPriority the slot concept choice of 14.4: the first level in this list goes first
 *   matrix        concept x representation -> activity (14.2), for the 4 concepts the adaptive
 *                 engine decides on; matrixColumns is the column order; matrixTemplates the
 *                 sub-word template of each row
 *   assignable    the 9 teacher-selectable concepts (14.8): fitting activities, levels, the default
 *                 driver (oddDriver: addsub.mixed at odd occurrences), the activity driver (an
 *                 activity -> driver map; unlisted activities use the default driver) and the
 *                 no-data default (oddDefault for addsub.mixed)
 *   slots         world id -> v1 plan label -> the slot family:
 *     adaptive    true when P4 may fill the slot with another activity of the family
 *     family      addition | subtraction | fixed (the v1 type only)
 *     concepts    the slot concepts (adaptive slots) or the tracking concept (fixed slots)
 *     mixed       true in world 5 add/sub slots: their attempts also credit addsub.mixed
 * Worlds 3 and 4 (and the fixed slots) always play the v1 type at the v1 level.
 *   blueprints    P5 (DESIGN 15.1): the Ninja Check. 12 fixed cells, played in this order by both
 *                 forms (baseline and post): the scored concept, the representation, the level, the
 *                 activity, the sub-word template and transfer (the attempt also credits rep.transition)
 */
NBA.data.curriculum = {
  "conceptOrder": ["add.combine", "add.count-on", "add.within-10", "add.within-20", "sub.take-away", "sub.difference",
    "sub.within-10", "sub.within-20", "addsub.mixed", "rep.transition"],
  "levelPriority": ["needs_support", "insufficient_data", "developing", "strong"],
  "matrixColumns": ["concrete", "visual", "number-line", "symbolic", "word-problem"],
  "matrix": {
    "add.combine": { "concrete": "add-build", "visual": "add", "symbolic": "add-sym", "word-problem": "add-word" },
    "add.count-on": { "concrete": "add-build", "visual": "add", "number-line": "add-line", "symbolic": "add-sym", "word-problem": "add-word" },
    "sub.take-away": { "concrete": "sub-build", "visual": "knock", "number-line": "sub-line", "symbolic": "sub-sym", "word-problem": "sub-word" },
    "sub.difference": { "visual": "more", "symbolic": "sub-sym", "word-problem": "sub-word" }
  },
  "matrixTemplates": { "sub.take-away": "take", "sub.difference": "diff" },
  "assignable": {
    "add.combine": { "activities": ["add-build", "add", "add-sym", "add-word"], "levels": [1, 2, 3, 4],
      "defaultDriver": "add.combine", "activityDriver": {}, "default": { "activityId": "add", "difficulty": 2 } },
    "add.count-on": { "activities": ["add-build", "add", "add-line", "add-sym", "add-word"], "levels": [1, 2, 3, 4],
      "defaultDriver": "add.count-on", "activityDriver": {}, "default": { "activityId": "add", "difficulty": 2 } },
    "sub.take-away": { "activities": ["sub-build", "knock", "sub-line", "sub-sym", "sub-word"], "levels": [1, 2, 3, 4],
      "defaultDriver": "sub.take-away", "activityDriver": {}, "default": { "activityId": "knock", "difficulty": 2 } },
    "sub.difference": { "activities": ["more", "sub-sym", "sub-word"], "levels": [1, 2, 3, 4],
      "defaultDriver": "sub.difference", "activityDriver": {}, "default": { "activityId": "more", "difficulty": 2 } },
    "add.within-10": { "activities": ["add-build", "add", "add-line", "add-sym", "add-word"], "levels": [1, 2],
      "defaultDriver": "add.combine", "activityDriver": { "add-line": "add.count-on" }, "default": { "activityId": "add", "difficulty": 2 } },
    "add.within-20": { "activities": ["add-build", "add", "add-line", "add-sym", "add-word"], "levels": [3, 4],
      "defaultDriver": "add.combine", "activityDriver": { "add-line": "add.count-on" }, "default": { "activityId": "add", "difficulty": 4 } },
    "sub.within-10": { "activities": ["sub-build", "knock", "sub-line", "more", "sub-sym", "sub-word"], "levels": [1, 2],
      "defaultDriver": "sub.take-away", "activityDriver": { "more": "sub.difference" }, "default": { "activityId": "knock", "difficulty": 2 } },
    "sub.within-20": { "activities": ["sub-build", "knock", "sub-line", "more", "sub-sym", "sub-word"], "levels": [3, 4],
      "defaultDriver": "sub.take-away", "activityDriver": { "more": "sub.difference" }, "default": { "activityId": "knock", "difficulty": 4 } },
    "addsub.mixed": { "activities": ["add-build", "add", "add-sym", "add-word", "sub-build", "knock", "sub-line", "sub-sym", "sub-word"],
      "levels": [1, 2, 3, 4], "mixed": true,
      "defaultDriver": "add.combine", "oddDriver": "sub.take-away", "activityDriver": {},
      "default": { "activityId": "add", "difficulty": 2 }, "oddDefault": { "activityId": "knock", "difficulty": 2 } }
  },
  "slots": {
    "addition": {
      "build": { "adaptive": false, "family": "fixed", "concepts": ["num.count"], "mixed": false },
      "add": { "adaptive": true, "family": "addition", "concepts": ["add.combine", "add.count-on"], "mixed": false },
      "more": { "adaptive": true, "family": "subtraction", "concepts": ["sub.difference"], "mixed": false },
      "bigger": { "adaptive": false, "family": "fixed", "concepts": ["num.compare"], "mixed": false }
    },
    "subtraction": {
      "knock": { "adaptive": true, "family": "subtraction", "concepts": ["sub.take-away"], "mixed": false },
      "more": { "adaptive": true, "family": "subtraction", "concepts": ["sub.difference"], "mixed": false }
    },
    "multiplication": {
      "groups": { "adaptive": false, "family": "fixed", "concepts": ["mul.groups"], "mixed": false }
    },
    "division": {
      "share": { "adaptive": false, "family": "fixed", "concepts": ["div.share"], "mixed": false }
    },
    "master": {
      "build": { "adaptive": false, "family": "fixed", "concepts": ["num.count"], "mixed": false },
      "add": { "adaptive": true, "family": "addition", "concepts": ["add.combine", "add.count-on"], "mixed": true },
      "more": { "adaptive": true, "family": "subtraction", "concepts": ["sub.difference"], "mixed": true },
      "bigger": { "adaptive": false, "family": "fixed", "concepts": ["num.compare"], "mixed": false },
      "knock": { "adaptive": true, "family": "subtraction", "concepts": ["sub.take-away"], "mixed": true },
      "groups": { "adaptive": false, "family": "fixed", "concepts": ["mul.groups"], "mixed": false },
      "share": { "adaptive": false, "family": "fixed", "concepts": ["div.share"], "mixed": false }
    }
  },
  "blueprints": {
    "ninja-check.v1": {
      "id": "ninja-check.v1",
      "cells": [
        { "id": "c01", "conceptId": "add.combine", "representation": "visual", "difficulty": 2, "activityId": "add", "template": null, "transfer": false },
        { "id": "c02", "conceptId": "sub.take-away", "representation": "visual", "difficulty": 2, "activityId": "knock", "template": null, "transfer": false },
        { "id": "c03", "conceptId": "add.count-on", "representation": "number-line", "difficulty": 2, "activityId": "add-line", "template": null, "transfer": false },
        { "id": "c04", "conceptId": "sub.take-away", "representation": "concrete", "difficulty": 2, "activityId": "sub-build", "template": null, "transfer": true },
        { "id": "c05", "conceptId": "add.within-10", "representation": "symbolic", "difficulty": 2, "activityId": "add-sym", "template": null, "transfer": false },
        { "id": "c06", "conceptId": "sub.difference", "representation": "visual", "difficulty": 2, "activityId": "more", "template": null, "transfer": false },
        { "id": "c07", "conceptId": "add.combine", "representation": "concrete", "difficulty": 2, "activityId": "add-build", "template": null, "transfer": true },
        { "id": "c08", "conceptId": "sub.within-10", "representation": "symbolic", "difficulty": 2, "activityId": "sub-sym", "template": null, "transfer": false },
        { "id": "c09", "conceptId": "add.combine", "representation": "word-problem", "difficulty": 2, "activityId": "add-word", "template": null, "transfer": false },
        { "id": "c10", "conceptId": "sub.take-away", "representation": "number-line", "difficulty": 3, "activityId": "sub-line", "template": null, "transfer": false },
        { "id": "c11", "conceptId": "add.within-20", "representation": "symbolic", "difficulty": 4, "activityId": "add-sym", "template": null, "transfer": false },
        { "id": "c12", "conceptId": "sub.difference", "representation": "word-problem", "difficulty": 2, "activityId": "sub-word", "template": "diff", "transfer": false }
      ]
    }
  }
};
