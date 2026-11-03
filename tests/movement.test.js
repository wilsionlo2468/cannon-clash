'use strict';

/*
 * Tests for in-turn movement (Phase 3): match.move gates walking to the
 * AIM state and the current turn's cannon; Cannon.move spends a per-turn
 * budget (Cannon.MOVE_RANGE, reset by every advance), is capped by the
 * field bounds, and is refused entirely when the span crosses terrain
 * too steep to walk (Terrain.walkable — the valley walls). Movement
 * re-seats the cannon on the surface, so walking down a slope follows it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js');
require('../src/core/ballistics.js');
require('../src/core/weapons.js');
const C = require('../src/core/cannon.js');
const M = require('../src/core/match.js');

const setup = (opts) => {
  T.reset();
  const p1 = C.create('P1');
  const p2 = C.create('P2');
  return { p1, p2, match: M.create({ p1, p2 }, opts) };
};

test('move walks the current cannon within the budget and re-seats it', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.move(100), 100);
  assert.strictEqual(p1.x, 350);
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE - 100, 'budget spent');
  assert.strictEqual(p1.y, 400, 'flat platform: y unchanged');
  // only the turn holder walks: P2 stays put
  assert.strictEqual(match.p2.moveBudget, C.MOVE_RANGE, 'P2 untouched');
});

test('move caps at the budget; the leftover turn cannot walk', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.move(200), C.MOVE_RANGE, 'capped to the budget');
  assert.strictEqual(p1.x, 250 + C.MOVE_RANGE);
  assert.strictEqual(match.move(10), 0, 'no budget left');
  assert.strictEqual(p1.x, 410);
});

test('move refuses a span crossing the valley wall', () => {
  const { p1, match } = setup();
  p1.x = 420; // near the platform edge (430); the wall begins there
  assert.strictEqual(match.move(160), 0, 'the wall refuses the whole span');
  assert.strictEqual(p1.x, 420, 'nothing moved');
  // approaching the edge in small steps works up to the last walkable px
  assert.strictEqual(match.move(5), 5);
  assert.strictEqual(p1.x, 425);
  assert.strictEqual(match.move(3), 3, '425->428 still on the platform');
  assert.strictEqual(match.move(3), 0, '428->431 crosses the wall edge: refused');
});

test('P2 walks leftward under the same rules', () => {
  const { p2, match } = setup();
  match.land((match.fire(), { x: 800, y: 300 })); // P1 fires -> P2's turn
  match.next();
  assert.strictEqual(match.turn, 'P2');
  assert.strictEqual(match.move(-100), -100);
  assert.strictEqual(p2.x, 1200);
  assert.strictEqual(p2.y, 445, 'still on the right platform');
});

test('move follows the terrain down the gentle outer slope', () => {
  const { p1, match } = setup();
  p1.x = 110;
  assert.strictEqual(match.move(-30), -30, '80..110 slope 0.35 is walkable');
  assert.ok(Math.abs(p1.y - T.heightAt(80)) < 1e-9, 'y re-seated on the slope');
});

test('move is AIM-only', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.startCharge(), 'CHARGE');
  assert.strictEqual(match.move(10), null, 'no walking mid-charge');
  match.fire();
  assert.strictEqual(match.move(10), null, 'no walking mid-flight');
  match.land({ x: 800, y: 300 });
  assert.strictEqual(match.move(10), null, 'no walking mid-resolve');
});

test('every advance restores both cannons budgets', () => {
  const { p1, p2, match } = setup();
  match.move(160);
  match.fire();
  match.land({ x: 800, y: 300 });
  match.next();
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE, 'P1 refilled');
  assert.strictEqual(p2.moveBudget, C.MOVE_RANGE, 'P2 refilled');
  // P2 walks, fires; P1's next turn has a fresh budget again
  match.move(-50);
  match.fire();
  match.land({ x: 800, y: 300 });
  match.next();
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE);
});

test('knock does not consume the move budget', () => {
  const { p1, match } = setup();
  p1.knock(1);
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE, 'being shoved is not walking');
  assert.strictEqual(match.move(10), 10, 'the full budget is still available');
});

test('cannon.move works headless (the AI turn simply never calls match.move)', () => {
  const { p1 } = setup();
  assert.strictEqual(p1.move(30), 30, 'the cannon-level API is state-blind');
});

// --- jump (Phase 6): a bound that skips the slope check, spending the
// same per-turn budget ---

test('jump crosses a span walking would refuse, spending the budget 1:1', () => {
  const { p1, match } = setup();
  p1.x = 420; // the wall begins at the platform edge (430)
  assert.strictEqual(match.move(20), 0, 'walking into the wall is refused');
  const landed = match.jump(80);
  assert.strictEqual(landed, 80, 'the hop clears what the walk cannot');
  assert.strictEqual(p1.x, 500);
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE - 80, 'budget spent 1:1');
  assert.strictEqual(p1.y, T.heightAt(500), 're-seated on the landing surface');
});

test('jump caps at JUMP_RANGE and at the remaining budget', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.jump(500), C.JUMP_RANGE, 'one bound is capped');
  assert.strictEqual(p1.moveBudget, C.MOVE_RANGE - C.JUMP_RANGE);
  const left = C.MOVE_RANGE - C.JUMP_RANGE;
  assert.strictEqual(match.jump(left + 40), left, 'budget-capped');
  assert.strictEqual(p1.moveBudget, 0);
  assert.strictEqual(match.jump(10), 0, 'no budget, no jump');
});

test('jump honours the field bounds', () => {
  const { p1, match } = setup();
  p1.x = 90;
  assert.strictEqual(match.jump(-500), C.X_MIN - 90, 'clamped to X_MIN');
  assert.strictEqual(p1.x, C.X_MIN);
});

test('jump escapes a fresh crater the walk refuses', () => {
  const { p1, match } = setup();
  // carve a pit under the cannon (normal shell radius 45): the whole walk
  // across its rim is refused (the span must be walkable end to end), but
  // a hop ignores the rim entirely
  T.carve(p1.x, p1.y + 10, 45);
  p1.sink();
  const inPit = p1.y;
  const dir = p1.x < 800 ? 1 : -1;
  assert.strictEqual(match.move(160 * dir), 0, 'the rim refuses the full walk');
  const jumped = match.jump(60 * dir);
  assert.strictEqual(Math.abs(jumped), 60, 'the hop clears the rim');
  assert.ok(p1.y < inPit - 20, 'landed on much higher ground than the pit floor');
});

test('jump is AIM-only at the match level', () => {
  const { p1, match } = setup();
  assert.strictEqual(match.startCharge(), 'CHARGE');
  assert.strictEqual(match.jump(60), null, 'no hopping mid-charge');
  match.fire();
  assert.strictEqual(match.jump(60), null, 'no hopping mid-flight');
});
