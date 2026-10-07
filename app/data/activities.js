/*
 * Activities: the learning object metadata (DESIGN 8.1; JSON-compatible data only). One entry per
 * question type; questionTypes merges it into the registry entry with the same id.
 *   operation       counting | addition | subtraction | comparison | multiplication | division
 *   representation  one id of data/representations.js
 *   primaryConcept  credited first when no slot decision names a concept (DESIGN 6.3)
 *   concepts        concepts the activity can serve: fit checks only, never credited automatically
 *   inputMode       choices | build | towers
 *   answerType      integer | count | tower-index
 *   difficulties    declared levels (data/difficulty.js); family = the number rules used
 *   templates       sub-word only: template -> difficulty family (take: take-away, diff: more)
 *   hintStrategy    how hint(q, wrongCount) helps, always with the question's own numbers
 *   adaptive        true when P4 may choose it for an adaptive slot
 *   worlds          the worlds whose slots may show it; v1 = a v1 question type (D7: kept as is)
 */
NBA.data.activities = {
  "list": [
    { "id": "build", "operation": "counting", "representation": "concrete", "primaryConcept": "num.count",
      "concepts": ["num.count"], "inputMode": "build", "answerType": "count", "difficulties": [2, 4], "family": "build",
      "hintStrategy": "count-bricks", "adaptive": false, "worlds": ["addition", "master"], "v1": true },
    { "id": "add", "operation": "addition", "representation": "visual", "primaryConcept": "add.combine",
      "concepts": ["add.combine", "add.count-on", "add.within-10", "add.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "add",
      "hintStrategy": "count-on", "adaptive": true, "worlds": ["addition", "master"], "v1": true },
    { "id": "more", "operation": "subtraction", "representation": "visual", "primaryConcept": "sub.difference",
      "concepts": ["sub.difference", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "more",
      "hintStrategy": "count-dashed", "adaptive": true, "worlds": ["addition", "subtraction", "master"], "v1": true },
    { "id": "bigger", "operation": "comparison", "representation": "visual", "primaryConcept": "num.compare",
      "concepts": ["num.compare"], "inputMode": "towers", "answerType": "tower-index", "difficulties": [2, 4], "family": "bigger",
      "hintStrategy": "compare-heights", "adaptive": false, "worlds": ["addition", "master"], "v1": true },
    { "id": "knock", "operation": "subtraction", "representation": "visual", "primaryConcept": "sub.take-away",
      "concepts": ["sub.take-away", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "take-away",
      "hintStrategy": "count-standing", "adaptive": true, "worlds": ["subtraction", "master"], "v1": true },
    { "id": "groups", "operation": "multiplication", "representation": "visual", "primaryConcept": "mul.groups",
      "concepts": ["mul.groups"], "inputMode": "choices", "answerType": "integer", "difficulties": [2, 4], "family": "groups",
      "hintStrategy": "skip-count", "adaptive": false, "worlds": ["multiplication", "master"], "v1": true },
    { "id": "share", "operation": "division", "representation": "visual", "primaryConcept": "div.share",
      "concepts": ["div.share"], "inputMode": "choices", "answerType": "integer", "difficulties": [2, 4], "family": "share",
      "hintStrategy": "share-one-each", "adaptive": false, "worlds": ["division", "master"], "v1": true },
    { "id": "add-build", "operation": "addition", "representation": "concrete", "primaryConcept": "add.combine",
      "concepts": ["add.combine", "add.count-on", "add.within-10", "add.within-20", "addsub.mixed"], "inputMode": "build",
      "answerType": "count", "difficulties": [1, 2, 3, 4], "family": "add",
      "hintStrategy": "count-on-bricks", "adaptive": true, "worlds": ["addition", "master"], "v1": false },
    { "id": "sub-build", "operation": "subtraction", "representation": "concrete", "primaryConcept": "sub.take-away",
      "concepts": ["sub.take-away", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "build",
      "answerType": "count", "difficulties": [1, 2, 3, 4], "family": "take-away",
      "hintStrategy": "take-away-bricks", "adaptive": true, "worlds": ["addition", "subtraction", "master"], "v1": false },
    { "id": "add-line", "operation": "addition", "representation": "number-line", "primaryConcept": "add.count-on",
      "concepts": ["add.count-on", "add.within-10", "add.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "add",
      "hintStrategy": "count-on-hops", "adaptive": true, "worlds": ["addition", "master"], "v1": false },
    { "id": "sub-line", "operation": "subtraction", "representation": "number-line", "primaryConcept": "sub.take-away",
      "concepts": ["sub.take-away", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "take-away",
      "hintStrategy": "count-back-hops", "adaptive": true, "worlds": ["addition", "subtraction", "master"], "v1": false },
    { "id": "add-sym", "operation": "addition", "representation": "symbolic", "primaryConcept": "add.within-10",
      "concepts": ["add.combine", "add.count-on", "add.within-10", "add.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "add",
      "hintStrategy": "count-on-from-bigger", "adaptive": true, "worlds": ["addition", "master"], "v1": false },
    { "id": "sub-sym", "operation": "subtraction", "representation": "symbolic", "primaryConcept": "sub.within-10",
      "concepts": ["sub.take-away", "sub.difference", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "take-away",
      "hintStrategy": "count-back-or-up", "adaptive": true, "worlds": ["addition", "subtraction", "master"], "v1": false },
    { "id": "add-word", "operation": "addition", "representation": "word-problem", "primaryConcept": "add.combine",
      "concepts": ["add.combine", "add.count-on", "add.within-10", "add.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "add",
      "hintStrategy": "retell-then-add", "adaptive": true, "worlds": ["addition", "master"], "v1": false },
    { "id": "sub-word", "operation": "subtraction", "representation": "word-problem", "primaryConcept": "sub.take-away",
      "concepts": ["sub.take-away", "sub.difference", "sub.within-10", "sub.within-20", "addsub.mixed"], "inputMode": "choices",
      "answerType": "integer", "difficulties": [1, 2, 3, 4], "family": "take-away",
      "templates": { "take": "take-away", "diff": "more" },
      "hintStrategy": "retell-then-subtract", "adaptive": true, "worlds": ["addition", "subtraction", "master"], "v1": false }
  ]
};
