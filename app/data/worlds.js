/*
 * WORLDS: one entry per world, in play order (moved from v1 section 1; JSON-compatible data only).
 *   id      stable storage key (never rename it: saved stars use it)
 *   name    shown on the Home tile, story card and mission header
 *   op      short label under the name on Home
 *   symbol  big symbol on the tile and story banner
 *   colour  PALETTE key (CSS variable --<colour>)
 *   story   1 or 2 short sentences, shown and spoken before mission 1
 *   win     shown and spoken on the World Complete screen ({hero} = hero name)
 *   finale  optional extra celebration line (used by the last world)
 *   plan    the 8-mission plan as data, built by generator.buildPlan(world):
 *           { kind: 'halves', types: [4 ids] } | { kind: 'repeat', type: id } | { kind: 'master' }
 */
NBA.data.worlds = {
  "list": [
    { "id": "addition", "name": "Brick Builders", "op": "Adding", "symbol": "+", "colour": "red",
      "story": "Rumble smashed the Ninja Brick Academy! Let's build it back, brick by brick.",
      "win": "The Academy walls are built! Great building, {hero}!",
      "plan": { "kind": "halves", "types": ["build", "add", "more", "bigger"] } },
    { "id": "subtraction", "name": "Rumble Attack", "op": "Taking away", "symbol": "\u2212", "colour": "blue",
      "story": "Rumble is back, knocking bricks off our towers! Count what is left.",
      "win": "Rumble ran away! Our towers are safe.",
      "plan": { "kind": "halves", "types": ["knock", "knock", "knock", "more"] } },
    { "id": "multiplication", "name": "Brick Factory", "op": "Groups", "symbol": "\u00d7", "colour": "green",
      "story": "The Brick Factory makes bricks in groups. How many in all?",
      "win": "The Brick Factory is working again!",
      "plan": { "kind": "repeat", "type": "groups" } },
    { "id": "division", "name": "Treasure Share", "op": "Sharing", "symbol": "\u00f7", "colour": "orange",
      "story": "We found treasure bricks! Share them fairly with your ninja team.",
      "win": "Everyone got a fair share. Super sharing!",
      "plan": { "kind": "repeat", "type": "share" } },
    { "id": "master", "name": "Ninja Master", "op": "Mixed", "symbol": "\u2605", "colour": "black",
      "story": "The final trial! Use all your ninja maths to become a Ninja Master.",
      "win": "The Ninja Brick Academy is saved!",
      "finale": "You are a Ninja Master, {hero}! You did it!",
      "plan": { "kind": "master" } }
  ]
};
