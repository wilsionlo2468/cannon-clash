'use strict';

/*
 * Tests for CC.Terrain (task 3 — terrain heightfield and collision).
 *
 * Pins, verbatim from the task brief (aligned with the art):
 *   polyline (0,340)-(170,400)-(430,400)-(560,560)-(760,860)-(860,880)
 *            -(1000,860)-(1170,445)-(1430,445)-(1600,380)
 *   heightAt(x) is piecewise-linear interpolation of that polyline
 *   hit(x1,y1,x2,y2) returns the FIRST intersection of the movement
 *   segment with the polyline as {x,y}, null when they never cross
 *
 * Note: the brief's example "heightAt(800)===880" is arithmetically
 * inconsistent with the pinned polyline — the valley-bottom vertex sits at
 * x=860, and linear interpolation on (760,860)-(860,880) gives 868 at
 * x=800. The pinned coordinates win (they are the shared contract with
 * tasks 4 and 8), so the valley is asserted at its vertex (860 -> 880) and
 * the slope is pinned at 800 -> 868.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js');

// Literal polyline from the brief — deliberately NOT read from the module,
// so these tests stay meaningful even if the implementation renames its own
// copy of the values.
const VERTS = [
  [0, 340], [170, 400], [430, 400], [560, 560], [760, 860],
  [860, 880], [1000, 860], [1170, 445], [1430, 445], [1600, 380],
];

function approx(actual, expected, eps, label) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    label + ': |' + actual + ' - ' + expected + '| >= ' + eps
  );
}

test('heightAt reproduces every pinned polyline vertex exactly', () => {
  for (const [x, y] of VERTS) {
    assert.strictEqual(T.heightAt(x), y, 'heightAt(' + x + ')');
  }
});

test('heightAt is flat on both cannon platforms (task 4 stance)', () => {
  // Brief-pinned assertions, plus the exact stance points of task 4:
  // P1 at x=250 stands on the left platform, P2 at x=1300 on the right.
  assert.strictEqual(T.heightAt(300), 400);
  assert.strictEqual(T.heightAt(1300), 445);
  assert.strictEqual(T.heightAt(250), 400);
});

test('heightAt interpolates the slopes linearly', () => {
  // Valley bottom vertex (see header note: brief's 800 -> corrected to the
  // vertex x=860), with the descending slope pinned at 800 -> 868.
  assert.strictEqual(T.heightAt(860), 880);
  assert.strictEqual(T.heightAt(800), 868);
  // Hand-computed midpoints of the other faces:
  // (430,400)-(560,560) at x=495: 400 + 160*65/130 = 480
  assert.strictEqual(T.heightAt(495), 480);
  // (560,560)-(760,860) at x=660: 560 + 300*100/200 = 710
  assert.strictEqual(T.heightAt(660), 710);
  // (1000,860)-(1170,445) at x=1085: 860 - 415*85/170 = 652.5
  assert.strictEqual(T.heightAt(1085), 652.5);
});

test('heightAt clamps outside the 1600px field', () => {
  assert.strictEqual(T.heightAt(-40), 340);
  assert.strictEqual(T.heightAt(1700), 380);
});

test('hit returns the crossing where a segment meets the ground', () => {
  // Brief-pinned: a shell segment crossing the surface returns the point.
  const left = T.hit(300, 300, 300, 500);
  assert.ok(left, 'vertical drop onto the left platform hits');
  approx(left.x, 300, 1e-9, 'left hit x');
  approx(left.y, 400, 1e-9, 'left hit y');

  const right = T.hit(1300, 300, 1300, 500);
  assert.ok(right, 'vertical drop onto the right platform hits');
  approx(right.x, 1300, 1e-9, 'right hit x');
  approx(right.y, 445, 1e-9, 'right hit y');

  // 45-degree diagonal onto the left platform: y=x line crosses y=400 at
  // (400, 400), which lies on the flat edge 170..430.
  const diag = T.hit(200, 200, 500, 500);
  assert.ok(diag, 'diagonal drop onto the left platform hits');
  approx(diag.x, 400, 1e-9, 'diagonal hit x');
  approx(diag.y, 400, 1e-9, 'diagonal hit y');
});

test('hit returns null when the segment never crosses the surface', () => {
  // Stops 5px above the left platform (extension would cross, segment does not).
  assert.strictEqual(T.hit(300, 300, 300, 395), null);
  // Entirely below the left platform.
  assert.strictEqual(T.hit(300, 450, 300, 600), null);
  // Horizontal line at y=50 passes over every edge (all edges have y >= 340).
  assert.strictEqual(T.hit(100, 50, 1500, 50), null);
});

test('hit returns the FIRST crossing when one segment spans several edges', () => {
  // A horizontal skim at y=870 through the valley V crosses the descending
  // arm (760,860)-(860,880) at x=810 and the rising arm (860,880)-(1000,860)
  // at x=930. Movement order decides which one is "first".
  const ltr = T.hit(700, 870, 1100, 870);
  assert.ok(ltr, 'left-to-right valley skim hits');
  approx(ltr.x, 810, 1e-9, 'left-to-right first hit x');
  approx(ltr.y, 870, 1e-9, 'left-to-right first hit y');

  const rtl = T.hit(1100, 870, 700, 870);
  assert.ok(rtl, 'right-to-left valley skim hits');
  approx(rtl.x, 930, 1e-9, 'right-to-left first hit x');
  approx(rtl.y, 870, 1e-9, 'right-to-left first hit y');

  // Boundary: a segment ending exactly on the valley-bottom vertex (860,880)
  // registers the touch (both arms report the same point).
  const apex = T.hit(760, 880, 1000, 880);
  assert.ok(apex, 'segment ending on the vertex touches');
  approx(apex.x, 860, 1e-9, 'apex hit x');
  approx(apex.y, 880, 1e-9, 'apex hit y');
});

test('a flown shell from above P1 lands where hit() says the ground is', () => {
  // Cross-module check of the downstream contract: stepping a real task-2
  // flight segment by segment, the first strike lies on the terrain surface
  // and every earlier sample was still above ground.
  const B = require('../src/core/ballistics.js');
  const pts = B.simulate(250, 390, 45, 50, 0).points;
  let strike = null;
  let strikeIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    strike = T.hit(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (strike) { strikeIdx = i; break; }
  }
  assert.ok(strike, 'the shot strikes the terrain, not just the y=1500 line');
  assert.ok(strike.y < 1500, 'strike happens above the ballistics stop line');
  for (let i = 0; i < strikeIdx; i++) {
    assert.ok(pts[i].y <= T.heightAt(pts[i].x) + 1e-9,
      'sample ' + i + ' still above ground');
  }
  approx(strike.y, T.heightAt(strike.x), 1e-6, 'strike lies on the surface');
});
