'use strict';

/*
 * Tests for CC.Ballistics (task 2 — ballistics physics).
 *
 * Pins, verbatim from the task brief:
 *   G = 900, V0 = power * 14 (power 0..100), WIND_K = 6, dt = 1/60
 *   per step: x += vx*dt; y += vy*dt; vy += G*dt; vx += WIND_K*wind*dt
 *   shells stop (and record impact) at y >= 1500; impact is the exact
 *   crossing of that stop line (interpolated on the final step), so impact
 *   x is continuous in power
 *   solvePower binary-searches continuous float power in 0..100 so the
 *   impact lands within 2px of the target x; null only for genuinely
 *   unreachable targets (beyond max range / behind the muzzle)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../src/core/ballistics.js');

// Literal constants from the brief — deliberately NOT read from the module,
// so these tests stay meaningful even if the implementation renames its own
// copies of the values.
const G = 900;
const WIND_K = 6;
const DT = 1 / 60;
const FLOOR_Y = 1500;

/*
 * Reference integrator transcribed straight from the brief's per-step
 * formulas. Screen coordinates: y grows downward, so a positive angle
 * launches upward (vy0 negative) and gravity adds to vy every step.
 * Terminates by construction: vy grows by G*dt each step, so y eventually
 * passes any bound.
 */
function reference(x0, y0, angleDeg, power, wind) {
  const rad = angleDeg * Math.PI / 180;
  const v0 = power * 14;
  let x = x0;
  let y = y0;
  let vx = v0 * Math.cos(rad);
  let vy = -v0 * Math.sin(rad);
  const points = [{ x: x, y: y }];
  let impact = null;
  for (;;) {
    const px = x;
    const py = y;
    x += vx * DT;
    y += vy * DT;
    vy += G * DT;
    vx += WIND_K * wind * DT;
    points.push({ x: x, y: y });
    if (y >= FLOOR_Y) {
      // Impact is the exact crossing of the stop line, interpolated on the
      // final step, so impact x varies continuously with power.
      const span = y - py;
      let f = span > 0 ? (FLOOR_Y - py) / span : 0;
      if (f < 0) { f = 0; } // launched at/below the line: impact at launch
      impact = { x: px + (x - px) * f, y: py + (y - py) * f };
      break;
    }
  }
  return { points: points, impact: impact };
}

function approx(actual, expected, eps, label) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    label + ': |' + actual + ' - ' + expected + '| >= ' + eps
  );
}

test('simulate follows the pinned per-step integration', () => {
  const cases = [
    { x0: 200, y0: 400, angle: 45, power: 50, wind: 3 },
    { x0: 1200, y0: 700, angle: 130, power: 80, wind: -2 },
  ];
  for (const c of cases) {
    const got = B.simulate(c.x0, c.y0, c.angle, c.power, c.wind);
    const want = reference(c.x0, c.y0, c.angle, c.power, c.wind);
    assert.strictEqual(got.points.length, want.points.length,
      'same number of integration steps');
    for (let i = 0; i < want.points.length; i++) {
      approx(got.points[i].x, want.points[i].x, 1e-9, 'point ' + i + ' x');
      approx(got.points[i].y, want.points[i].y, 1e-9, 'point ' + i + ' y');
    }
    assert.ok(got.impact, 'impact recorded at y >= ' + FLOOR_Y);
    approx(got.impact.y, FLOOR_Y, 1e-6, 'impact sits on the stop line');
    const last = got.points.length - 1;
    const ax = got.points[last - 1].x;
    const bx = got.points[last].x;
    assert.ok(got.impact.x >= Math.min(ax, bx) - 1e-9 &&
              got.impact.x <= Math.max(ax, bx) + 1e-9,
      'impact lies on the final trajectory segment');
  }
});

test('no wind, 45 degrees: impacts mirror about the launch point', () => {
  const right = B.simulate(200, 400, 45, 50, 0).impact;
  const left = B.simulate(200, 400, 135, 50, 0).impact;
  assert.ok(right && left, 'both shots record an impact');
  approx(right.x - 200, 200 - left.x, 1e-6, 'mirror symmetry');
});

test('no wind, 45 degrees: same-height range matches v0^2*sin(2*angle)/g', () => {
  // The textbook formula assumes landing at launch height. Launching from
  // the shell stop line (y = 1500) realizes that: the shell lands exactly
  // where it started vertically. sin(2*45deg) = 1, so range = v0^2/g.
  for (const power of [30, 50, 80]) {
    const v0 = power * 14;
    const expected = (v0 * v0) / G;
    const s = B.simulate(300, FLOOR_Y, 45, power, 0);
    approx(s.impact.x - 300, expected, 0.05 * expected,
      'range at power ' + power);
  }

  // The trajectory is symmetric about its apex: apex x sits at half range.
  const s = B.simulate(300, FLOOR_Y, 45, 50, 0);
  let apex = 0;
  for (let i = 1; i < s.points.length; i++) {
    if (s.points[i].y < s.points[apex].y) { apex = i; }
  }
  approx(s.points[apex].x, (300 + s.impact.x) / 2, 15, 'apex x at half range');
});

test('wind +3 carries the impact further downwind than no wind', () => {
  const base = B.simulate(200, 400, 45, 50, 0).impact.x;
  const tail = B.simulate(200, 400, 45, 50, 3).impact.x;
  const head = B.simulate(200, 400, 45, 50, -3).impact.x;
  assert.ok(tail > base, 'tailwind lands further: ' + tail + ' > ' + base);
  assert.ok(tail - base > 20,
    'tailwind gain is substantial, got ' + (tail - base));
  assert.ok(head < base, 'headwind lands shorter: ' + head + ' < ' + base);
});

test('trajectory sampling: starts at launch, climbs, falls, advances in time', () => {
  const pts = B.simulate(200, 400, 45, 50, 0).points;
  assert.deepStrictEqual(pts[0], { x: 200, y: 400 },
    'first point is the launch point');

  // Samples advance in time: for a rightward shot x strictly increases.
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x > pts[i - 1].x, 'x increases at sample ' + i);
  }

  // Climbs then falls: y strictly decreases up to an apex, then increases.
  let apex = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < pts[apex].y) { apex = i; }
  }
  assert.ok(apex > 0 && apex < pts.length - 1,
    'apex strictly inside the flight');
  assert.ok(pts[apex].y < 400, 'shell climbed above the launch height');
  for (let i = 0; i < apex; i++) {
    assert.ok(pts[i + 1].y < pts[i].y, 'climbing at sample ' + i);
  }
  for (let i = apex; i < pts.length - 1; i++) {
    assert.ok(pts[i + 1].y > pts[i].y, 'falling at sample ' + i);
  }
  assert.ok(pts[pts.length - 1].y >= FLOOR_Y, 'flight ends past the stop line');
});

test('solvePower finds a power whose impact lands within 2px of the target', () => {
  const cases = [
    { x0: 200, y0: 400, target: 800, angle: 45, wind: 0 },
    { x0: 200, y0: 400, target: 1000, angle: 45, wind: 3 },
    { x0: 1400, y0: 400, target: 900, angle: 135, wind: 0 },
  ];
  for (const c of cases) {
    const power = B.solvePower(c.x0, c.y0, c.target, c.angle, c.wind);
    assert.ok(power !== null, 'target ' + c.target + ' is solvable');
    assert.ok(power >= 0 && power <= 100, 'power within 0..100');
    const landX = B.simulate(c.x0, c.y0, c.angle, power, c.wind).impact.x;
    approx(landX, c.target, 2, 'lands within 2px at power ' + power);
  }
});

test('solvePower hits every target from 30% to 95% of maximum range', () => {
  const x0 = 200;
  const y0 = 400;
  const angle = 45;
  const wind = 0;
  const maxRange = B.simulate(x0, y0, angle, 100, wind).impact.x - x0;
  const COUNT = 12;
  for (let i = 0; i < COUNT; i++) {
    const frac = 0.30 + (0.95 - 0.30) * (i / (COUNT - 1));
    const target = x0 + maxRange * frac;
    const power = B.solvePower(x0, y0, target, angle, wind);
    assert.ok(power !== null,
      'target ' + target.toFixed(1) + ' (' + (frac * 100).toFixed(1) +
      '% of max range) is solvable');
    assert.ok(power >= 0 && power <= 100, 'power within 0..100');
    const landX = B.simulate(x0, y0, angle, power, wind).impact.x;
    approx(landX, target, 2,
      'lands within 2px at ' + (frac * 100).toFixed(1) + '% of max range');
  }
});

test('solvePower returns null when no power reaches the target', () => {
  // Beyond maximum range: power 100 at 45 degrees lands near x ~ 3200.
  assert.strictEqual(B.solvePower(200, 400, 5000, 45, 0), null);
  // Behind the muzzle: even power 0 drops straight down at x0 = 200.
  assert.strictEqual(B.solvePower(200, 400, 100, 45, 0), null);
});
