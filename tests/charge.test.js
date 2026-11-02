'use strict';

/*
 * Tests for the charge & launch-origin overhaul:
 *   - Ballistics.chargePower(t): the deterministic ping-pong charge curve
 *     (0→40 at 100/s, 40→100 at 40/s, mirror descent, 3.8s period). The
 *     view feeds the exact key-held duration, so release timing is not
 *     quantized to frames and ANY power is reachable.
 *   - Match.startCharge() resets the charging cannon's power to 0 (the
 *     "power can only grow" ratchet: power used to survive across turns).
 *   - Match.fire() records lastPower/lastAngle — the view's previous-shot
 *     gauge marker reads them.
 *   - Sudden-death deciding shots fire at the fixed SUDDEN power 65,
 *     never a stale last-shot value.
 *   - Cannon.muzzle: the shared launch origin (pivot + 130px along the
 *     bore, P1 +x / P2 -x) — the AI solves and the view flies from it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js');
require('../src/core/weapons.js');
const B = require('../src/core/ballistics.js');
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');

const setup = (opts) => {
  T.reset(); // the destructible heightfield is a singleton: pristine per case
  const p1 = C.create('P1');
  const p2 = C.create('P2');
  return { p1, p2, match: M.create({ p1, p2 }, opts) };
};

// --- chargePower: pinned curve values ---------------------------------

test('chargePower rises 0->40 at 100/s', () => {
  assert.strictEqual(B.chargePower(0), 0);
  assert.strictEqual(B.chargePower(0.1), 10);
  assert.strictEqual(B.chargePower(0.4), 40, 'the knee: fast leg ends here');
});

test('chargePower rises 40->100 at 40/s, topping out at 1.9s', () => {
  assert.ok(Math.abs(B.chargePower(0.4 + 0.75) - 70) < 1e-9, '40 + 0.75s*40 = 70');
  assert.strictEqual(B.chargePower(1.9), 100, 'the up-leg apex');
  assert.strictEqual(B.chargePower(1.5), 40 + 1.1 * 40, 'mid slow leg');
});

test('chargePower descends symmetrically after the apex', () => {
  assert.ok(Math.abs(B.chargePower(1.9 + 0.5) - 80) < 1e-9, '0.5s past apex = 100 - 0.5s*40 = 80');
  assert.ok(Math.abs(B.chargePower(1.9 + 1.5) - 40) < 1e-9, 'back through the knee');
  assert.ok(Math.abs(B.chargePower(3.7) - 10) < 1e-9, 'final fast leg');
  assert.strictEqual(B.chargePower(3.8), 0, 'the cycle bottom');
});

test('chargePower cycles: a second period repeats the first', () => {
  for (const t of [0.2, 1.0, 1.9, 2.5, 3.3]) {
    assert.ok(
      Math.abs(B.chargePower(t) - B.chargePower(t + 3.8)) < 1e-9,
      'period 3.8s: f(' + t + ') === f(' + t + ' + 3.8)'
    );
  }
  assert.ok(Math.abs(B.chargePower(1.9 + 3.8) - 100) < 1e-6, 'the apex comes around again (modulo float noise)');
});

test('chargePower is monotone up on the up-leg and never leaves [0,100]', () => {
  let prev = -1;
  for (let t = 0; t <= 1.9; t += 0.01) {
    const p = B.chargePower(t);
    assert.ok(p >= prev, 'rising on the up-leg at t=' + t.toFixed(2));
    assert.ok(p >= 0 && p <= 100);
    prev = p;
  }
});

// --- startCharge resets power (ratchet fix) ----------------------------

test('startCharge resets the charging cannon power to 0', () => {
  const { p1, match } = setup();
  p1.power = 85; // a leftover from a previous shot used to be the baseline
  assert.strictEqual(match.startCharge(), 'CHARGE');
  assert.strictEqual(p1.power, 0, 'every charge begins from zero');
  assert.strictEqual(match.state, 'CHARGE');
});

test('power reset applies to whoever holds the turn', () => {
  const { p2, match } = setup();
  fireAndLand(match); // P1 fires, P2's turn
  p2.power = 60;
  assert.strictEqual(match.startCharge(), 'CHARGE');
  assert.strictEqual(p2.power, 0);
});

// fire + land + next: one full round, handing the turn over.
function fireAndLand(match) {
  match.fire();
  match.land({ x: 800, y: 300 });
  match.next();
}

// --- fire records lastPower / lastAngle --------------------------------

test('fire records lastPower/lastAngle for the previous-shot marker', () => {
  const { p1, p2, match } = setup();
  p1.power = 66;
  p1.angle = 52;
  match.fire();
  assert.strictEqual(p1.lastPower, 66);
  assert.strictEqual(p1.lastAngle, 52);

  // a full round later P2 fires; each cannon records its own shot
  fireAndLand(match);
  assert.strictEqual(match.turn, 'P2');
  p2.power = 31;
  p2.angle = 38;
  match.fire();
  assert.strictEqual(p2.lastPower, 31);
  assert.strictEqual(p2.lastAngle, 38);
});

// --- sudden death fires at the fixed power -----------------------------

test('sudden-death deciding shots fire at the fixed power 65', () => {
  const { p1, p2, match } = setup();
  p1.onHit(100);
  p2.onHit(100); // both dead -> SUDDEN on the next resolve
  match.fire();
  match.land({ x: 800, y: 300 });
  assert.strictEqual(match.next(), 'SUDDEN');
  assert.strictEqual(match.turn, 'P2', 'the turn advanced into sudden death');
  p2.power = 99; // stale value must never leak into the deciding shot
  match.fire();
  assert.strictEqual(p2.power, 65, 'fixed sudden-death power');
  assert.strictEqual(p2.lastPower, 65);
});

// --- muzzle: the shared launch origin ----------------------------------

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('muzzle pushes 130px along the bore (P1 +x, P2 -x)', () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');
  const m1 = C.muzzle(p1, 45);
  const d = C.MUZZLE_LEN / Math.SQRT2;
  assert.ok(close(m1.x, 250 + d) && close(m1.y, 400 - d), 'P1 bore points +x, up');
  const m2 = C.muzzle(p2, 45);
  assert.ok(close(m2.x, 1300 - d) && close(m2.y, 445 - d), 'P2 bore points -x, up');
});

test('muzzle defaults to the cannon live angle and is horizontal at 0', () => {
  const p1 = C.create('P1');
  p1.angle = 30;
  const m = C.muzzle(p1);
  assert.ok(close(m.y, 400 - C.MUZZLE_LEN * 0.5, 1e-6), 'sin 30 = 0.5');
  p1.angle = 0;
  const flat = C.muzzle(p1);
  assert.ok(close(flat.x, 250 + C.MUZZLE_LEN) && close(flat.y, 400));
});
