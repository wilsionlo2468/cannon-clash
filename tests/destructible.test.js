'use strict';

/*
 * Tests for the destructible-terrain overhaul:
 *   - Terrain.carve blasts circular craters into the heightfield; the
 *     surface (heightAt/hit) changes accordingly and never digs below
 *     DEPTH_FLOOR.
 *   - Terrain.walkable gates movement by surface slope (valley walls and
 *     fresh crater rims block; platforms and gentle slopes do not).
 *   - Cannon.sink re-seats a cannon on the current surface; knock shoves
 *     it horizontally (clamped to the field) and re-seats.
 *   - Match.land deforms the terrain at every explosion point, sinks both
 *     cannons, shoves heavy-hit cannons away from the burst, and exposes
 *     the cluster bomblet flights as lastShot.lobs.
 *
 * The heightfield is a module singleton that carves mutate: every case
 * below starts from T.reset() so order never matters.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js');
require('../src/core/weapons.js');
const B = require('../src/core/ballistics.js');
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');

const setup = (opts) => {
  T.reset();
  const p1 = C.create('P1');
  const p2 = C.create('P2');
  return { p1, p2, match: M.create({ p1, p2 }, opts) };
};

// P1 fires, the shell lands at (x, y), the resolve hands the turn over.
function fireAndLand(match, x, y) {
  match.fire();
  const last = match.land({ x, y });
  match.next();
  return last;
}

// --- carve --------------------------------------------------------------

test('carve digs a circular crater; the surface dips to the lower arc', () => {
  const { match } = setup();
  T.carve(300, 400, 45); // center on the left platform surface

  // the center column drops by the full radius (clamped by the floor far
  // below), columns at the rim edges barely drop
  const center = T.heightAt(300);
  assert.ok(center > 400 + 40, 'center dug at least 40px deep, got ' + center);
  const nearRim = T.heightAt(335); // 35px of 45: sqrt(45^2-35^2) = 28.3
  assert.ok(Math.abs(nearRim - (400 + 28.28)) < 0.1, 'rim arc follows the circle, got ' + nearRim);
  assert.strictEqual(T.heightAt(250), 400, '50px away: outside the crater, untouched');
  assert.strictEqual(T.heightAt(1300), 445, 'the far platform is untouched');
});

test('carve leaves the surface alone when the blast is fully above ground', () => {
  const { match } = setup();
  const before = T.heightAt(600);
  T.carve(600, 100, 45); // circle bottom at y=145, far above the surface
  assert.strictEqual(T.heightAt(600), before, 'air burst digs nothing');
});

test('carve never digs below DEPTH_FLOOR, however many shells pile in', () => {
  const { match } = setup();
  for (let i = 0; i < 50; i++) {
    T.carve(860, 880, 85); // the valley bottom, heavy shell, 50 times
  }
  assert.ok(T.heightAt(860) <= T.DEPTH_FLOOR, 'floor holds: ' + T.heightAt(860));
  assert.strictEqual(T.heightAt(860), T.DEPTH_FLOOR, 'repeated heavy shelling reaches the floor');
});

test('hit sees the carved surface: a shell lands in the crater, not on the old ground', () => {
  const { match } = setup();
  // pre-carve: a vertical drop at x=300 hits the platform at y=400
  T.carve(300, 400, 45);
  const strike = T.hit(300, 300, 300, 700);
  assert.ok(strike, 'the shell still strikes');
  assert.ok(strike.y > 440, 'inside the crater now, not on the old platform: ' + strike.y);
  assert.ok(Math.abs(strike.y - T.heightAt(300)) < 1e-9, 'strike sits on the carved surface');
});

// --- walkable -----------------------------------------------------------

test('walkable: platforms and gentle outer slopes yes, valley walls no', () => {
  const { match } = setup();
  assert.ok(T.walkable(200, 400), 'the whole left platform');
  assert.ok(T.walkable(1200, 1400), 'the whole right platform');
  assert.ok(T.walkable(60, 170), 'the gentle outer slope (0.35)');
  assert.ok(T.walkable(1440, 1580), 'the gentle right outer slope (0.38)');
  assert.ok(!T.walkable(430, 560), 'the left valley wall (slope 1.23)');
  assert.ok(!T.walkable(1000, 1170), 'the right valley wall (slope 2.44)');
  assert.ok(!T.walkable(560, 760), 'the steep inner left wall (slope 1.5)');
});

test('walkable: a fresh crater rim blocks, its shallow middle does not', () => {
  const { match } = setup();
  T.carve(800, 868, 45); // valley slope blast — the whole bowl floors out
  // walking across the crater's edge crosses the steep rim (the floor
  // jumps to the depth cap within a couple of samples) and is refused,
  // while the flat bowl inside is fine
  assert.ok(!T.walkable(740, 800), 'crossing the rim is refused');
  assert.ok(T.walkable(775, 825), 'the flat bowl inside is walkable');
});

// --- cannon sink / knock ------------------------------------------------

test('sink re-seats the cannon on the current surface', () => {
  const p1 = C.create('P1');
  T.reset();
  T.carve(250, 400, 45); // blow the ground out from under P1
  p1.sink();
  assert.ok(p1.y > 400, 'P1 sank into the crater: ' + p1.y);
  assert.ok(Math.abs(p1.y - T.heightAt(250)) < 1e-9, 'y is exactly the surface');
});

test('knock shoves KNOCKBACK px, clamps to the field, and re-seats', () => {
  T.reset();
  const p1 = C.create('P1');
  p1.knock(1);
  assert.strictEqual(p1.x, 250 + C.KNOCKBACK, 'shoved +30');
  p1.knock(-1);
  assert.strictEqual(p1.x, 250, 'and back');
  p1.x = C.X_MIN + 10;
  p1.knock(-1);
  assert.strictEqual(p1.x, C.X_MIN, 'the field edge clamps');
  p1.x = C.X_MAX - 10;
  p1.knock(1);
  assert.strictEqual(p1.x, C.X_MAX, 'both edges');
});

// --- match.land integration ---------------------------------------------

test('land deforms the terrain and sinks both cannons', () => {
  const { p1, p2, match } = setup();
  const before = T.heightAt(800);
  fireAndLand(match, 800, 868); // normal shell into the valley slope
  assert.ok(T.heightAt(800) > before, 'the landing carved the ground');
  assert.strictEqual(p1.y, T.heightAt(p1.x), 'P1 re-seated');
  assert.strictEqual(p2.y, T.heightAt(p2.x), 'P2 re-seated');
});

test('a heavy hit shoves the struck cannon away from the burst', () => {
  const { p1, p2, match } = setup();
  p1.weapon = 'heavy';
  const x0 = p2.x;
  const last = fireAndLand(match, 1270, 445); // heavy blast 30px LEFT of P2
  assert.ok(last.hits.some((h) => h.cannon === p2), 'P2 was struck');
  assert.ok(p2.x > x0, 'P2 shoved away from the blast');
  assert.strictEqual(p2.x, x0 + C.KNOCKBACK, 'exactly KNOCKBACK px');
});

test('a heavy miss shoves nobody; a normal hit shoves nobody', () => {
  const { p1, p2, match } = setup();
  p1.weapon = 'heavy';
  const x0 = p2.x;
  fireAndLand(match, 800, 300); // nowhere near anyone
  assert.strictEqual(p2.x, x0, 'no knock on a miss');

  // two full rounds later P1 fires a NORMAL shell onto P2: damage, no shove
  fireAndLand(match, 800, 300); // P2's turn
  p1.weapon = 'normal';
  const last = fireAndLand(match, 1320, 445); // P1 again, normal blast near P2
  assert.strictEqual(last.weapon, 'normal');
  assert.ok(p2.hp < 100, 'P2 took normal damage');
  assert.strictEqual(p2.x, x0, 'normal shells do not knock back');
});

test('land exposes the cluster bomblet flights as lastShot.lobs', () => {
  const { p1, match } = setup();
  p1.weapon = 'cluster';
  const last = fireAndLand(match, 800, 868);
  assert.strictEqual(last.lobs.length, 3, 'one flight per bomblet');
  for (const fl of last.lobs) {
    assert.ok(fl.points.length >= 2, 'flight has samples');
    assert.ok(fl.impact, 'flight ends at a landing');
  }
  assert.deepStrictEqual(last.explosions, last.lobs.map((fl) => fl.impact),
    'the explosion points ARE the bomblet landings');
});

test('lob: a raw-velocity launch lands on the terrain under gravity+wind', () => {
  T.reset();
  // flat-platform reference: the full flight time for vy -160 over flat
  // ground is 2*160/900 s, so a 120px/s lob lands 120*t downrange
  const flat = B.lob(250, 400, 120, -160, 0);
  const t = (2 * 160) / 900;
  // the integrator is semi-implicit Euler (velocity lags position by one
  // step), so the discrete flight runs ~2px past the analytic parabola
  assert.ok(Math.abs(flat.impact.x - (250 + 120 * t)) < 2.5,
    'calm-air range matches vx*t within the integrator bias, got ' + flat.impact.x);
  assert.ok(Math.abs(flat.impact.y - 400) < 1e-9, 'lands on the platform surface');

  // tailwind off the valley floor: carried downrange, lands on the surface
  const fl = B.lob(800, 868, 120, -160, 3);
  assert.ok(fl.impact, 'lands');
  assert.ok(fl.impact.x > 800 + 120 * 0.3, 'tailwind carries it downrange');
  assert.ok(Math.abs(fl.impact.y - T.heightAt(fl.impact.x)) < 1e-9, 'lands on the surface');
});
