/* CC.Terrain — DESTRUCTIBLE terrain heightfield: sampling, shell/ground
 * collision, blast carving, walkability (browser global + Node module.exports).
 */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // The design-spec polyline the art was drawn against. It is no longer
  // the runtime shape — it seeds the heightfield below — but tests and
  // downstream tasks still reference these exact values, do not tweak.
  // Screen coordinates: y grows downward. Spans the full 1600px field.
  var VERTS = [
    { x: 0,    y: 340 },
    { x: 170,  y: 400 },  // left platform (task 4: P1 stands at x=250)
    { x: 430, y: 400 },
    { x: 560,  y: 560 },
    { x: 760,  y: 860 },
    { x: 860,  y: 880 },  // valley bottom (task 8: crates land x 700..1000)
    { x: 1000, y: 860 },
    { x: 1170, y: 445 },  // right platform (task 4: P2 stands at x=1300)
    { x: 1430, y: 445 },
    { x: 1600, y: 380 }
  ];

  // Heightfield resolution: the surface is sampled every STEP_PX px of x
  // (SAMPLES values, x = i * STEP_PX). Every original vertex sits on a
  // sample boundary (all vertex x are multiples of 10), so the sampled
  // heightfield reproduces the pinned polyline EXACTLY — heightAt/hit
  // return the same values they did when the polyline was the runtime
  // shape, and the pinned tests hold verbatim.
  var STEP_PX = 5;
  var SAMPLES = 1600 / STEP_PX + 1; // 321

  // Blasts can never dig below this line — it keeps the battlefield's
  // floor inside the 900px canvas no matter how many shells land in the
  // same spot (the valley bottom starts at 880).
  var DEPTH_FLOOR = 890;

  // Walking slope cap: a surface step steeper than WALK_MAX_RISE px per
  // STEP_PX sample (slope > 1.2) blocks movement — the valley walls
  // (slopes 1.23 and 2.44) are unclimbable, the gentle outer slopes
  // (0.35/0.38) and both platforms are not, and a fresh crater's steep
  // rim is not while its shallow middle is.
  var WALK_MAX_RISE = 6;

  // The heightfield. H[i] is the surface y at x = i*STEP_PX; heightAt
  // interpolates linearly between samples. Initialized from the pinned
  // polyline (piecewise-linear over VERTS — the original runtime shape).
  var H = (function () {
    var h = new Array(SAMPLES);
    for (var i = 0; i < SAMPLES; i++) {
      var x = i * STEP_PX;
      var last = VERTS.length - 1;
      if (x <= VERTS[0].x) { h[i] = VERTS[0].y; }
      else if (x >= VERTS[last].x) { h[i] = VERTS[last].y; }
      else {
        for (var v = 0; v < last; v++) {
          var a = VERTS[v];
          var b = VERTS[v + 1];
          if (x <= b.x) {
            h[i] = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
            break;
          }
        }
      }
    }
    return h;
  })();

  /**
   * heightAt(x) -> number
   * Terrain surface height (screen y) under logical x: linear
   * interpolation of the (mutable, carve-deformed) heightfield. x outside
   * [0, 1600] clamps to the end heights (340 / 380), so the function is
   * total for any shell x.
   */
  function heightAt(x) {
    var fx = x / STEP_PX;
    var i = Math.floor(fx);
    if (i < 0) { return H[0]; }
    if (i >= SAMPLES - 1) { return H[SAMPLES - 1]; }
    var f = fx - i;
    return H[i] + (H[i + 1] - H[i]) * f;
  }

  /**
   * hit(x1, y1, x2, y2) -> {x, y}|null
   * Intersection of the straight movement segment (x1,y1)->(x2,y2) with
   * the terrain surface: the FIRST crossing along the movement direction
   * (the shell buries itself there), null when they never cross.
   * Equivalent to the original polyline test — the surface is the same
   * piecewise-linear function, intersected per 5px sample segment. The
   * sample-range scan covers exactly the movement's x-span; endpoints
   * lying on the surface count as contact (t and u are inclusive), so a
   * step landing exactly on a sample boundary still registers.
   */
  function hit(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var minX = Math.min(x1, x2);
    var maxX = Math.max(x1, x2);
    var i0 = Math.max(0, Math.floor(minX / STEP_PX));
    var i1 = Math.min(SAMPLES - 2, Math.floor(maxX / STEP_PX));
    var bestT = Infinity;
    for (var i = i0; i <= i1; i++) {
      var ax = i * STEP_PX;
      var ex = STEP_PX;
      var ey = H[i + 1] - H[i];
      var denom = dx * ey - dy * ex;
      if (denom === 0) { continue; } // parallel: no single crossing point
      var rx = ax - x1;
      var ry = H[i] - y1;
      var t = (rx * ey - ry * ex) / denom; // along the moving segment
      var u = (rx * dy - ry * dx) / denom; // along the surface segment
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t;
      }
    }
    if (bestT === Infinity) { return null; }
    return { x: x1 + dx * bestT, y: y1 + dy * bestT };
  }

  /**
   * carve(cx, cy, r) — blast a circular crater of radius r centered at
   * (cx, cy) into the heightfield: every sample column within r of cx
   * drops to the circle's lower arc where that is deeper than the current
   * surface (a blast fully above the surface leaves it untouched; one
   * detonating inside a slope still digs — the shell buried itself).
   * Never digs below DEPTH_FLOOR.
   */
  function carve(cx, cy, r) {
    var i0 = Math.max(0, Math.floor((cx - r) / STEP_PX));
    var i1 = Math.min(SAMPLES - 1, Math.ceil((cx + r) / STEP_PX));
    for (var i = i0; i <= i1; i++) {
      var dx = i * STEP_PX - cx;
      var a = r * r - dx * dx;
      if (a <= 0) { continue; }
      var bottom = cy + Math.sqrt(a);
      if (bottom > H[i]) {
        H[i] = bottom < DEPTH_FLOOR ? bottom : DEPTH_FLOOR;
      }
    }
  }

  /**
   * walkable(x1, x2) -> boolean
   * Whether the surface between x1 and x2 is traversable on foot: every
   * 5px step along the span must rise/fall by at most WALK_MAX_RISE.
   * Used by the movement layer — it makes the valley walls and fresh
   * crater rims natural barriers without any hand-placed fences.
   */
  function walkable(x1, x2) {
    var a = Math.min(x1, x2);
    var b = Math.max(x1, x2);
    var i = Math.max(0, Math.floor(a / STEP_PX));
    var i1 = Math.min(SAMPLES - 2, Math.ceil(b / STEP_PX) - 1);
    for (; i <= i1; i++) {
      if (Math.abs(H[i + 1] - H[i]) > WALK_MAX_RISE) { return false; }
    }
    return true;
  }

  /**
   * samples() -> {H, step} — a live view of the heightfield for the
   * RENDER layer only (the view draws the surface from it; core logic
   * must go through heightAt/hit/carve/walkable). H is the actual array:
   * mutations from carve are visible without re-calling samples().
   */
  function samples() {
    return { H: H, step: STEP_PX };
  }

  /**
   * reset() — restore the pristine heightfield. A test fixture (the
   * field is a module singleton and carves must not leak between cases);
   * a fresh page load already starts pristine, so play never calls it.
   */
  var H0 = null; // pristine copy, captured once below
  H0 = H.slice();
  function reset() {
    for (var i = 0; i < SAMPLES; i++) { H[i] = H0[i]; }
  }

  CC.Terrain = {
    heightAt: heightAt,
    hit: hit,
    carve: carve,
    walkable: walkable,
    samples: samples,
    reset: reset,
    STEP_PX: STEP_PX,
    DEPTH_FLOOR: DEPTH_FLOOR
  };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Terrain;
  }
})(typeof window !== 'undefined' ? window : globalThis);
