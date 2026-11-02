var test = require('node:test');
var assert = require('node:assert');
var Board = require('../src/core/leaderboard.js');

// Hermetic fake storage per test (never touches real localStorage).
function fakeStorage() {
  var store = {};
  return { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; } };
}

test('upsert: unknown identity inserts like add and returns its rank', () => {
  Board._reset();
  var s = fakeStorage();
  assert.equal(Board.upsert('streaks', { name: 'SUN+MOON', score: 1 }, { rawName: true, storage: s }), 1);
  // R16 rawName: the combo name lands VERBATIM ('+' kept, no 6-char cut)
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'SUN+MOON', score: 1 }]);
});

test('upsert: same pairing rematch with a LOWER streak does not touch the board', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'AB', score: 5 }, { rawName: true, storage: s });
  var rank = Board.upsert('streaks', { name: 'AB', score: 2 }, { rawName: true, storage: s });
  assert.equal(rank, 1);
  // exactly ONE record, still the old score — no stacking, no regression
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'AB', score: 5 }]);
});

test('upsert: same pairing with an EQUAL streak is a no-op', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'AB', score: 3 }, { rawName: true, storage: s });
  Board.upsert('streaks', { name: 'AB', score: 3 }, { rawName: true, storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'AB', score: 3 }]);
});

test('upsert: higher streak updates the existing record (one record per pairing)', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'AB', score: 2 }, { rawName: true, storage: s });
  Board.upsert('streaks', { name: 'CD', score: 4 }, { rawName: true, storage: s });
  var rank = Board.upsert('streaks', { name: 'AB', score: 6 }, { rawName: true, storage: s });
  assert.equal(rank, 1); // updated record re-ranked past C+D
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [
    { name: 'AB', score: 6 },
    { name: 'CD', score: 4 }
  ]);
});

test('upsert: names normalize before identity comparison (add vs rawName)', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'ACE', score: 2 }, { rawName: true, storage: s });
  Board.upsert('streaks', { name: 'ace', score: 4 }, { rawName: true, storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'ACE', score: 4 }]);
});

test('rawName (R16): combo names keep the + separator and land verbatim', () => {
  Board._reset();
  var s = fakeStorage();
  Board.add('streaks', { name: 'SUN+MOON', score: 1 }, { rawName: true, storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'SUN+MOON', score: 1 }]);
});

test('rawName (R16): control characters are stripped, cap is 16 chars', () => {
  Board._reset();
  var s = fakeStorage();
  Board.add('streaks', { name: 'ABCD+EFGHIJKLMNOPQ', score: 1 }, { rawName: true, storage: s });
  var list = Board.top('streaks', 8, { storage: s });
  assert.equal(list[0].name, 'ABCD+EFGHIJKLMNO'); // control char gone, 16 chars max
  assert.equal(list[0].name.length, 16);
});

test('rawName (R16): distinct full combo names are distinct identities', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'AB+CDEF', score: 3 }, { rawName: true, storage: s });
  Board.upsert('streaks', { name: 'ABCDEF+X', score: 1 }, { rawName: true, storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [
    { name: 'AB+CDEF', score: 3 },
    { name: 'ABCDEF+X', score: 1 }
  ]);
});

test('rawName (R16): upsert updates an existing combo record in place', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'SUN+MOON', score: 1 }, { rawName: true, storage: s });
  Board.upsert('streaks', { name: 'SUN+MOON', score: 2 }, { rawName: true, storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'SUN+MOON', score: 2 }]);
});

test('without rawName the A-Z0-9 filter and 6-char cap still apply', () => {
  Board._reset();
  var s = fakeStorage();
  Board.add('streaks', { name: 'SUN+MOON', score: 1 }, { storage: s });
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'SUNMOO', score: 1 }]);
});

test('upsert: a different pairing starts fresh (拆夥重新計數) without disturbing others', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: 'AB', score: 5 }, { rawName: true, storage: s });
  var rank = Board.upsert('streaks', { name: 'AC', score: 1 }, { rawName: true, storage: s });
  assert.equal(rank, 2);
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [
    { name: 'AB', score: 5 },
    { name: 'AC', score: 1 }
  ]);
});

test('upsert: hell board asc — fewer rounds updates, more rounds is a no-op', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('hell', { name: 'ACE', score: 12 }, { storage: s });
  Board.upsert('hell', { name: 'ACE', score: 20 }, { storage: s }); // worse: no-op
  assert.deepEqual(Board.top('hell', 8, { storage: s }), [{ name: 'ACE', score: 12 }]);
  Board.upsert('hell', { name: 'ACE', score: 9 }, { storage: s }); // better: update
  assert.deepEqual(Board.top('hell', 8, { storage: s }), [{ name: 'ACE', score: 9 }]);
});

test('upsert: defaultName fallback and normalizeName filtering still apply', () => {
  Board._reset();
  var s = fakeStorage();
  Board.upsert('streaks', { name: '', score: 1 }, { defaultName: 'TEAM', storage: s });
  Board.upsert('streaks', { name: 'team', score: 2 }, { rawName: true, storage: s }); // same identity
  assert.deepEqual(Board.top('streaks', 8, { storage: s }), [{ name: 'TEAM', score: 2 }]);
});
