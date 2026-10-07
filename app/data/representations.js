/*
 * Representations (DESIGN 7, D7; JSON-compatible data only). Each activity has exactly one,
 * and it is recorded on every attempt.
 *   order   the concreteness order the adaptive engine uses (most to least concrete);
 *           word-problem is a separate branch, never the first step down from symbolic
 *   list    id, teacher-facing name and the exact definition
 */
NBA.data.representations = {
  "order": ["concrete", "visual", "number-line", "symbolic"],
  "list": [
    { "id": "concrete", "name": "Concrete (build with bricks)",
      "definition": "The child acts on bricks to make the answer: adds bricks with +1 or removes them with Undo, then taps Done. The answer is the number of bricks the child ends with. No equation is shown." },
    { "id": "visual", "name": "Visual (count the brick picture)",
      "definition": "A picture of bricks the child can count shows the quantities. The child answers with number buttons or by tapping a tower. A short equation may appear under the picture, but the picture alone is enough to answer." },
    { "id": "number-line", "name": "Number line",
      "definition": "A numbered line of brick tiles with the start marked by the hero face and the jumps drawn as arcs (forward for addition, back for subtraction). The landing tile shows ? instead of its number. No countable brick groups." },
    { "id": "symbolic", "name": "Symbolic (numbers and signs only)",
      "definition": "Numerals and operation signs only, on a plain brick-styled card. No bricks, no line and no pictures of quantity. Speech says the sum in words." },
    { "id": "word-problem", "name": "Word problem",
      "definition": "A short story (at most 2 sentences and a question), read aloud, with names and objects from the game. The stage shows the faces and one object only, with no countable quantities and no equation." }
  ]
};
