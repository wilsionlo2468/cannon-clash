'use strict';

/*
 * Tests for CC.AI (task 6 — three-difficulty cannon AI).
 *
 * Pins, verbatim from the task brief + controller rulings:
 *   CC.AI.pickShot(match, difficulty) -> {angle, power, weapon}
 *   error constants: easy angle±12 power±18, normal ±6/±9, hell ±1.5/±2.5
 *   think delay 1.2s — exposed for the view (task 11 delays pickShot by
 *     it on the AI turn); core builds in no timer, same ruling as the
 *     match's RESOLVE pause
 *   error injection (rand*2-1)*err, rng injectable for determinism
 *   perfect solution (R14): per 35/45/55° tier, solve the power whose
 *     REAL terrain landing (simulate + Terrain.hit walk) hits the enemy's
 *     x — solvePower's fictitious y=1500 impact is no longer the AI's
 *     target; first tier whose trajectory stays clear of terrain wins,
 *     every tier blocked -> the landing closest to the enemy
 *   statistics over 100 samples (seeded rng):
 *     hell stays within its caps and lands within 15px of the enemy on at
 *       least 15% of shots (R14: "prove the AI is a threat". Measured
 *       ~21% over 100k samples on the pinned field — see the task-6
 *       report: R14's ~30% estimate does not hold because the real
 *       landing moves ~28.6px per power point, so hell's ±2.5 power
 *       error alone spreads ±71px)
 *     easy (R13 measure, kept per R14): the angular deviation of the
 *       sample's real landing from the perfect landing, seen from the
 *       launcher, exceeds 8° on at least 25% of shots (measured ~33% —
 *       see the report: the pre-R14 60% threshold counted valley landings
 *       that no longer exist; on the flat platform the direction measure
 *       compresses to <1° for landings up to ~290px away)
 *   the AI fires 普通彈 only
 *   defensive branches are pinned too: all-blocked -> the closest-landing
 *     fallback (strict-less keeps the first tier on the structural field-
 *     corner tie), unreachable foe -> null-skip -> the defensive maximal
 *     shot, and the corridor's enemy-column crossing clear
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
// so the solved landings below are the no-wind references.
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
// a corridor hit — segment 0 is skipped. A trajectory that overflies the
// whole field (possible past power ~90 on the pinned terrain) never
// touches the polyline; the fictitious y=1500 impact stands in — the same
// sentinel convention the implementation's solver and corridor use, and
// always a far-off answer the near-target statistics never count.
function realLanding(x0, y0, angleDeg, power, wind) {
  const s = B.simulate(x0, y0, angleDeg, power, wind);
  for (let i = 2; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const h = T.hit(a.x, a.y, b.x, b.y);
    if (h) { return h; }
  }
  return s.impact;
}

// Distance from a landing point to a cannon center: what Weapons.settle
// measures, so "connects" means strictly inside the normal shell's 50px
// blast radius and "within 15px of the target" is the direct-hit pin.
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
  const perfect = AI.pickShot(match, 'hell', NO_ERROR);

  // seq(1, 0): first draw 1 -> angle +err, second draw 0 -> power -err.
  // Pins the draw order and the (rand*2-1) mapping on both sides at once.
  let i = 0;
  const seq = () => [1, 0][i++];
  let shot = AI.pickShot(match, 'easy', seq);
  assert.strictEqual(shot.angle, perfect.angle + ERR.easy.angle,
    'first draw feeds the angle error');
  assert.strictEqual(shot.power, perfect.power - ERR.easy.power,
    'second draw feeds the power error');
  assert.strictEqual(shot.weapon, 'normal', 'the AI fires 普通彈 only');

  // rng pinned just under 1 / just above 0: the deviation approaches but
  // never exceeds each difficulty's cap — the six pinned constants, exact.
  const near1 = () => 0.9999;
  shot = AI.pickShot(match, 'easy', near1);
  assert.strictEqual(shot.angle, perfect.angle + (0.9999 * 2 - 1) * ERR.easy.angle);
  assert.strictEqual(shot.power, perfect.power + (0.9999 * 2 - 1) * ERR.easy.power);
  shot = AI.pickShot(match, 'normal', near1);
  assert.strictEqual(shot.angle, perfect.angle + (0.9999 * 2 - 1) * ERR.normal.angle);
  assert.strictEqual(shot.power, perfect.power + (0.9999 * 2 - 1) * ERR.normal.power);
  shot = AI.pickShot(match, 'hell', near1);
  assert.strictEqual(shot.angle, perfect.angle + (0.9999 * 2 - 1) * ERR.hell.angle);
  assert.strictEqual(shot.power, perfect.power + (0.9999 * 2 - 1) * ERR.hell.power);
  shot = AI.pickShot(match, 'easy', () => 0.0001);
  assert.strictEqual(shot.angle, perfect.angle + (0.0001 * 2 - 1) * ERR.easy.angle);
});

test('perfect solution (R14): the real terrain landing hits the enemy cannon', () => {
  const { p1, p2, match } = setup();
  const shot = AI.pickShot(match, 'hell', NO_ERROR);

  // Every tier solves onto the enemy x on the pinned field, so the first
  // (35°) tier wins the brief's first-clear preference.
  assert.strictEqual(shot.angle, 35, 'the first clear tier wins');
  const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, match.wind);
  assert.ok(Math.abs(landing.x - p2.x) < 2,
    'the REAL landing hits the enemy x, got ' + landing.x.toFixed(3));
  assert.ok(missDist(landing, p2) < 50,
    'the perfect shot connects: ' + missDist(landing, p2).toFixed(2) + 'px');
  assert.strictEqual(shot.weapon, 'normal');
});

test('perfect solution reads the foe from the match (synthetic point-blank foe)', () => {
  // Synthetic geometry: an enemy 50px away on the same platform. The solve
  // must target THAT cannon's x (300, not the stance P2's 1300) — the
  // shot's real landing lands on the fake foe.
  const p1 = C.create('P1');
  const foe = fakeCannon('P2', 300, 400);
  const match = M.create({ p1, p2: foe }, { rng: () => 0.5 });

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 35, 'the first clear tier wins');
  const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, 0);
  assert.ok(Math.abs(landing.x - 300) < 2,
    'the REAL landing hits the synthetic foe x, got ' + landing.x.toFixed(3));
  assert.ok(missDist(landing, foe) < 50, 'and it connects');
});

test('P2 solves leftward through 180-angle with the same elevation tiers', () => {
  const { p1, p2, match } = setup();
  match.turn = 'P2';

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 35, 'the returned angle is the elevation');
  const landing = realLanding(p2.x, p2.y, 145, shot.power, match.wind);
  assert.ok(Math.abs(landing.x - p1.x) < 2,
    'the solver saw the leftward firing direction: landing x ' +
    landing.x.toFixed(3));
  assert.ok(missDist(landing, p1) < 50, 'and it connects');
});

test('the live wind feeds the terrain-aware solver', () => {
  const { p1, p2, match } = setup();
  const shot0 = AI.pickShot(match, 'hell', NO_ERROR);

  match.wind = 3;
  const shot3 = AI.pickShot(match, 'hell', NO_ERROR);
  let landing = realLanding(p1.x, p1.y, shot3.angle, shot3.power, 3);
  assert.ok(Math.abs(landing.x - p2.x) < 2,
    'the tailwind shot still lands on the enemy: ' + landing.x.toFixed(3));
  assert.notStrictEqual(shot3.power, shot0.power, 'wind changed the solved power');

  match.wind = -5;
  const shotM5 = AI.pickShot(match, 'hell', NO_ERROR);
  landing = realLanding(p1.x, p1.y, shotM5.angle, shotM5.power, -5);
  assert.ok(Math.abs(landing.x - p2.x) < 2,
    'the headwind shot still lands on the enemy: ' + landing.x.toFixed(3));
  assert.notStrictEqual(shotM5.power, shot0.power, 'and the other way too');
  assert.strictEqual(shot3.angle, 35, 'the tier itself stays first-clear');
});

test('hell: 100 samples stay within the pinned caps and land within 15px of the enemy at least 15% of the time', () => {
  // R14 threat pin. Measured ~21% (100k samples, multiple seeds): see the
  // file header and the task-6 report for why R14's ~30% estimate does
  // not hold on the pinned field.
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
  assert.ok(within15 >= 15,
    'the AI is a threat: at least 15% connect within 15px, got ' + within15);
});

test('easy: at least 25% of 100 samples deviate more than 8°', () => {
  // Measure (R13, kept per R14): angular deviation of the sample's real
  // landing from the perfect landing, seen from the launcher. Measured
  // ~33% on the R14 field (100k samples, multiple seeds); the pre-R14
  // 60% threshold counted valley landings that no longer exist — see the
  // task-6 report.
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
  assert.ok(over8 >= 25,
    'easy is sloppy: at least 25% deviate more than 8°, got ' + over8);
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

test('all tiers blocked -> the closest-landing fallback wins deterministically', () => {
  // Synthetic geometry: a foe just past the field's right end (x=1680;
  // heightAt clamps to 380 there). Every tier's best real landing is the
  // field corner (1600,380) — the last polyline point any trajectory can
  // touch — so all three are blocked (80px >= 50) and the fallback takes
  // the closest landing. The three probes converge on the corner to within
  // float noise of each other, and the numerically closest wins: 45° under
  // the pinned solver, deterministically. (A coarser three-way race is
  // unreachable on the real terrain: in-field foes solve exactly for every
  // tier, so blocked tiers can only ever meet at the corner.)
  const p1 = C.create('P1');
  const foe = fakeCannon('P2', 1680, 380);
  const match = M.create({ p1, p2: foe }, { rng: () => 0.5 });

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 45, 'the closest-landing tier wins the fallback');
  assert.strictEqual(shot.weapon, 'normal');
  const landing = realLanding(p1.x, p1.y, shot.angle, shot.power, 0);
  assert.ok(Math.abs(landing.x - 1600) < 0.5 && Math.abs(landing.y - 380) < 0.5,
    'the best real landing is the field corner: ' +
    landing.x.toFixed(2) + ',' + landing.y.toFixed(2));
  assert.ok(missDist(landing, foe) >= 50,
    'the shot is genuinely blocked: ' + missDist(landing, foe).toFixed(1) + 'px');
  assert.deepStrictEqual(AI.pickShot(match, 'hell', NO_ERROR), shot,
    'the fallback is deterministic');
});

test('unreachable foe -> every tier skips -> the defensive maximal shot', () => {
  // Synthetic geometry: a foe BEHIND the shooter. No tier brackets the
  // target (every real landing is past it), so the terrain solver returns
  // null three times — the null-skip — and pickShot falls through to its
  // defensive total shot: the view can never receive null.
  const p1 = C.create('P1');
  const foe = fakeCannon('P2', 200, 400);
  const match = M.create({ p1, p2: foe }, { rng: () => 0.5 });

  assert.deepStrictEqual(AI.pickShot(match, 'hell', NO_ERROR),
    { angle: 45, power: 100, weapon: 'normal' });
});

test('foe reachable only past the field -> the corridor clears at the enemy-column crossing', () => {
  // Synthetic geometry: a foe at x=2500, far past the field. No real
  // landing goes past the corner (1600,380), so the tier's best probe is
  // an overflying trajectory whose fictitious y=1500 crossing lands
  // nearest the foe (the overfly sentinel). That flight never touches the
  // polyline, so the corridor's verdict is the enemy-column crossing: the
  // shell flies over the foe and counts as clear — the first tier wins
  // through this branch alone.
  const p1 = C.create('P1');
  const foe = fakeCannon('P2', 2500, 445);
  const match = M.create({ p1, p2: foe }, { rng: () => 0.5 });

  const shot = AI.pickShot(match, 'hell', NO_ERROR);
  assert.strictEqual(shot.angle, 35, 'the first tier clears via the crossing');
  const flight = B.simulate(p1.x, p1.y, shot.angle, shot.power, 0);
  let contact = null;
  for (let i = 2; i < flight.points.length && !contact; i++) {
    const a = flight.points[i - 1];
    const b = flight.points[i];
    contact = T.hit(a.x, a.y, b.x, b.y);
  }
  assert.strictEqual(contact, null, 'pure overfly: no terrain contact at all');
  assert.ok(flight.impact.x > 2500,
    'the shell crossed the enemy column in the air: fictitious x ' +
    flight.impact.x.toFixed(1));
});
