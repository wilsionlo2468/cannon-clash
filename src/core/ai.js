/* CC.AI — three-difficulty cannon AI: terrain-aware shot solving + error injection (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Error table pinned verbatim by the task brief: per difficulty, the
  // injected angle error (degrees) and power error (points). Injection is
  // (rand*2-1) * err — uniform over the full span — so these are hard
  // bounds on the deviation from the perfect solution.
  var ERRORS = {
    easy:   { angle: 12,  power: 18 },
    normal: { angle: 6,   power: 9 },
    hell:   { angle: 1.5, power: 2.5 }
  };

  // AI think delay in seconds, pinned by the task brief. Core builds in no
  // timer (same ruling as the match's RESOLVE pause): task 11's view waits
  // this long on the AI turn before applying pickShot's answer.
  var THINK_DELAY = 1.2;

  // Elevation tiers tried in order for the perfect solution (brief:
  // 35/45/55°). The per-side firing direction is the cannon convention:
  // P1 fires at +angle, P2 at 180-angle.
  var TIERS = [35, 45, 55];

  // The corridor's "命中敌方附近" threshold that turns a terrain contact
  // into a connecting hit: the normal shell's blast radius (the AI fires
  // normal only), matching what Weapons.settle measures.
  var NEAR_HIT = 50;

  function dist(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * corridor(x0, y0, angleDeg, power, wind, foe) -> {clear, landing}
   * Walks the integrated trajectory segment by segment (Terrain.hit per
   * segment — the REAL landing; the solver's y=1500 impact is fictitious
   * and the enemy's terrain usually occludes it) until the first terrain
   * contact or until the shell crosses the enemy's x column:
   *   contact within NEAR_HIT of the enemy center -> clear (it connects)
   *   contact further away                        -> blocked, landing kept
   *   enemy column crossed in the air first       -> clear (corridor ends)
   * Segment 0 is skipped: the muzzle rests ON its platform surface, so its
   * t=0 endpoint contact is the cannon standing there, not a corridor hit.
   * The x crossing is checked after the contact on the same segment — with
   * 1/60s steps they coincide only within one step of sub-step noise.
   */
  function corridor(x0, y0, angleDeg, power, wind, foe) {
    var flight = CC.Ballistics.simulate(x0, y0, angleDeg, power, wind);
    var points = flight.points;
    for (var i = 2; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      var h = CC.Terrain.hit(a.x, a.y, b.x, b.y);
      if (h) {
        return {
          clear: dist(h.x, h.y, foe.x, foe.y) < NEAR_HIT,
          landing: h
        };
      }
      if ((a.x - foe.x) * (b.x - foe.x) <= 0) {
        return { clear: true, landing: null }; // flew over the enemy column
      }
    }
    // Defensive totality: the terrain surface spans the whole field and
    // the flight ends at y=1500 below it, so a contact always comes first
    // in practice.
    return { clear: false, landing: flight.impact };
  }

  /**
   * perfectShot(shooter, foe, wind, turn) -> {angle, power}
   * The brief's perfect solution: per elevation tier (35/45/55, in order)
   * solve the power whose stop-line impact lands on the enemy's x, then
   * keep the first tier whose corridor stays clear until it reaches the
   * enemy. Every tier may be blocked — on the pinned field the valley wall
   * always occludes the descending leg — so the fallback takes the blocked
   * tier whose real landing is closest to the enemy center. Unreachable
   * tiers (solvePower null) are skipped; if every tier were unreachable
   * (impossible for the pinned stances — max range dwarfs their
   * separation) a maximal 45° shot keeps pickShot total for the view.
   */
  function perfectShot(shooter, foe, wind, turn) {
    var best = null;
    var fallback = null;
    for (var i = 0; i < TIERS.length; i++) {
      var angle = TIERS[i];
      var dir = turn === 'P1' ? angle : 180 - angle;
      var power = CC.Ballistics.solvePower(shooter.x, shooter.y, foe.x, dir, wind);
      if (power === null) { continue; }
      var c = corridor(shooter.x, shooter.y, dir, power, wind, foe);
      if (c.clear) {
        best = { angle: angle, power: power };
        break;
      }
      var d = dist(c.landing.x, c.landing.y, foe.x, foe.y);
      if (fallback === null || d < fallback.d) {
        fallback = { angle: angle, power: power, d: d };
      }
    }
    if (best) { return best; }
    if (fallback) { return { angle: fallback.angle, power: fallback.power }; }
    return { angle: 45, power: 100 }; // defensive: no reachable tier at all
  }

  /**
   * pickShot(match, difficulty, rng) -> {angle, power, weapon}
   * The AI's answer for the current turn: a pure read of the match (turn
   * side, both cannons, live wind) — the view applies the shot to the
   * cannon and fires. difficulty is 'easy' | 'normal' | 'hell' (anything
   * else throws). rng is a () -> [0,1) source, Math.random in play;
   * injectable so tests pin the errors deterministically. Two draws per
   * call, angle first: angle += (rng()*2-1)*err.angle, power +=
   * (rng()*2-1)*err.power (the pinned injection, uniform over ±err). The
   * weapon is always 普通彈 — special shells are the player's lever, not
   * the AI's. The returned angle is the shared 0..85 elevation (P2's
   * leftward direction is the cannon convention, already solved through).
   */
  function pickShot(match, difficulty, rng) {
    var err = ERRORS[difficulty];
    if (!err) {
      throw new Error('CC.AI.pickShot: difficulty must be "easy", "normal" or "hell", got ' + difficulty);
    }
    rng = rng || Math.random;
    var isP1 = match.turn === 'P1';
    var shooter = isP1 ? match.p1 : match.p2;
    var foe = isP1 ? match.p2 : match.p1;
    var perfect = perfectShot(shooter, foe, match.wind, match.turn);
    return {
      angle: perfect.angle + (rng() * 2 - 1) * err.angle,
      power: perfect.power + (rng() * 2 - 1) * err.power,
      weapon: 'normal'
    };
  }

  CC.AI = { pickShot: pickShot, THINK_DELAY: THINK_DELAY };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.AI;
  }
})(typeof window !== 'undefined' ? window : globalThis);
