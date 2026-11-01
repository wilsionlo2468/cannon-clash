'use strict';

/*
 * Tests for CC.Weapons + CC.Cannon (task 4 — shell stats and cannon state).
 *
 * Pins, verbatim from the task brief:
 *   W.LIST — key order is the task-11 "W" rotation order:
 *     normal:  {name:'普通彈', dmg:20, count:Infinity, radius:50}
 *     heavy:   {name:'重錘彈', dmg:45, count:2,        radius:70}
 *     pierce:  {name:'穿甲彈', dmg:15, count:3,        radius:40}
 *     cluster: {name:'集束彈', dmg:12, count:1,        radius:35, children:3}
 *   settlement: explosion point within a cannon center's radius
 *     (dist < radius) -> dmg = dmg * (1 - dist/radius), linear falloff,
 *     rounded (四捨五入)
 *   cluster: after landing, 3 children land and ONLY the children settle
 *     (dmg12/radius35); the main impact is the scatter origin and does
 *     not detonate (brief literal: the settlement clause covers only the
 *     3 children). Scatter offsets per controller ruling R10: child 1
 *     exactly on the impact, children 2/3 at impact ±90/±180px (random
 *     side) — a direct hit always deals its 12
 *   Cannon.create(side) -> {side, x, y, hp:100, angle:45, power:0,
 *     ammo, weapon:'normal'} with spend/onHit/refill; P1 x=250 y=400,
 *     P2 x=1300 y=445 (terrain platform tops, pinned by the task-3 tests)
 *
 * Blast geometry below sits on the flat platform tops (x 170..430 at
 * y=400, x 1170..1430 at y=445) so explosion distances are exact px.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js'); // CC.Terrain: cluster children land on it
const W = require('../src/core/weapons.js');
const C = require('../src/core/cannon.js');

// Literal table from the brief — deliberately NOT read from the module,
// so these tests stay meaningful even if the implementation renames its
// own copy of the values.
const LIST = {
  normal:  { name: '普通彈', dmg: 20, count: Infinity, radius: 50 },
  heavy:   { name: '重錘彈', dmg: 45, count: 2,        radius: 70 },
  pierce:  { name: '穿甲彈', dmg: 15, count: 3,        radius: 40 },
  cluster: { name: '集束彈', dmg: 12, count: 1,        radius: 35, children: 3 },
};

// rng stubs pinning the cluster's random ± sign: one call per child.
const always = (v) => () => v;
const signs = (...vals) => {
  let i = 0;
  return () => vals[i++];
};

test('W.LIST is pinned verbatim; key order is the W-key rotation order', () => {
  assert.deepStrictEqual(Object.keys(W.LIST), ['normal', 'heavy', 'pierce', 'cluster']);
  for (const key of Object.keys(LIST)) {
    assert.deepStrictEqual(W.LIST[key], LIST[key], 'weapon ' + key);
  }
});

test('Cannon.create pins the stance, defaults and ammo stock', () => {
  const p1 = C.create('P1');
  assert.deepStrictEqual(
    { side: p1.side, x: p1.x, y: p1.y, hp: p1.hp, angle: p1.angle, power: p1.power, weapon: p1.weapon },
    { side: 'P1', x: 250, y: 400, hp: 100, angle: 45, power: 0, weapon: 'normal' },
    'P1 stands on the left platform top (heightAt(250) === 400)'
  );
  assert.deepStrictEqual(p1.ammo, { normal: Infinity, heavy: 2, pierce: 3, cluster: 1 },
    'ammo stock copied from the pinned LIST counts');

  const p2 = C.create('P2');
  assert.strictEqual(p2.side, 'P2');
  assert.strictEqual(p2.x, 1300);
  assert.strictEqual(p2.y, 445); // heightAt(1300) === 445, right platform top
  assert.strictEqual(p2.hp, 100);
  assert.strictEqual(p2.angle, 45); // brief pins 45 for both sides: shared elevation...
  assert.strictEqual(p2.power, 0);  // ...per-side fire direction is the caller's concern
  assert.strictEqual(p2.weapon, 'normal');

  for (const m of ['spend', 'onHit', 'refill']) {
    assert.strictEqual(typeof p1[m], 'function', 'P1.' + m);
    assert.strictEqual(typeof p2[m], 'function', 'P2.' + m);
  }
});

test('create rejects sides other than P1/P2', () => {
  assert.throws(() => C.create('P3'), /side must be "P1" or "P2"/);
  assert.throws(() => C.create(), /side must be "P1" or "P2"/);
});

test('each cannon owns an independent ammo copy', () => {
  const a = C.create('P1');
  const b = C.create('P2');
  assert.notStrictEqual(a.ammo, b.ammo, 'ammo objects are not shared');
  assert.notStrictEqual(a.ammo, W.LIST, 'ammo is a copy, not the pinned table');

  a.weapon = 'heavy';
  assert.strictEqual(a.spend(), true);
  assert.strictEqual(a.ammo.heavy, 1);
  assert.strictEqual(b.ammo.heavy, 2, 'the other cannon is untouched');
});

test('spend: normal is infinite; finite shells count down and refuse when empty', () => {
  const c = C.create('P1');

  assert.strictEqual(c.spend(), true, 'normal always fires');
  assert.strictEqual(c.ammo.normal, Infinity, 'infinite stock never counts down');

  c.weapon = 'heavy';
  assert.strictEqual(c.spend(), true);
  assert.strictEqual(c.ammo.heavy, 1);
  assert.strictEqual(c.spend(), true);
  assert.strictEqual(c.ammo.heavy, 0);
  assert.strictEqual(c.spend(), false, 'empty stock refuses to fire');
  assert.strictEqual(c.ammo.heavy, 0, 'and never goes negative');
});

test('spend: an unusable weapon selection refuses without corrupting ammo', () => {
  const c = C.create('P1');
  c.weapon = 'typo';
  assert.strictEqual(c.spend(), false);
  assert.deepStrictEqual(c.ammo, { normal: Infinity, heavy: 2, pierce: 3, cluster: 1 },
    'no phantom ammo entry is created');
});

test('onHit: subtracts damage and clamps HP at zero', () => {
  const c = C.create('P1');
  assert.strictEqual(c.onHit(30), 70, 'returns the remaining HP');
  assert.strictEqual(c.hp, 70);
  assert.strictEqual(c.onHit(100), 0, 'overkill clamps at 0, never negative');
  assert.strictEqual(c.hp, 0);
});

test('refill: tops every special shell back to its pinned count (task-8 pickup)', () => {
  const c = C.create('P1');
  for (const key of ['heavy', 'pierce', 'cluster']) {
    c.weapon = key;
    while (c.spend()) { /* drain the stock */ }
  }
  assert.deepStrictEqual(c.ammo, { normal: Infinity, heavy: 0, pierce: 0, cluster: 0 },
    'all specials drained first');

  c.refill();
  assert.deepStrictEqual(c.ammo, { normal: Infinity, heavy: 2, pierce: 3, cluster: 1 },
    'every special back to its LIST count');
});

test('settle: full damage at the center, linear falloff, rounded', () => {
  const p1 = C.create('P1'); // (250, 400)
  const p2 = C.create('P2'); // (1300, 445)

  // Direct hits at the cannon center: full dmg, no falloff.
  assert.deepStrictEqual(W.settle('normal', { x: 250, y: 400 }, [p1]), [{ cannon: p1, dmg: 20 }]);
  assert.deepStrictEqual(W.settle('heavy', { x: 1300, y: 445 }, [p2]), [{ cannon: p2, dmg: 45 }]);

  // Pinned falloff midpoints, hand-computed on the flat platform tops:
  //   normal  25px of 50  : 20 * (1 - 25/50)  = 10
  //   pierce  10px of 40  : 15 * (1 - 10/40)  = 11.25 -> 11
  //   heavy   35px of 70  : 45 * (1 - 35/70)  = 22.5  -> 23 (四捨五入)
  //   cluster 17.5px of 35: 12 * (1 - 17.5/35) = 6
  assert.deepStrictEqual(W.settle('normal', { x: 275, y: 400 }, [p1]), [{ cannon: p1, dmg: 10 }]);
  assert.deepStrictEqual(W.settle('pierce', { x: 260, y: 400 }, [p1]), [{ cannon: p1, dmg: 11 }]);
  assert.deepStrictEqual(W.settle('heavy', { x: 1335, y: 445 }, [p2]), [{ cannon: p2, dmg: 23 }]);
  assert.deepStrictEqual(W.settle('cluster', { x: 267.5, y: 400 }, [p1]), [{ cannon: p1, dmg: 6 }]);
});

test('settle: blast boundary is strict (< radius)', () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');

  // 49px of 50: inside, but 20 * (1 - 49/50) = 0.4 rounds to 0 damage.
  assert.deepStrictEqual(W.settle('normal', { x: 299, y: 400 }, [p1]), [{ cannon: p1, dmg: 0 }],
    'inside the radius still counts; damage can round to 0');

  // Exactly at the radius: no entry at all.
  assert.deepStrictEqual(W.settle('normal', { x: 300, y: 400 }, [p1]), [], 'normal at 50px of 50');
  assert.deepStrictEqual(W.settle('heavy', { x: 1370, y: 445 }, [p2]), [], 'heavy at 70px of 70');
});

test('settle: only cannons inside the blast are listed (self-damage natural)', () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');

  // Blast near P1: P2 sits ~1050px away, outside every radius.
  const res = W.settle('normal', { x: 275, y: 400 }, [p1, p2]);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].cannon, p1);
  assert.strictEqual(res[0].dmg, 10);

  // A blast on one's own base damages its owner too (the match passes both).
  assert.deepStrictEqual(W.settle('heavy', { x: 250, y: 400 }, [p1, p2]), [{ cannon: p1, dmg: 45 }]);
});

test('explosions: direct shells explode once where they land, rng untouched', () => {
  const impact = { x: 800, y: 300 };
  let rngCalls = 0;
  const rng = () => { rngCalls++; return 0.9; };

  for (const key of ['normal', 'heavy', 'pierce']) {
    assert.deepStrictEqual(W.explosions(key, impact, rng), [{ x: 800, y: 300 }], key);
  }
  assert.strictEqual(rngCalls, 0, 'no hidden randomness for direct shells');
});

test('explosions: cluster is its 3 children only — child 1 lands on the impact (R10)', () => {
  const impact = { x: 250, y: 400 };
  const pts = W.explosions('cluster', impact, always(0.9));

  assert.strictEqual(pts.length, 3, 'exactly 3 explosions: main impact is child 1, not an extra');
  assert.deepStrictEqual(pts[0], impact, 'child 1 lands exactly on the main impact');
  assert.strictEqual(Math.abs(pts[1].x - impact.x), 90, 'child 2 scatters 90px');
  assert.strictEqual(Math.abs(pts[2].x - impact.x), 180, 'child 3 scatters 180px');
  assert.deepStrictEqual(pts, [
    { x: 250, y: 400 }, // offset 0: the impact itself (still on the left platform)
    { x: 340, y: 400 }, // +90
    { x: 430, y: 400 }, // +180 (platform end vertex (430,400))
  ]);

  // rng() < 0.5 flips the scattered children to the negative side.
  const neg = W.explosions('cluster', { x: 350, y: 400 }, always(0.1));
  assert.deepStrictEqual(neg, [
    { x: 350, y: 400 }, // child 1: fixed, no side
    { x: 260, y: 400 }, // -90
    { x: 170, y: 400 }, // -180 (platform start vertex (170,400))
  ]);
});

test('explosions: scattered children land ON the terrain, rng drawn only for them', () => {
  // Mixed sides from the stub [+,-] (child 1 needs no rng). Off the right
  // platform edge the landing y comes from Terrain.heightAt: child 3 drops
  // onto the valley slope at x=1085 (heightAt(1085) === 652.5, pinned by
  // the task-3 tests).
  const impact = { x: 1265, y: 445 };
  const pts = W.explosions('cluster', impact, signs(0.9, 0.1));

  assert.deepStrictEqual(pts.map((p) => p.x), [1265, 1355, 1085], '0 / ±90 / ±180 in child order');
  assert.strictEqual(pts[0].y, 445, 'child 1 sits on the right platform');
  assert.strictEqual(pts[1].y, 445, 'child 2 lands back on the right platform');
  assert.strictEqual(pts[2].y, 652.5, 'child 3 lands on the pinned slope height');
  for (const p of pts) {
    assert.ok(Math.abs(p.y - T.heightAt(p.x)) < 1e-9, 'child lands on the ground at x=' + p.x);
  }

  let calls = 0;
  W.explosions('cluster', impact, () => { calls++; return 0.5; });
  assert.strictEqual(calls, 2, 'rng is drawn once per scattered child, never for child 1');
});

test('cluster direct hit on an enemy stance deals its 12 (R10 guarantees contact)', () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');

  // Perfect aim at P2's base: child 1 lands exactly on it (dist 0 -> 12);
  // children 2/3 scatter 90/180px away, outside radius 35 on either side.
  let total = 0;
  for (const pt of W.explosions('cluster', { x: p2.x, y: p2.y }, always(0.1))) {
    for (const h of W.settle('cluster', pt, [p1, p2])) {
      if (h.cannon === p2) { total += h.dmg; }
      h.cannon.onHit(h.dmg);
    }
  }
  assert.strictEqual(total, 12, 'child 1 connects at the center, scatter stays outside r35');
  assert.strictEqual(p2.hp, 88);
  assert.strictEqual(p1.hp, 100, 'the far cannon is untouched');
});

test('unknown weapon keys throw a clear error', () => {
  assert.throws(() => W.settle('nuke', { x: 0, y: 0 }, []), /unknown weapon/);
  assert.throws(() => W.explosions('nuke', { x: 0, y: 0 }, always(0.5)), /unknown weapon/);
});

test('wiring: a settled blast applied via onHit reduces HP by exactly the settled amount', () => {
  const p1 = C.create('P1');
  const p2 = C.create('P2');

  // The match-layer flow for one landing: every explosion point of the
  // shell settles against both cannons, each hit applies via onHit.
  for (const pt of W.explosions('heavy', { x: 1335, y: 445 }, always(0.9))) {
    for (const h of W.settle('heavy', pt, [p1, p2])) {
      h.cannon.onHit(h.dmg);
    }
  }
  assert.strictEqual(p2.hp, 77, '100 - 23 (heavy at 35px of 70)');
  assert.strictEqual(p1.hp, 100, 'the far cannon is untouched');
});
