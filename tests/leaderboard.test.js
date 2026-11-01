'use strict';

/*
 * Tests for CC.Leaderboard (task 7 — local top-8 boards with fallback).
 *
 * Pins, verbatim from the task brief + controller rulings:
 *   storage key 'cc_leaderboards_v1'; boards 'streaks' / 'hell'; top 8
 *   name rules (spec §5): uppercase, strip non A-Z0-9, cap 6 chars; a
 *     name empty after filtering falls back to the caller's defaultName
 *     VERBATIM ('紅方'/'藍方' — not re-filtered; 'TEAM' when none given)
 *   ruling R2: streaks board DESC (more consecutive wins first), hell
 *     board ASC (score = rounds to beat the hell AI, fewer first);
 *     add/top accept an order:'desc'|'asc' override
 *   ties: first-come-first-served — the earlier record ranks higher
 *   storage throwing (disabled localStorage, quota exceeded) → degrade
 *     to the in-memory store; add/top keep working, game does not crash
 *     (review focus item 4 — pinned by the fallback tests below)
 * Every test injects a fake {get, set} storage — real localStorage is
 * never touched.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../src/core/leaderboard.js');

// fake storage: {get, set} over a plain object, standing in for localStorage
function fakeStorage(initial) {
  const bag = Object.assign({}, initial || {});
  return {
    bag,
    get(k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; },
    set(k, v) { bag[k] = String(v); },
  };
}

test('normalizeName: uppercase, strip non A-Z0-9, cap at 6 chars', () => {
  assert.strictEqual(L.normalizeName('ab12'), 'AB12');
  assert.strictEqual(L.normalizeName('a!b@c 12'), 'ABC12');
  assert.strictEqual(L.normalizeName('abcdefgh'), 'ABCDEF');
  assert.strictEqual(L.normalizeName('!!'), 'TEAM'); // all filtered, no caller default
  assert.strictEqual(L.normalizeName(null), 'TEAM');
});

test('normalizeName: empty-after-filter falls back to the caller default verbatim', () => {
  assert.strictEqual(L.normalizeName('', '紅方'), '紅方');
  assert.strictEqual(L.normalizeName('***', '藍方'), '藍方'); // filtered to empty
  assert.strictEqual(L.normalizeName('紅方', '紅方'), '紅方'); // a non A-Z default is stored as-is
});

test('brief literal: add returns the rank of the new record', () => {
  const s = fakeStorage();
  assert.strictEqual(L.add('streaks', { name: 'AB12', score: 3 }, { storage: s }), 1);
  assert.deepStrictEqual(L.top('streaks', 8, { storage: s }), [{ name: 'AB12', score: 3 }]);
});

test('streaks ranks desc (more wins first); equal scores keep first-come-first-served', () => {
  const s = fakeStorage();
  assert.strictEqual(L.add('streaks', { name: 'AAAAAA', score: 3 }, { storage: s }), 1);
  assert.strictEqual(L.add('streaks', { name: 'BBBBBB', score: 5 }, { storage: s }), 1);
  assert.strictEqual(L.add('streaks', { name: 'CCCCCC', score: 5 }, { storage: s }), 2); // tie, arrived later
  assert.strictEqual(L.add('streaks', { name: 'DDDDDD', score: 4 }, { storage: s }), 3);
  assert.deepStrictEqual(
    L.top('streaks', 8, { storage: s }).map(r => r.name),
    ['BBBBBB', 'CCCCCC', 'DDDDDD', 'AAAAAA']
  );
});

test('hell ranks asc (fewer rounds to beat the hell AI first)', () => {
  const s = fakeStorage();
  assert.strictEqual(L.add('hell', { name: 'X1', score: 7 }, { storage: s }), 1);
  assert.strictEqual(L.add('hell', { name: 'X2', score: 4 }, { storage: s }), 1);
  assert.strictEqual(L.add('hell', { name: 'X3', score: 9 }, { storage: s }), 3);
  assert.deepStrictEqual(L.top('hell', 8, { storage: s }).map(r => r.score), [4, 7, 9]);
});

test('add/top accept an order override (R2)', () => {
  const s = fakeStorage();
  L.add('streaks', { name: 'AAAAAA', score: 3 }, { storage: s });
  L.add('streaks', { name: 'BBBBBB', score: 5 }, { storage: s });
  assert.deepStrictEqual(
    L.top('streaks', 8, { order: 'asc', storage: s }).map(r => r.score),
    [3, 5]
  );
  assert.strictEqual(L.add('hell', { name: 'X1', score: 7 }, { storage: s }), 1);
  // desc override: 9 beats 7 even on the asc board; rank follows the requested order
  assert.strictEqual(L.add('hell', { name: 'X2', score: 9 }, { order: 'desc', storage: s }), 1);
  assert.deepStrictEqual(L.top('hell', 8, { storage: s }).map(r => r.score), [7, 9]); // board default on read
});

test('boards hold the top 8 only; worse records return null rank', () => {
  const s = fakeStorage();
  for (let score = 13; score <= 20; score++) { // asc board: each new score is one rank lower
    assert.strictEqual(L.add('hell', { name: 'P' + score, score }, { storage: s }), score - 12);
  }
  assert.strictEqual(L.add('hell', { name: 'WORSE', score: 21 }, { storage: s }), null);
  assert.strictEqual(L.add('hell', { name: 'TIE20', score: 20 }, { storage: s }), null); // boundary tie: earlier record stays
  const board = L.top('hell', 8, { storage: s });
  assert.strictEqual(board.length, 8);
  assert.deepStrictEqual(board.map(r => r.score), [13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(!board.some(r => r.name === 'WORSE' || r.name === 'TIE20'));
});

test('records persist under cc_leaderboards_v1 as {streaks, hell}', () => {
  const s = fakeStorage();
  L.add('streaks', { name: 'AB12', score: 3 }, { storage: s });
  const raw = JSON.parse(s.bag['cc_leaderboards_v1']);
  assert.deepStrictEqual(Object.keys(raw).sort(), ['hell', 'streaks']);
  assert.deepStrictEqual(raw.streaks, [{ name: 'AB12', score: 3 }]);
});

test('dual streak board: one record per partner combo, name built by the caller', () => {
  const s = fakeStorage();
  const combo = L.normalizeName('ab') + L.normalizeName('cd'); // caller joins the two players
  assert.strictEqual(combo, 'ABCD');
  assert.strictEqual(L.add('streaks', { name: combo, score: 3 }, { storage: s }), 1);
  assert.strictEqual(L.add('streaks', { name: combo, score: 4 }, { storage: s }), 1); // new run = a new record
  assert.strictEqual(L.top('streaks', 8, { storage: s }).length, 2);
});

test('empty name at add time falls back to the caller-provided default, stored verbatim', () => {
  const s = fakeStorage();
  L.add('streaks', { name: '', score: 2 }, { defaultName: '紅方', storage: s });
  L.add('streaks', { name: '!!', score: 3 }, { defaultName: '藍方', storage: s });
  L.add('streaks', { name: '', score: 1 }, { storage: s }); // no default given → TEAM
  assert.deepStrictEqual(
    L.top('streaks', 8, { storage: s }).map(r => r.name),
    ['藍方', '紅方', 'TEAM']
  );
});

test('storage throwing → in-memory fallback; add/top keep working (no crash)', () => {
  L._reset();
  const bad = {
    get() { throw new Error('storage disabled'); },
    set() { throw new Error('storage disabled'); },
  };
  assert.strictEqual(L.add('streaks', { name: 'MEM01', score: 9 }, { storage: bad }), 1);
  assert.strictEqual(L.add('hell', { name: 'MEM02', score: 6 }, { storage: bad }), 1);
  assert.deepStrictEqual(L.top('streaks', 8, { storage: bad }).map(r => r.name), ['MEM01']);
  assert.deepStrictEqual(L.top('hell', 8, { storage: bad }).map(r => r.score), [6]);
});

test('a storage that failed once stays degraded for the session (set throws after read)', () => {
  L._reset();
  let reads = 0;
  const quota = { get() { reads += 1; return null; }, set() { throw new Error('quota exceeded'); } };
  assert.strictEqual(L.add('streaks', { name: 'QUOTA1', score: 5 }, { storage: quota }), 1); // write fails → memory
  // later reads must use the memory copy, not the stale storage
  assert.deepStrictEqual(L.top('streaks', 8, { storage: quota }).map(r => r.name), ['QUOTA1']);
  assert.strictEqual(reads, 1); // the failed storage is never asked again
});

test('default storage unavailable → memory fallback works with no injected storage', () => {
  L._reset();
  // Precondition: this runtime must not have a WORKING localStorage (Node's
  // built-in is a throwing stub / browsers block it on some file:// setups),
  // otherwise the assertions below would write real storage.
  assert.notStrictEqual(
    typeof (globalThis.localStorage && globalThis.localStorage.getItem), 'function',
    'runtime has a working localStorage; this test only covers the fallback path'
  );
  assert.strictEqual(L.add('streaks', { name: 'NODE1', score: 7 }), 1);
  assert.deepStrictEqual(L.top('streaks', 8).map(r => r.name), ['NODE1']);
});

test('corrupt stored payload degrades to an empty board, next add overwrites it', () => {
  const s = fakeStorage({ cc_leaderboards_v1: 'not-json{{{' });
  assert.deepStrictEqual(L.top('streaks', 8, { storage: s }), []);
  assert.strictEqual(L.add('streaks', { name: 'FIX01', score: 2 }, { storage: s }), 1);
  assert.deepStrictEqual(L.top('streaks', 8, { storage: s }).map(r => r.name), ['FIX01']);
});

test('top returns copies, defaults to the top 8, and slices to n', () => {
  const s = fakeStorage();
  for (let i = 1; i <= 9; i++) {
    L.add('streaks', { name: 'S' + i, score: i }, { storage: s });
  }
  assert.strictEqual(L.top('streaks', undefined, { storage: s }).length, 8); // default count
  assert.deepStrictEqual(L.top('streaks', 2, { storage: s }).map(r => r.name), ['S9', 'S8']);
  const rows = L.top('streaks', 1, { storage: s });
  rows[0].score = 999;
  rows[0].name = 'HACK';
  assert.deepStrictEqual(L.top('streaks', 1, { storage: s }), [{ name: 'S9', score: 9 }]);
});

test('unknown board throws (also with an order override)', () => {
  assert.throws(() => L.add('speedrun', { name: 'X', score: 1 }, { storage: fakeStorage() }), /unknown board/);
  assert.throws(() => L.top('speedrun', 8, { storage: fakeStorage() }), /unknown board/);
  assert.throws(
    () => L.top('speedrun', 8, { order: 'asc', storage: fakeStorage() }),
    /unknown board/
  );
});
