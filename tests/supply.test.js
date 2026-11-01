'use strict';

/*
 * Tests for CC.Supply (task 8 — supply crate spawn and pickup).
 *
 * Pins, verbatim from the task brief + design memo:
 *   maybeSpawn(match, rng) -> {x, y}|null — spawns only when ALL of
 *     round >= 3, no crate has appeared this match (at most ONE per
 *     match — not even a second one after a pickup), and the gate draw
 *     rng() < 0.2 (strict) hold; position x = 700 + rng()*300 over the
 *     valley floor [700, 1000], y = Terrain.heightAt(x). rng is drawn
 *     once for the gate and once more for x only when the gate passes;
 *     an ineligible call consumes no randomness at all.
 *   pickup(match, side, points) -> boolean — points are the shot's
 *     explosion points (match.lastShot.explosions, caller-supplied; for
 *     cluster that includes the scattered children). ANY point closer
 *     than 40px to the crate (strict) refills THAT side's cannon
 *     (cannon.refill() — every special back to its LIST count) and
 *     removes the crate.
 *   the crate is a pure trigger volume and never blocks a shell: Supply
 *     ships no collision primitive, nothing for the flight/terrain
 *     layers to consult.
 *
 * Crate state lives on the match object, two fields owned by Supply:
 *   match.crate — the live {x, y} (null once picked up) for the view;
 *   match.crateSpawned — whether a crate has appeared this match.
 * CC.Match.create itself stays unaware of crates (task-5 ledger).
 *
 * Geometry: with the pinned gate/x draws seq(0.1, 0.5) the crate sits
 * at (850, 878) — heightAt(850) = 860 + 20*(90/100), hand-computed from
 * the task-3-pinned terrain VERTS.
 */

const { test } = require('node:test');
const assert = require('node:assert');
// Same order as index.html: supply reads CC.Terrain.heightAt at spawn
// time; weapons/cannon/match back the real refill and match shapes.
const T = require('../src/core/terrain.js');
const W = require('../src/core/weapons.js');
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');
const S = require('../src/core/supply.js');

// Fresh cannons + real match per case; round is set directly because
// maybeSpawn only READS match.round (driving real rounds here would retest
// the match machine, already covered by match.test.js).
const setup = (round) => {
  const p1 = C.create('P1'); // (250, 400)
  const p2 = C.create('P2'); // (1300, 445)
  const match = M.create({ p1, p2 }, { rng: () => 0.5 });
  match.round = round;
  return { p1, p2, match };
};

// Deterministic rng: one pinned draw per call, in order.
const seq = (...vals) => {
  let i = 0;
  return () => vals[i++];
};

// Always returns v, counting draws — pins the "who consumes rng" contract.
const counting = (v) => {
  const rng = () => { rng.draws += 1; return v; };
  rng.draws = 0;
  return rng;
};

// Spawn the crate at the pinned seq(0.1, 0.5) position (850, 878).
const setupWithCrate = () => {
  const s = setup(3);
  s.crate = S.maybeSpawn(s.match, seq(0.1, 0.5));
  return s;
};

// Drain every special shell (weapons.test.js's drain pattern).
const drainSpecials = (c) => {
  for (const key of ['heavy', 'pierce', 'cluster']) {
    c.weapon = key;
    while (c.spend()) { /* drain the stock */ }
  }
};

test('maybeSpawn: all three conditions met → crate on the valley floor', () => {
  const { match } = setup(3);
  const crate = S.maybeSpawn(match, seq(0.1, 0.5));

  assert.deepStrictEqual(crate, { x: 850, y: 878 },
    'gate draw 0.1 passes; x = 700 + 0.5*300; heightAt(850) = 878');
  assert.strictEqual(match.crate, crate, 'the live crate is on the match');
  assert.strictEqual(match.crateSpawned, true, 'the once-per-match record is set');
  assert.strictEqual(crate.y, T.heightAt(crate.x), 'seated on the terrain surface');
});

test('maybeSpawn: x spans [700, 1000] and y always sits on the terrain', () => {
  for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
    const { match } = setup(3);
    const crate = S.maybeSpawn(match, seq(0.1, draw));
    assert.ok(crate.x >= 700 && crate.x <= 1000, 'x in range at draw ' + draw);
    assert.strictEqual(crate.x, 700 + draw * 300, 'x formula pinned at draw ' + draw);
    assert.ok(Math.abs(crate.y - T.heightAt(crate.x)) < 1e-9, 'on the ground at draw ' + draw);
  }
});

test('maybeSpawn: below round 3 never spawns and consumes no rng', () => {
  for (const round of [1, 2]) {
    const { match } = setup(round);
    const rng = counting(0.1); // would pass the gate — must not matter
    assert.strictEqual(S.maybeSpawn(match, rng), null);
    assert.strictEqual(rng.draws, 0, 'an ineligible round draws nothing');
    assert.strictEqual(match.crate, undefined, 'no crate state is created');
    assert.strictEqual(match.crateSpawned, undefined);
  }
});

test('maybeSpawn: chance gate is strict rng() < 0.2', () => {
  const { match } = setup(3);
  const rng = counting(0.2); // exactly 0.2: NOT below the gate
  assert.strictEqual(S.maybeSpawn(match, rng), null, '0.2 itself does not spawn');
  assert.strictEqual(rng.draws, 1, 'a failed gate still spends its one draw');
  assert.strictEqual(match.crate, undefined);

  const again = setup(3);
  assert.deepStrictEqual(S.maybeSpawn(again.match, seq(0.19, 0.5)), { x: 850, y: 878 },
    'just below the gate spawns (the x draw follows a pass)');
});

test('maybeSpawn: at most one crate per match — while live and after pickup', () => {
  const { match } = setupWithCrate();

  const rngLive = counting(0.1);
  assert.strictEqual(S.maybeSpawn(match, rngLive), null, 'a live crate blocks a second roll');
  assert.strictEqual(rngLive.draws, 0, 'the once-record short-circuits before the gate');
  assert.strictEqual(match.crate.x, 850, 'the original crate is untouched');

  assert.strictEqual(S.pickup(match, 'P1', [{ x: 850, y: 878 }]), true);
  match.round = 7; // much later — the other conditions are eligible again
  const rngLater = counting(0.1);
  assert.strictEqual(S.maybeSpawn(match, rngLater), null, 'picked up: still once per match');
  assert.strictEqual(rngLater.draws, 0);
});

test('pickup: an explosion on the crate refills the shooter and removes the crate', () => {
  const { p1, match, crate } = setupWithCrate();
  drainSpecials(p1);

  assert.strictEqual(S.pickup(match, 'P1', [{ x: crate.x, y: crate.y }]), true);
  assert.deepStrictEqual(p1.ammo, { normal: Infinity, heavy: 2, pierce: 3, cluster: 1 },
    'every special back to its LIST count');
  assert.strictEqual(match.crate, null, 'the crate is consumed');
  assert.strictEqual(match.crateSpawned, true, 'the once-per-match record persists');
});

test('pickup: the 40px reach is strict (< 40)', () => {
  const cases = [
    [{ x: 890, y: 878 }, false, 'exactly 40px horizontally'],
    [{ x: 889, y: 878 }, true, '39px horizontally'],
    [{ x: 850, y: 838 }, false, 'exactly 40px vertically'],
    [{ x: 850, y: 839 }, true, '39px vertically'],
  ];
  for (const [pt, expect, label] of cases) {
    const { match, crate } = setupWithCrate();
    assert.strictEqual(S.pickup(match, 'P1', [pt]), expect, label);
    if (expect) {
      assert.strictEqual(match.crate, null, 'crate consumed (' + label + ')');
    } else {
      assert.strictEqual(match.crate, crate, 'the same crate stays live (' + label + ')');
    }
  }
});

test('pickup: only the shooting side is refilled', () => {
  const { p1, p2, match, crate } = setupWithCrate();
  drainSpecials(p1);
  p2.weapon = 'heavy';
  assert.strictEqual(p2.spend(), true); // heavy 2 -> 1

  assert.strictEqual(S.pickup(match, 'P2', [{ x: crate.x, y: crate.y }]), true);
  assert.deepStrictEqual(p2.ammo, { normal: Infinity, heavy: 2, pierce: 3, cluster: 1 },
    'P2 fired the shot: P2 is topped up');
  assert.deepStrictEqual(
    { heavy: p1.ammo.heavy, pierce: p1.ammo.pierce, cluster: p1.ammo.cluster },
    { heavy: 0, pierce: 0, cluster: 0 },
    'P1 stays drained');
});

test('pickup: without a live crate it is a no-op', () => {
  const { p1, match } = setup(3);
  drainSpecials(p1);

  assert.strictEqual(S.pickup(match, 'P1', [{ x: 850, y: 878 }]), false);
  assert.deepStrictEqual(
    { heavy: p1.ammo.heavy, pierce: p1.ammo.pierce, cluster: p1.ammo.cluster },
    { heavy: 0, pierce: 0, cluster: 0 }, 'nothing refilled');
  assert.strictEqual(match.crate, undefined, 'no crate state appears');
});

test('pickup: a blast outside the reach leaves the crate live', () => {
  const { p1, match, crate } = setupWithCrate();
  drainSpecials(p1);

  assert.strictEqual(S.pickup(match, 'P1', [{ x: crate.x + 41, y: crate.y }]), false,
    '41px misses');
  assert.strictEqual(match.crate, crate, 'still live, the same object');
  assert.strictEqual(p1.ammo.heavy, 0, 'no refill on a miss');
});

test('pickup: a scattered cluster child can claim the crate (lastShot.explosions seam)', () => {
  // Real chain shape: the view settles a landing, then hands the shot's
  // explosion points to pickup. Crate at (850, 878).
  const { match, crate } = setupWithCrate();

  // Direct impact 80px short of the crate, on the terrain: cluster child
  // 1 misses (81.6px out), child 2 scatters +90 onto (860, 880) — 10.2px
  // from the crate — and claims it; child 3 (+180) is 100px out.
  const impact = { x: 770, y: T.heightAt(770) }; // (770, 862)
  const points = W.explosions('cluster', impact, seq(0.9, 0.1)); // children +90/+180
  assert.strictEqual(points[1].x, 860, 'child 2 scatters onto the crate');
  assert.strictEqual(S.pickup(match, 'P1', points), true);
  assert.strictEqual(match.crate, null);

  // And a shot whose every explosion point stays outside: impact 41px
  // past the crate, children further out — no pickup.
  const far = setupWithCrate();
  const impact2 = { x: 891, y: T.heightAt(891) };
  assert.strictEqual(S.pickup(far.match, 'P1', W.explosions('cluster', impact2, seq(0.9, 0.1))),
    false, 'all three children outside the 40px reach');
  assert.strictEqual(far.match.crate, far.crate, 'the crate survives the far blast');
});

test('pickup: side must be P1 or P2 (no silent wrong-player refill)', () => {
  const { match, crate } = setupWithCrate();
  assert.throws(() => S.pickup(match, 'P3', [{ x: crate.x, y: crate.y }]),
    /side must be "P1" or "P2"/);
  assert.throws(() => S.pickup(match, undefined, [{ x: crate.x, y: crate.y }]),
    /side must be "P1" or "P2"/);
  assert.strictEqual(match.crate, crate, 'a rejected call leaves the crate live');
});

test('the crate never blocks shells: no collision primitive exists to consult', () => {
  assert.deepStrictEqual(Object.keys(S).sort(), ['maybeSpawn', 'pickup'],
    'Supply is spawn + pickup only — the flight/terrain layers never see crates');
});
