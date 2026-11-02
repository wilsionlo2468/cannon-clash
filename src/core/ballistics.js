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
   * step. The flight ends at the first step reaching y >= IMPACT_Y; impact
   * is the exact crossing of that stop line, interpolated on the final
   * step, so impact x varies continuously with power (solvePower relies on
   * that). impact is null only if MAX_STEPS is ever exhausted.
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
      var px = x;
      var py = y;
      x += vx * DT;
      y += vy * DT;
      vy += G * DT;
      vx += WIND_K * wind * DT;
      points.push({ x: x, y: y });
      if (y >= IMPACT_Y) {
        var span = y - py;
        var f = span > 0 ? (IMPACT_Y - py) / span : 0;
        if (f < 0) { f = 0; } // launched at/below the stop line: impact at launch
        impact = { x: px + (x - px) * f, y: py + (y - py) * f };
        break;
      }
    }
    return { points: points, impact: impact };
  }

  /**
   * solvePower(x0, y0, xTarget, angleDeg, wind) -> power|null
   * Binary-searches continuous float power in [0, 100] for an impact
   * landing within 2px of xTarget, converging the bisection to ~1e-9 px.
   * Impact x is continuous and increasing in power (the crossing is
   * interpolated sub-step), so a sign-based bisection converges for every
   * reachable target, left- and right-facing angles alike. Returns null
   * only for genuinely unreachable targets (beyond max range / behind the
   * muzzle). Power is quantized to integers only at the UI layer, never
   * here.
   */
  function solvePower(x0, y0, xTarget, angleDeg, wind) {
    var LO = 0;
    var HI = 100;
    var TOL = 2;     // px — "lands within 2px of the target"
    var ITERS = 40;  // 100 / 2^40 of the span: converges far below 1px

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
      if ((miss(mid) < 0) === (fLo < 0)) { lo = mid; } else { hi = mid; }
    }
    return (lo + hi) / 2; // continuous impact x: converged onto the target
  }

  // Charge curve: 0→40 at CHARGE_FAST (100/s), then 40→100 at CHARGE_SLOW
  // (40/s) — quick to small powers, precise near the top. At 100 the
  // charge falls back down the same curve and the cycle repeats, so any
  // power is reachable ("power can only grow" is gone). The up-leg is
  // 0.4 + 1.5 = 1.9s, the full period 3.8s. chargePower(t) is the exact
  // value t seconds after the charge began: the view feeds it the precise
  // key-held duration instead of accumulating per-frame, so the released
  // power carries no frame-quantization error.
  var CHARGE_FAST = 100; // power/s below the knee
  var CHARGE_SLOW = 40;  // power/s above the knee
  var CHARGE_KNEE = 40;
  var CHARGE_T1 = CHARGE_KNEE / CHARGE_FAST;                      // 0.4s
  var CHARGE_T2 = CHARGE_T1 + (100 - CHARGE_KNEE) / CHARGE_SLOW;  // 1.9s
  var CHARGE_PERIOD = 2 * CHARGE_T2;                              // 3.8s

  function chargePower(t) {
    if (!(t > 0)) { return 0; }
    var ph = t % CHARGE_PERIOD;
    if (ph > CHARGE_T2) { ph = CHARGE_PERIOD - ph; } // descending leg mirrors the up-leg
    var p = ph <= CHARGE_T1
      ? ph * CHARGE_FAST
      : CHARGE_KNEE + (ph - CHARGE_T1) * CHARGE_SLOW;
    return Math.min(100, p);
  }

  /**
   * lob(x0, y0, vx0, vy0, wind) -> {points, impact}
   * Integrates a launch by RAW VELOCITY (not angle/power) — cluster
   * bomblets bursting out of the parent impact. Same integration as
   * simulate, but the flight ends at the FIRST REAL terrain contact
   * (Terrain.hit per step, read lazily so module load order is free);
   * the contact point is the exact impact and replaces the last sample.
   * points[0] is the launch point. The FIRST movement segment is not
   * checked — the bomblet launches from a point ON the surface and that
   * segment only carries it clear of the ground (the same skip-segment-0
   * convention the AI's corridor uses for a muzzle resting on its
   * platform). Used by Weapons.explosions for the children's landings
   * AND by the view to replay the same paths.
   */
  function lob(x0, y0, vx0, vy0, wind) {
    var x = x0;
    var y = y0;
    var vx = vx0;
    var vy = vy0;
    var points = [{ x: x, y: y }];
    var impact = null;
    for (var i = 0; i < MAX_STEPS; i++) {
      var px = x;
      var py = y;
      x += vx * DT;
      y += vy * DT;
      vy += G * DT;
      vx += WIND_K * wind * DT;
      if (i > 0) { // segment 0: the launch step off the surface
        var h = CC.Terrain.hit(px, py, x, y);
        if (h) {
          points.push(h);
          impact = h;
          break;
        }
      }
      points.push({ x: x, y: y });
      if (y >= IMPACT_Y) { impact = { x: x, y: y }; break; } // defensive
    }
    return { points: points, impact: impact };
  }

  CC.Ballistics = { simulate: simulate, solvePower: solvePower, chargePower: chargePower, lob: lob };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Ballistics;
  }
})(typeof window !== 'undefined' ? window : globalThis);
