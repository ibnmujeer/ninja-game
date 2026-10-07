/*
 * Concepts (DESIGN 6.1; JSON-compatible data only). Stable ids, never display names, are the
 * keys everywhere. adaptive: true concepts get the full mastery and adaptive treatment (P4);
 * the tracking-only ones get mastery statistics only. Names are teacher-facing.
 */
NBA.data.concepts = {
  "list": [
    { "id": "add.combine", "name": "Addition as combining quantities", "operation": "addition", "adaptive": true },
    { "id": "add.count-on", "name": "Addition as counting on", "operation": "addition", "adaptive": true },
    { "id": "add.within-10", "name": "Addition within 10", "operation": "addition", "adaptive": true },
    { "id": "add.within-20", "name": "Addition within 20", "operation": "addition", "adaptive": true },
    { "id": "sub.take-away", "name": "Subtraction as taking away", "operation": "subtraction", "adaptive": true },
    { "id": "sub.difference", "name": "Subtraction as difference", "operation": "subtraction", "adaptive": true },
    { "id": "sub.within-10", "name": "Subtraction within 10", "operation": "subtraction", "adaptive": true },
    { "id": "sub.within-20", "name": "Subtraction within 20", "operation": "subtraction", "adaptive": true },
    { "id": "addsub.mixed", "name": "Mixed addition and subtraction", "operation": "mixed", "adaptive": true },
    { "id": "rep.transition", "name": "Moving between concrete, visual and symbolic", "operation": "mixed", "adaptive": true },
    { "id": "num.count", "name": "Counting a quantity (build a tower)", "operation": "counting", "adaptive": false },
    { "id": "num.compare", "name": "Comparing quantities (bigger tower)", "operation": "comparison", "adaptive": false },
    { "id": "mul.groups", "name": "Multiplication as equal groups", "operation": "multiplication", "adaptive": false },
    { "id": "div.share", "name": "Division as fair sharing", "operation": "division", "adaptive": false }
  ],
  "range": {
    "addition": { "10": "add.within-10", "20": "add.within-20" },
    "subtraction": { "10": "sub.within-10", "20": "sub.within-20" }
  }
};
