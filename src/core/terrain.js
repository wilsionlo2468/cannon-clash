/* CC.Terrain — terrain heightfield and shell/ground collision (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Terrain polyline pinned by the design spec, aligned with the art —
  // tests and downstream tasks depend on these exact values, do not tweak.
  // Screen coordinates: y grows downward. Spans the full 1600px field;
  // heightAt clamps to the end heights outside it.
  var VERTS = [
    { x: 0,    y: 340 },
    { x: 170,  y: 400 },  // left platform (task 4: P1 stands at x=250)
    { x: 430,  y: 400 },
    { x: 560,  y: 560 },
    { x: 760,  y: 860 },
    { x: 860,  y: 880 },  // valley bottom (task 8: crates land x 700..1000)
    { x: 1000, y: 860 },
    { x: 1170, y: 445 },  // right platform (task 4: P2 stands at x=1300)
    { x: 1430, y: 445 },
    { x: 1600, y: 380 }
  ];

  /**
   * heightAt(x) -> number
   * Terrain surface height (screen y) under logical x: piecewise-linear
   * interpolation of the pinned polyline. Flat platform spans return their
   * y exactly; x outside [0, 1600] clamps to the end heights (340 / 380),
   * so the function is total for any shell x.
   */
  function heightAt(x) {
    var last = VERTS.length - 1;
    if (x <= VERTS[0].x) { return VERTS[0].y; }
    if (x >= VERTS[last].x) { return VERTS[last].y; }
    for (var i = 0; i < last; i++) {
      var a = VERTS[i];
      var b = VERTS[i + 1];
      if (x <= b.x) {
        return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
    }
    return VERTS[last].y; // unreachable: the two clamps above cover the ends
  }

  /**
   * hit(x1, y1, x2, y2) -> {x, y}|null
   * Intersection of the straight movement segment (x1,y1)->(x2,y2) with
   * the terrain polyline. A segment can cross several polyline edges (e.g.
   * skimming across the valley V) — returns the FIRST intersection along
   * the movement direction, since the shell buries itself there; null when
   * the segment never crosses. Endpoints lying on the surface count as
   * contact (t and u are inclusive), so a step landing exactly on a vertex
   * still registers.
   */
  function hit(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var bestT = Infinity;
    for (var i = 0; i < VERTS.length - 1; i++) {
      var a = VERTS[i];
      var b = VERTS[i + 1];
      var ex = b.x - a.x;
      var ey = b.y - a.y;
      var denom = dx * ey - dy * ex;
      if (denom === 0) { continue; } // parallel: no single crossing point
      var rx = a.x - x1;
      var ry = a.y - y1;
      var t = (rx * ey - ry * ex) / denom; // along the moving segment
      var u = (rx * dy - ry * dx) / denom; // along the terrain edge
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t;
      }
    }
    if (bestT === Infinity) { return null; }
    return { x: x1 + dx * bestT, y: y1 + dy * bestT };
  }

  CC.Terrain = { heightAt: heightAt, hit: hit };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Terrain;
  }
})(typeof window !== 'undefined' ? window : globalThis);
