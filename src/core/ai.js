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
   * firstLandingX(x0, y0, angleDeg, power, wind) -> number
   * The x of the shot's REAL landing: the first Terrain.hit along the
   * integrated path (segment 0 skipped — the muzzle rests ON its platform
   * surface; see corridor). A trajectory that overflies the whole field
   * (possible past power ~90 on the pinned terrain) never touches the
   * polyline, so the fictitious y=1500 impact stands in — a monotone
   * "lands beyond the field" sentinel for the solver, never a near-target
   * answer.
   */
  function firstLandingX(x0, y0, angleDeg, power, wind) {
    var flight = CC.Ballistics.simulate(x0, y0, angleDeg, power, wind);
    var points = flight.points;
    for (var i = 2; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      var h = CC.Terrain.hit(a.x, a.y, b.x, b.y);
      if (h) { return h.x; }
    }
    return flight.impact.x;
  }

  /**
   * solveTerrainPower(x0, y0, xTarget, angleDeg, wind) -> power|null
   * R14: binary-searches power in [0, 100] so the shot's REAL landing x
   * (firstLandingX — simulate + Terrain.hit per probe) equals xTarget;
   * 40 bisection rounds. The real landing is monotone in the shooting
   * direction but steep (~29px per power point near the solution) with
   * terrain-regime jumps, so every probe is ranked and the power whose
   * landing came closest to xTarget wins (the ruling's best-of-40 rule).
   * Returns null only when the endpoints do not bracket xTarget — the
   * target lies beyond the tier's real-landing reach. Ballistics's own
   * solvePower (y=1500 stop-line impact) is left to the ballistics module;
   * the AI's perfect solution targets real landings only.
   */
  function solveTerrainPower(x0, y0, xTarget, angleDeg, wind) {
    var ITERS = 40;
    var lo = 0;
    var hi = 100;
    var fLo = firstLandingX(x0, y0, angleDeg, lo, wind) - xTarget;
    var fHi = firstLandingX(x0, y0, angleDeg, hi, wind) - xTarget;
    var best = Math.abs(fLo) < Math.abs(fHi)
      ? { power: lo, miss: Math.abs(fLo) }
      : { power: hi, miss: Math.abs(fHi) };
    if ((fLo < 0) === (fHi < 0)) { return null; } // beyond the real reach
    for (var i = 0; i < ITERS; i++) {
      var mid = (lo + hi) / 2;
      var f = firstLandingX(x0, y0, angleDeg, mid, wind) - xTarget;
      var miss = Math.abs(f);
      if (miss < best.miss) { best = { power: mid, miss: miss }; }
      if ((f < 0) === (fLo < 0)) { lo = mid; } else { hi = mid; }
    }
    return best.power;
  }

  /**
   * perfectShot(shooter, foe, wind, turn) -> {angle, power}
   * The brief's perfect solution, per ruling R14: per elevation tier
   * (35/45/55, in order) solve the power whose REAL terrain landing hits
   * the enemy's x (solveTerrainPower above — never the fictitious y=1500
   * impact), then keep the first tier whose corridor stays clear until it
   * reaches the enemy. A tier that cannot reach the enemy x as a real
   * landing (solveTerrainPower null) is skipped, and a tier whose solved
   * landing still misses the near-hit window (terrain-regime jumps can
   * overshoot) falls to the fallback: the blocked tier whose real landing
   * is closest to the enemy center. If every tier were unreachable
   * (impossible for the pinned stances — max range dwarfs their
   * separation) a maximal 45° shot keeps pickShot total for the view.
   */
  function perfectShot(shooter, foe, wind, turn) {
    var best = null;
    var fallback = null;
    for (var i = 0; i < TIERS.length; i++) {
      var angle = TIERS[i];
      var dir = turn === 'P1' ? angle : 180 - angle;
      // Solve from the MUZZLE (Cannon.muzzle) — the same origin the view
      // launches from — so the perfect solution carries no stance-to-
      // muzzle bias. muzzle takes the SHARED elevation (side gives the
      // bore direction); the simulate calls below keep the directional
      // angle. The muzzle depends only on the tier's elevation, fixed
      // across the power bisection.
      var m = CC.Cannon.muzzle(shooter, angle);
      var power = solveTerrainPower(m.x, m.y, foe.x, dir, wind);
      if (power === null) { continue; }
      var c = corridor(m.x, m.y, dir, power, wind, foe);
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
