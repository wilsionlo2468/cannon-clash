/* CC.Ballistics — projectile integration and power solving (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Physics constants pinned by the design spec — tests depend on these
  // exact values, do not tweak in isolation.
  var G = 900;            // gravity in px/s^2 (screen y grows downward)
  var WIND_K = 6;         // wind acceleration, px/s^2 per unit of wind
  var DT = 1 / 60;        // integration timestep in seconds (main loop step)
  var V0_PER_POWER = 14;  // muzzle speed = power * 14, power 0..100
  var IMPACT_Y = 1500;    // shells stop (and land) at y >= this, below the 900px viewport
  var MAX_STEPS = 3600;   // termination guard: 60 simulated seconds, unreachable in play

  /**
   * simulate(x0, y0, angleDeg, power, wind) -> {points, impact}
   * Integrates one shell flight in fixed DT steps:
   *   x += vx*dt; y += vy*dt; vy += G*dt; vx += WIND_K*wind*dt
   * Positive angleDeg launches upward (screen y grows downward); wind > 0
   * pushes toward +x. points[0] is the launch point, then one sample per
   * step; the first position with y >= IMPACT_Y is recorded as impact and
   * ends the flight (impact is null only if MAX_STEPS is ever exhausted).
   */
  function simulate(x0, y0, angleDeg, power, wind) {
    var rad = angleDeg * Math.PI / 180;
    var v0 = power * V0_PER_POWER;
    var x = x0;
    var y = y0;
    var vx = v0 * Math.cos(rad);
    var vy = -v0 * Math.sin(rad);
    var points = [{ x: x, y: y }];
    var impact = null;
    for (var i = 0; i < MAX_STEPS; i++) {
      x += vx * DT;
      y += vy * DT;
      vy += G * DT;
      vx += WIND_K * wind * DT;
      points.push({ x: x, y: y });
      if (y >= IMPACT_Y) {
        impact = { x: x, y: y };
        break;
      }
    }
    return { points: points, impact: impact };
  }

  /**
   * solvePower(x0, y0, xTarget, angleDeg, wind) -> power|null
   * Binary-searches power in [0, 100] for an impact landing within 2px of
   * xTarget. Impact x is monotonic in power (upward jumps included), so a
   * sign-based bisection works for left- and right-facing angles alike.
   * Returns null when the target lies outside the reachable span or inside
   * a discretization gap no power can hit.
   */
  function solvePower(x0, y0, xTarget, angleDeg, wind) {
    var LO = 0;
    var HI = 100;
    var TOL = 2;     // px — "lands within 2px of the target"
    var ITERS = 40;  // 100 / 2^40 is far below any useful resolution

    function miss(power) {
      var land = simulate(x0, y0, angleDeg, power, wind).impact;
      return (land ? land.x : NaN) - xTarget;
    }

    var lo = LO;
    var hi = HI;
    var fLo = miss(lo);
    if (Math.abs(fLo) < TOL) { return lo; }
    var fHi = miss(hi);
    if (Math.abs(fHi) < TOL) { return hi; }
    if ((fLo < 0) === (fHi < 0)) { return null; } // target outside the reachable span
    for (var i = 0; i < ITERS; i++) {
      var mid = (lo + hi) / 2;
      var fMid = miss(mid);
      if (Math.abs(fMid) < TOL) { return mid; }
      if ((fMid < 0) === (fLo < 0)) { lo = mid; } else { hi = mid; }
    }
    return null; // bracketed but no power lands within TOL
  }

  CC.Ballistics = { simulate: simulate, solvePower: solvePower };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Ballistics;
  }
})(typeof window !== 'undefined' ? window : globalThis);
