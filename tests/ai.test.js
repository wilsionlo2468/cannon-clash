'use strict';

/*
 * Tests for CC.AI (task 6 — three-difficulty cannon AI).
 *
 * Pins, verbatim from the task brief:
 *   CC.AI.pickShot(match, difficulty) -> {angle, power, weapon}
 *   error constants: easy angle±12 power±18, normal ±6/±9, hell ±1.5/±2.5
 *   think delay 1.2s — exposed for the view (task 11 delays pickShot by
 *     it on the AI turn); core builds in no timer, same ruling as the
 *     match's RESOLVE pause
 *   error injection (rand*2-1)*err, rng injectable for determinism
 *   perfect solution: for the 35/45/55° elevation tiers solvePower onto
 *     the enemy's x; keep the first tier whose trajectory stays clear of
 *     terrain until it reaches the enemy — real landings via Terrain.hit,
 *     never the fictitious y=1500 impact (the enemy's terrain usually
 *     occludes it); every tier blocked -> the landing closest to the enemy
 *   statistics over 100 samples: hell stays within its caps and connects
 *     within 15px of the target at most 10% of the time (the AI is no
 *     laser — the player keeps comeback room); easy deviates more than 8°
 *     on at least 60% of samples
 *   the AI fires 普通彈 only
 *
 * The easy "deviation > 8°" pin is measured on the real landing: the
 * angular deviation of the sample's landing from the perfect landing, as
 * seen from the launcher. The input-space reading (|angle - perfect| > 8°)
 * is capped at (12-8)/12 = 33.3% by the pinned uniform ±12 error — pure
 * math, independent of geometry — so the brief's ≥60% is only satisfiable
 * in landing space, where it also discriminates difficulties (hell ~0%,
 * normal ~54%, easy ~75%).
 */

const { test } = require('node:test');
const assert = require('node:assert');
// Same order as index.html: ballistics/terrain feed the corridor checks,
// weapons must precede cannon/match (Cannon.create reads CC.Weapons.LIST).
const B = require('../src/core/ballistics.js');
const T = require('../src/core/terrain.js');
require('../src/core/weapons.js'); // load-order only, no direct use
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');
const AI = require('../src/core/ai.js');

// Literal constants from the brief — deliberately NOT read from the module,
// so these tests stay meaningful even if the implementation renames its own
// copies of the values.
const ERR = {
  easy: { angle: 12, power: 18 },
  normal: { angle: 6, power: 9 },
  hell: { angle: 1.5, power: 2.5 },
};

// Pinned stances (task 4): the real duel geometry the AI solves in.
const STANCE_P1 = { x: 250, y: 400 };
const STANCE_P2 = { x: 1300, y: 445 };

// Fresh cannons + match per case. rng 0.5 rolls wind floor(0.5*11)-5 = 0,
// so the solved powers below are the no-wind references.
const setup = () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');
  const match = M.create({ p1, p2 }, { rng: () => 0.5 });
  return { p1, p2, match };
};

// A minimal cannon-shaped stand-in for synthetic geometries: the match
// layer only requires onHit, and pickShot only reads x/y.
const fakeCannon = (side, x, y) => ({
  side,
  x,
  y,
  onHit() {},
});

// Real landing of a shot: the first Terrain.hit along the integrated path
// after the launch step. The muzzle rests ON its platform surface, so the
// launch segment's t=0 endpoint contact is the cannon standing there, not
// a corridor hit — segment 0 is skipped (the implementation walks the same
// way; this helper exists so the tests check the corridor's premise and
// the statistical landings independently of CC.AI internals).
function realLanding(x0, y0, angleDeg, power, wind) {
  const s = B.simulate(x0, y0, angleDeg, power, wind);
  for (let i = 2; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const h = T.hit(a.x, a.y, b.x, b.y);
    if (h) { return h; }
  }
  return null;
}

// Distance from a landing point to a cannon center: what Weapons.settle
// measures, so "connects" means strictly inside the normal shell's 50px
// blast radius and "within 15px of the target" is the brief's direct hit.
const missDist = (landing, at) =>
  Math.hypot(landing.x - at.x, landing.y - at.y);

// Deterministic rng for the 100-sample statistical pins (one stream across
// all calls — pickShot consumes two draws per shot, angle then power).
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Zero-error rng: (0.5*2-1) = 0 — isolates the perfect solution.
const NO_ERROR = () => 0.5;

test('pins the 1.2s think delay for the view to consume', () => {
  assert.strictEqual(AI.THINK_DELAY, 1.2);
});

test('injects (rng*2-1)*err: angle drawn first, constants exact per difficulty', () => {
  const { match } = setup();
  const p55 = B.solvePower(STANCE_P1.x, STANCE_P1.y, STANCE_P2.x, 55, 0);

  // seq(1, 0): first draw 1 -> angle +err, second draw 0 -> power -err.
  // Pins the draw order and the (rand*2-1) mapping on both sides at once.
  let i = 0;
  const seq = () => [1, 0][i++];
  let shot = AI.pickShot(match, 'easy', seq);
  assert.strictEqual(shot.angle, 55 + ERR.easy.angle,
    'first draw feeds the angle error');
  assert.strictEqual(shot.power, p55 - ERR.easy.power,
    'second draw feeds the power error');
  assert.strictEqual(shot.weapon, 'normal', 'the AI fires 普通彈 only');

  // rng pinned just under 1: the deviation approaches but never exceeds
  // each difficulty's cap — the six pinned constants, exact.
  const near1 = () => 0.9999;
  shot = AI.pickShot(match, 'easy', near1);
  assert.ok(Math.abs(shot.angle - 55 - (0.9999 * 2 - 1) * ERR.easy.angle) < 1e-9);
  assert.ok(Math.abs(shot.power - p55 - (0.9999 * 2 - 1) * ERR.easy.power) < 1e-9);
  shot = AI.pickShot(match, 'normal', near1);
  assert.ok(Math.abs(shot.angle - 55 - (0.9999 * 2 - 1) * ERR.normal.angle) < 1e-9);
  assert.ok(Math.abs(shot.power - p55 - (0.9999 * 2 - 1) * ERR.normal.power) < 1e-9);
  shot = AI.pickShot(match, 'hell', near1);
  assert.ok(Math.abs(shot.angle - 55 - (0.9999 * 2 - 1) * ERR.hell.angle) < 1e-9);
  assert.ok(Math.abs(shot.power - p55 - (0.9999 * 2 - 1) * ERR.hell.power) < 1e-9);

  // rng near 0: the negative side of the span.
  shot = AI.pickShot(match, 'easy', () => 0.0001);
  assert.ok(Math.abs(shot.angle - 55 - (0.0001 * 2 - 1) * ERR.easy.angle) < 1e-9);
});

test('perfect solution on the pinned field: every tier is terrain-blocked, the closest landing wins (55°)', () => {
  const { p1, p2, match } = setup();

  // Premise (task-2 memo: the y=1500 impact is fictitious — the enemy's
  // terrain occludes it): each tier's solvePower shot buries into the
  // valley wall ~250-400px short of P2, and 55° lands closest.
  const burial = [35, 45, 55].map((ang) => {
    const power = B.solvePower(p1.x, p1.y, p2.x, ang, match.wind);
    const landing = realLanding(p1.x, p1.y, ang, power, match.wind);
    return missDist(landing, p2);
  });
  for (const d of burial) {
    assert.ok(d >= 50, 'every tier is blocked on the pinned field: ' +
      burial.map((v) => v.toFixed(0)).join('/'));
  }
  assert.ok(burial[2] < burial[1] && burial[1] < burial[0],
    '55° lands strictly closest: ' + burial.map((v) => v.toFixed(0)).join('/'));

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 55, 'the fallback takes the closest tier');
  assert.ok(Math.abs(shot.power - B.solvePower(p1.x, p1.y, p2.x, 55, match.wind)) < 1e-9,
    'the tier power is the solvePower result');
  assert.strictEqual(shot.weapon, 'normal');
});

test('perfect solution prefers a tier whose landing connects (point-blank corridor)', () => {
  // Synthetic geometry: an enemy 50px away on the same platform. The
  // point-blank solvePower shots barely leave the ground and bury within
  // the normal shell's blast radius of the enemy — the corridor's
  // "命中敌方附近" ending — so the first tier (35°) is taken instead of
  // any fallback. (Across the pinned field's valley no tier ever clears;
  // this case proves the clear branch is live, not just the fallback.)
  const p1 = C.create('P1');
  const foe = fakeCannon('P2', 300, 400);
  const match = M.create({ p1, p2: foe }, { rng: () => 0.5 });

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 35, 'the first clear tier wins');
  assert.ok(Math.abs(shot.power - B.solvePower(p1.x, p1.y, 300, 35, 0)) < 1e-9);
  const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, 0);
  assert.ok(missDist(landing, foe) < 50,
    'the shot\'s real landing connects: ' + missDist(landing, foe).toFixed(1) + 'px');
});

test('P2 solves leftward through 180-angle with the same elevation tiers', () => {
  const { p1, p2, match } = setup();
  match.turn = 'P2';

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  // Mirrored premise: every tier buries in the valley's left wall, 125°
  // (= 180 - 55) lands closest — the elevation stays 55, not 125.
  assert.strictEqual(shot.angle, 55, 'the returned angle is the elevation');
  assert.ok(Math.abs(shot.power - B.solvePower(p2.x, p2.y, p1.x, 125, match.wind)) < 1e-9,
    'the solver saw the leftward firing direction');
  const landing = realLanding(p2.x, p2.y, 125, shot.power, match.wind);
  assert.ok(missDist(landing, p1) >= 50, 'still the blocked-field fallback');
});

test('the live wind feeds the solver', () => {
  const { p1, p2, match } = setup();
  match.wind = 3;
  let shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.ok(Math.abs(shot.power - B.solvePower(p1.x, p1.y, p2.x, 55, 3)) < 1e-9,
    'tailwind changes the solved power');
  match.wind = -5;
  shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.ok(Math.abs(shot.power - B.solvePower(p1.x, p1.y, p2.x, 55, -5)) < 1e-9,
    'headwind changes it the other way');
  assert.strictEqual(shot.angle, 55, 'the tier itself is wind-independent');
});

test('hell: 100 samples stay within the pinned caps and connect within 15px at most 10% of the time', () => {
  const { p1, p2, match } = setup();
  const perfect = AI.pickShot(match, 'hell', NO_ERROR);
  const rng = mulberry32(20261101);

  let within15 = 0;
  for (let i = 0; i < 100; i++) {
    const shot = AI.pickShot(match, 'hell', rng);
    assert.ok(Math.abs(shot.angle - perfect.angle) <= 1.5,
      'angle deviation within the hell cap');
    assert.ok(Math.abs(shot.power - perfect.power) <= 2.5,
      'power deviation within the hell cap');
    assert.ok(shot.angle >= 0 && shot.angle <= 85, 'elevation in the view range');
    assert.ok(shot.power >= 0 && shot.power <= 100, 'power in gauge range');
    const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, match.wind);
    if (missDist(landing, p2) <= 15) { within15++; }
  }
  assert.ok(within15 <= 10,
    'the AI is no laser: at most 10% connect within 15px, got ' + within15);
});

test('easy: at least 60% of 100 samples deviate more than 8°', () => {
  // Measure: angular deviation of the sample's real landing from the
  // perfect landing, seen from the launcher (see the file header for why
  // the input-space reading cannot carry the brief's 60%).
  const { p1, p2, match } = setup();
  const perfect = AI.pickShot(match, 'easy', NO_ERROR);
  const perfectLanding = realLanding(p1.x, p1.y, perfect.angle, perfect.power, match.wind);
  const perfectDir = Math.atan2(perfectLanding.y - p1.y, perfectLanding.x - p1.x);
  const rng = mulberry32(20261101);

  let over8 = 0;
  for (let i = 0; i < 100; i++) {
    const shot = AI.pickShot(match, 'easy', rng);
    assert.ok(Math.abs(shot.angle - perfect.angle) <= 12, 'within the easy angle cap');
    assert.ok(Math.abs(shot.power - perfect.power) <= 18, 'within the easy power cap');
    assert.ok(shot.angle >= 0 && shot.angle <= 85, 'elevation in the view range');
    assert.ok(shot.power >= 0 && shot.power <= 100, 'power in gauge range');
    const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, match.wind);
    const dev = Math.abs(Math.atan2(landing.y - p1.y, landing.x - p1.x) - perfectDir) *
      180 / Math.PI;
    if (dev > 8) { over8++; }
  }
  assert.ok(over8 >= 60,
    'easy is sloppy: at least 60% deviate more than 8°, got ' + over8);
});

test('unknown difficulty throws; pickShot mutates nothing', () => {
  const { p1, p2, match } = setup();
  assert.throws(() => AI.pickShot(match, 'lunatic'), /CC\.AI\.pickShot/);
  assert.throws(() => AI.pickShot(match, undefined), /CC\.AI\.pickShot/);

  const before = {
    state: match.state, turn: match.turn, round: match.round,
    wind: match.wind, timer: match.timer, lastShot: match.lastShot,
    p1: { x: p1.x, y: p1.y, hp: p1.hp, angle: p1.angle, power: p1.power,
      weapon: p1.weapon, ammo: { ...p1.ammo } },
    p2: { x: p2.x, y: p2.y, hp: p2.hp, angle: p2.angle, power: p2.power,
      weapon: p2.weapon, ammo: { ...p2.ammo } },
  };
  AI.pickShot(match, 'easy');
  const after = {
    state: match.state, turn: match.turn, round: match.round,
    wind: match.wind, timer: match.timer, lastShot: match.lastShot,
    p1: { x: p1.x, y: p1.y, hp: p1.hp, angle: p1.angle, power: p1.power,
      weapon: p1.weapon, ammo: { ...p1.ammo } },
    p2: { x: p2.x, y: p2.y, hp: p2.hp, angle: p2.angle, power: p2.power,
      weapon: p2.weapon, ammo: { ...p2.ammo } },
  };
  assert.deepStrictEqual(after, before,
    'pickShot is a pure read: the view applies the returned shot');
});
