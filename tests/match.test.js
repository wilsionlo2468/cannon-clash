'use strict';

/*
 * Tests for CC.Match (task 5 — match state machine).
 *
 * Pins, verbatim from the task brief + controller rulings:
 *   M.create({p1,p2}, {turnLimitSec:30}) -> state machine
 *     {state:'AIM', turn:'P1', wind, round:1, ...}
 *   flow: AIM --fire()--> FLIGHT --land(impact)--> RESOLVE --next()-->
 *         AIM (side switch, wind re-roll, round+1); even a lethal landing
 *         passes through RESOLVE — the view times the 1.2s pause and
 *         calls next(), core builds in no countdown
 *   turn limit: tick(dt) counts down in AIM/CHARGE (皆然); expiry
 *     auto-fires — mid-charge with the CURRENT charge, from AIM at the
 *     pinned power=50 — and the machine must never deadlock on the
 *     clock (review focus 3, revised: a partial charge is no longer
 *     discarded)
 *   HP zero -> OVER at the resolve's next(); same-landing double zero ->
 *     state:'SUDDEN', never an error/deadlock (review focus 5); sudden
 *     death: "HP 高者勝", equal -> the next shot decides with state
 *     staying SUDDEN until decided — with HP clamped at 0-0 the deciding
 *     shot's per-landing damage is the only live tiebreaker (less damage
 *     taken = higher effective HP)
 *   wind = floor(random*11) - 5 -> integer -5..+5, uniform over the 11
 *     values (controller ruling R12; supersedes the brief's round formula,
 *     whose edge weights were half)
 *   streak: create opts streakKey/streakSide; OVER carries
 *     {winner, rounds, streakDelta}: +1 win / -1 loss for the holder,
 *     null without a streakKey
 *   settlement follows the task-4 chain — Weapons.explosions -> settle ->
 *     cannon.onHit (self-damage natural, nothing re-implemented here);
 *     supply-crate refill is task 8 and absent here
 *
 * Blast geometry sits on the pinned platform tops (P1 250/400, P2
 * 1300/445) so settled damage is exact px math (see weapons.test.js).
 */

const { test } = require('node:test');
const assert = require('node:assert');
// Same order as index.html: weapons must load before cannon/match run
// (Cannon.create reads CC.Weapons.LIST; Match.land reads CC.Weapons lazily).
const T = require('../src/core/terrain.js'); // cluster children land on it
require('../src/core/weapons.js');           // load-order only, no direct use
require('../src/core/ballistics.js');    // cluster bomblets lob through it (weapons reads CC.Ballistics lazily)
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');

// Fresh cannons + match per case: the machine mutates them in place and
// the caller (here: the test) keeps the references.
const setup = (opts) => {
  T.reset(); // the destructible heightfield is a singleton: pristine per case
  const p1 = C.create('P1'); // (250, 400)
  const p2 = C.create('P2'); // (1300, 445)
  return { p1, p2, match: M.create({ p1, p2 }, opts) };
};

// Deterministic rng: one pinned draw per call, in order.
const seq = (...vals) => {
  let i = 0;
  return () => vals[i++];
};

// P1 (turn 1) fires a normal shell landing at (x, y) and closes the turn.
function fireAndLand(match, x, y) {
  match.fire();
  return match.land({ x, y });
}

test('create pins the initial state: AIM / P1 / round 1 / full clock', () => {
  const { p1, p2, match } = setup({ turnLimitSec: 30 });
  assert.deepStrictEqual(
    {
      state: match.state, turn: match.turn, round: match.round,
      timer: match.timer, winner: match.winner, rounds: match.rounds,
      streakDelta: match.streakDelta, lastShot: match.lastShot,
    },
    {
      state: 'AIM', turn: 'P1', round: 1,
      timer: 30, winner: null, rounds: null,
      streakDelta: null, lastShot: null,
    },
  );
  assert.strictEqual(match.p1, p1, 'the caller keeps the cannon references');
  assert.strictEqual(match.p2, p2);
  assert.ok(Number.isInteger(match.wind), 'wind is an integer');
  assert.ok(match.wind >= -5 && match.wind <= 5, 'wind within the pinned -5..+5');
  for (const m of ['fire', 'land', 'next', 'tick', 'startCharge']) {
    assert.strictEqual(typeof match[m], 'function', 'match.' + m);
  }
});

test('create defaults to the 30s turn limit when opts are omitted', () => {
  const { match } = setup();
  assert.strictEqual(match.timer, 30);
});

test('create rejects missing or non-cannon p1/p2', () => {
  assert.throws(() => M.create(), /CC\.Match\.create/);
  assert.throws(() => M.create({}), /CC\.Match\.create/);
  assert.throws(() => M.create({ p1: C.create('P1') }), /CC\.Match\.create/);
  assert.throws(() => M.create({ p1: {}, p2: {} }), /CC\.Match\.create/);
});

test('wind roll is uniform over -5..+5: floor(random*11) - 5 (R12)', () => {
  // Ruling R12 pins the endpoints: rng 0 / 0.5 / 0.999 -> -5 / 0 / 5.
  for (const [draw, expected] of [[0, -5], [0.5, 0], [0.999, 5]]) {
    const { match } = setup({ rng: () => draw });
    assert.strictEqual(match.wind, expected, 'rng ' + draw + ' -> wind ' + expected);
  }
  // Uniformity: one draw inside each of the 11 equal-probability bins
  // covers every value of -5..+5 exactly once. (The superseded round
  // formula tipped the 0.05 edge draw to -4 — its ±5 bins were half as
  // likely as the inner ones, the exact defect R12 removes.)
  const seen = [];
  for (const draw of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
    const { match } = setup({ rng: () => draw });
    seen.push(match.wind);
  }
  assert.deepStrictEqual(seen, [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
});

test('flow: AIM --fire--> FLIGHT --land--> RESOLVE --next--> AIM with side/wind/round advanced', () => {
  const draws = [0.96, 0.04];
  const { p1, p2, match } = setup({ rng: () => draws.shift() });
  assert.strictEqual(match.wind, 5, 'the initial roll consumes rng first');

  assert.strictEqual(match.fire(), 'normal', 'fires the selected weapon');
  assert.strictEqual(match.state, 'FLIGHT');
  assert.strictEqual(p1.ammo.normal, Infinity, 'normal stock never counts down');

  const shot = match.land({ x: 800, y: 300 }); // valley air: in range of neither cannon
  assert.strictEqual(match.state, 'RESOLVE');
  assert.deepStrictEqual(shot.impact, { x: 800, y: 300 });
  assert.deepStrictEqual(shot.explosions, [{ x: 800, y: 300 }], 'direct shells explode once');
  assert.deepStrictEqual(shot.hits, []);
  assert.strictEqual(p1.hp, 100, 'a miss touches nobody');
  assert.strictEqual(p2.hp, 100);

  assert.strictEqual(match.next(), 'AIM');
  assert.strictEqual(match.turn, 'P2', 'side switch');
  assert.strictEqual(match.round, 2, 'round+1 per shot');
  assert.strictEqual(match.wind, -5, 'wind re-rolled (second draw)');
  assert.strictEqual(match.timer, 30, 'fresh clock for the new turn');
});

test('next() keeps alternating sides and counting rounds', () => {
  const { match } = setup();
  fireAndLand(match, 800, 300); match.next(); // P1 -> P2, round 2
  fireAndLand(match, 800, 300); match.next(); // P2 -> P1, round 3
  assert.strictEqual(match.turn, 'P1');
  assert.strictEqual(match.round, 3);
});

test('tick counts the clock down in AIM; expiry auto-fires at power=50 (review focus 3)', () => {
  const { p1, match } = setup({ turnLimitSec: 30 });
  p1.weapon = 'heavy'; // a countable stock proves a real shell was spent
  match.tick(10);
  assert.strictEqual(match.timer, 20);
  assert.strictEqual(match.state, 'AIM', 'still aiming above zero');
  match.tick(15);
  assert.strictEqual(match.timer, 5);
  match.tick(10); // crosses zero inside this tick
  assert.strictEqual(match.timer, 0);
  assert.strictEqual(match.state, 'FLIGHT', 'expired -> auto-fired, no deadlock');
  assert.strictEqual(p1.power, 50, 'auto-fire is pinned to power=50');
  assert.strictEqual(p1.ammo.heavy, 1, 'the auto-fired shell was really spent');
  match.tick(30);
  assert.strictEqual(p1.ammo.heavy, 1, 'further ticks are inert in FLIGHT: fires exactly once');
});

test('charge-phase expiry fires the CURRENT charge, not a pinned 50 (review focus 3, revised)', () => {
  const { p1, match } = setup({ turnLimitSec: 30 });
  assert.strictEqual(match.startCharge(), 'CHARGE');
  p1.power = 73; // the input layer ramps power while the key is held (task 11)
  match.tick(30);
  assert.strictEqual(match.state, 'FLIGHT', 'no deadlock out of CHARGE');
  assert.strictEqual(p1.power, 73, 'expiry mid-charge keeps the charged power — a partial charge is no longer discarded');
  assert.strictEqual(p1.lastPower, 73, 'the fired charge lands in lastPower');
});

test('turnLimitSec 0 disables the clock entirely', () => {
  const { p1, match } = setup({ turnLimitSec: 0 });
  match.tick(999);
  assert.strictEqual(match.state, 'AIM', 'no auto-fire without a limit');
  assert.strictEqual(match.timer, 0);
  assert.strictEqual(p1.power, 0, 'power untouched');
});

test('land settles through explosions -> settle -> onHit; self-damage is natural', () => {
  const { p1, p2, match } = setup();
  p2.onHit(70); // 30 left: survives one normal hit

  match.fire();
  const shot = match.land({ x: p2.x, y: p2.y }); // direct hit on P2's base
  assert.strictEqual(p2.hp, 10, '30 - 20 (normal at dist 0)');
  assert.deepStrictEqual(shot.hits, [{ cannon: p2, dmg: 20 }]);
  assert.strictEqual(shot.hits[0].cannon, p2);
  assert.deepStrictEqual(shot.dmg, { P1: 0, P2: 20 });
  assert.strictEqual(match.state, 'RESOLVE', 'a hit still resolves before the next turn');
  assert.strictEqual(p1.hp, 100, 'the far cannon is untouched');

  match.next(); // P2's turn
  p1.onHit(70); // 30 left
  match.fire();
  match.land({ x: p1.x, y: p1.y }); // P2's shell lands on P1's own base
  assert.strictEqual(p1.hp, 10, 'the blast sits on P1: P1 takes it');
  assert.strictEqual(p2.hp, 10, 'P2 stays untouched at range');
  assert.strictEqual(match.state, 'RESOLVE');
});

test('a lethal landing resolves to OVER with winner/rounds at next()', () => {
  const { p2, match } = setup();
  p2.onHit(80); // 20 left: one normal hit kills
  match.fire();
  match.land({ x: 1300, y: 445 });
  assert.strictEqual(match.state, 'RESOLVE', 'the resolve pause still happens first');
  assert.strictEqual(match.winner, null, 'no winner before next()');
  assert.strictEqual(match.next(), 'OVER');
  assert.strictEqual(match.state, 'OVER');
  assert.strictEqual(match.winner, 'P1');
  assert.strictEqual(match.rounds, 1, 'rounds = the round the deciding shot landed in');
});

test('rounds counts every fired shot, blank ones included', () => {
  const { p2, match } = setup();
  fireAndLand(match, 800, 300); match.next(); // round 1 -> 2
  fireAndLand(match, 800, 300); match.next(); // round 2 -> 3
  p2.onHit(80);
  fireAndLand(match, 1300, 445); match.next(); // the kill, round 3
  assert.strictEqual(match.winner, 'P1');
  assert.strictEqual(match.rounds, 3);
});

test('firing an empty special falls back to 普通彈 so the clock can never deadlock', () => {
  const { p1, p2, match } = setup();
  p1.weapon = 'cluster';
  assert.strictEqual(p1.spend(), true, 'drain the single cluster shell');
  p2.onHit(10); // 90 left
  assert.strictEqual(match.fire(), 'normal', 'empty cluster -> normal');
  assert.strictEqual(match.state, 'FLIGHT', 'the shot happened regardless');
  match.land({ x: p2.x, y: p2.y });
  assert.strictEqual(p2.hp, 70, 'settled as normal (20), not cluster (12)');
});

test('calls outside their state are inert no-ops and corrupt nothing', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.land({ x: 800, y: 300 }), null, 'land before any fire');
  assert.strictEqual(match.next(), null, 'next before any fire');
  assert.strictEqual(match.startCharge(), 'CHARGE');
  assert.strictEqual(match.state, 'CHARGE');
  assert.strictEqual(match.land({ x: 800, y: 300 }), null, 'land in CHARGE');
  assert.strictEqual(match.fire(), 'normal', 'releasing the key fires the charged shot');
  assert.strictEqual(match.state, 'FLIGHT');
  p1.weapon = 'heavy';
  assert.strictEqual(match.fire(), null, 'double fire refused');
  assert.strictEqual(p1.ammo.heavy, 2, 'the refused fire spent nothing');
  assert.strictEqual(match.startCharge(), null, 'no charge mid-flight');
  const frozen = match.timer;
  match.tick(10);
  assert.strictEqual(match.timer, frozen, 'the clock is frozen outside AIM/CHARGE');
});

test('land passes the injected rng to the cluster scatter (one draw per scattered child)', () => {
  const { p2, match } = setup({ rng: seq(0.5, 0.9, 0.1) }); // wind 0; sides +, -
  p2.onHit(88); // 12 left
  const p1 = match.p1;
  p1.weapon = 'cluster';
  assert.strictEqual(match.fire(), 'cluster');
  const shot = match.land({ x: p2.x, y: p2.y });
  assert.strictEqual(shot.explosions[0].x, 1300,
    'child 1 rises and falls back exactly onto the impact (R10)');
  assert.ok(shot.explosions[1].x > 1300, 'sides +: child 2 bursts downrange');
  assert.ok(shot.explosions[2].x < 1300, 'sides -: child 3 bursts uprange');
  // (the bomblets land ON the terrain by construction — Ballistics.lob
  // ends at the first real contact; asserting heightAt here would read
  // the surface AFTER land()'s own carve has already deformed it)
  assert.deepStrictEqual(shot.dmg, { P1: 0, P2: 12 }, 'only child 1 connects');
  assert.strictEqual(p2.hp, 0);
  assert.strictEqual(match.next(), 'OVER', 'the 12 was lethal');
  assert.strictEqual(match.winner, 'P1');
});

test('same-landing double zero enters SUDDEN, never OVER/error/deadlock (review focus 5)', () => {
  const { p1, p2, match } = setup();
  // The pinned geometry cannot zero both cannons with one shell (blast
  // reach < cannon separation), so the branch is driven through the real
  // chain with P2 pre-zeroed: P1's self-damaging shot then zeroes P1 too.
  p2.onHit(100);
  p1.onHit(80); // 20 left: exactly one normal self-hit kills
  match.fire();
  match.land({ x: p1.x, y: p1.y }); // P1 shells its own base: -20
  assert.strictEqual(p1.hp, 0);
  assert.strictEqual(p2.hp, 0);
  assert.strictEqual(match.state, 'RESOLVE');
  assert.strictEqual(match.next(), 'SUDDEN');
  assert.strictEqual(match.state, 'SUDDEN', 'the sudden branch, not OVER');
  assert.strictEqual(match.winner, null, 'nobody is awarded a double zero');
  assert.strictEqual(match.turn, 'P2', 'the deciding shot goes to the other side');
  assert.strictEqual(match.round, 2, 'the deciding shot is a fresh round');
  assert.strictEqual(match.wind >= -5 && match.wind <= 5, true, 'wind re-rolled as usual');
});

test('sudden death: the deciding shot\'s damage breaks the 0-0 tie', () => {
  const { p1, match } = setup();
  const p2 = match.p2;
  p2.onHit(100);
  p1.onHit(80);
  fireAndLand(match, p1.x, p1.y); match.next(); // -> SUDDEN, P2 to fire
  assert.strictEqual(match.fire(), 'normal', 'fire() works from SUDDEN');
  match.land({ x: p1.x, y: p1.y }); // P2's shell lands on P1's base
  assert.strictEqual(match.next(), 'OVER');
  assert.strictEqual(match.winner, 'P2',
    'P1 took the deciding 20, P2 took 0: higher effective HP survives');
  assert.strictEqual(match.state, 'OVER');
});

test('sudden death: a blank deciding shot keeps SUDDEN and passes to the next shot', () => {
  const { p1, match } = setup();
  const p2 = match.p2;
  p2.onHit(100);
  p1.onHit(80);
  fireAndLand(match, p1.x, p1.y); match.next(); // -> SUDDEN, round 2, P2
  fireAndLand(match, 800, 300); // valley air: nobody takes damage
  assert.strictEqual(match.next(), 'SUDDEN');
  assert.strictEqual(match.state, 'SUDDEN', 'stays SUDDEN until decided');
  assert.strictEqual(match.turn, 'P1', 'deciding shots keep alternating');
  assert.strictEqual(match.round, 3);
  assert.strictEqual(match.winner, null);
});

test('streakDelta: holder wins +1, holder loses -1, null without a streakKey', () => {
  // Holder on the winning side.
  {
    const { p2, match } = setup({ streakKey: 'ALICE', streakSide: 'P1' });
    p2.onHit(80);
    fireAndLand(match, 1300, 445); match.next();
    assert.strictEqual(match.winner, 'P1');
    assert.strictEqual(match.streakDelta, 1, 'win');
    assert.strictEqual(match.rounds, 1);
  }
  // Holder on the losing side.
  {
    const { p2, match } = setup({ streakKey: 'ALICE', streakSide: 'P2' });
    p2.onHit(80);
    fireAndLand(match, 1300, 445); match.next();
    assert.strictEqual(match.winner, 'P1');
    assert.strictEqual(match.streakDelta, -1, 'loss');
  }
  // No streak context at all.
  {
    const { p2, match } = setup();
    p2.onHit(80);
    fireAndLand(match, 1300, 445); match.next();
    assert.strictEqual(match.winner, 'P1');
    assert.strictEqual(match.streakDelta, null);
  }
});

test('OVER is terminal: every mutation is an inert no-op', () => {
  const { p2, match } = setup();
  p2.onHit(80);
  fireAndLand(match, 1300, 445); match.next();
  assert.strictEqual(match.state, 'OVER');
  assert.strictEqual(match.fire(), null);
  assert.strictEqual(match.land({ x: 800, y: 300 }), null);
  assert.strictEqual(match.next(), null);
  assert.strictEqual(match.startCharge(), null);
  match.tick(5);
  assert.strictEqual(match.state, 'OVER', 'the result stands untouched');
  assert.strictEqual(match.winner, 'P1');
  assert.strictEqual(match.rounds, 1);
});
