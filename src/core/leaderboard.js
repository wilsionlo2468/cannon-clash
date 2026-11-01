/* CC.Leaderboard — local top-8 boards (streaks / hell) with in-memory fallback (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  var STORAGE_KEY = 'cc_leaderboards_v1';
  var MAX_ENTRIES = 8;       // 各榜取前 8 — a board never holds more than this
  var NAME_MAX = 6;          // spec §5: names are A-Z/0-9, 6 characters
  var DEFAULT_NAME = 'TEAM'; // used when the record is nameless and the caller passes no defaultName

  // Controller ruling R2: the streaks board ranks MORE consecutive wins
  // first (desc); the hell board ranks FEWER rounds first (asc — score is
  // the number of rounds needed to beat the hell AI). Per-call opts.order
  // overrides the board default.
  var BOARDS = { streaks: 'desc', hell: 'asc' };

  // Fallback store. Used whenever storage is unavailable (Node, browsers
  // that block localStorage) or throws (quota exceeded). A storage that
  // failed once is remembered and never asked again this session, so
  // add/top stay mutually consistent on the memory copy and the game
  // keeps running without it.
  var memoryBoards = null;
  var failedStorages = [];

  function fail(storage) {
    if (storage && failedStorages.indexOf(storage) === -1) {
      failedStorages.push(storage);
    }
  }

  function isFailed(storage) {
    return failedStorages.indexOf(storage) !== -1;
  }

  // The default adapter lazily wraps window.localStorage. Merely touching
  // it can throw (blocked on some file:// setups) — that counts as
  // unavailable and the session degrades to memory. A storage without the
  // get/set interface (e.g. Node's inert localStorage stub) is likewise
  // unavailable. Probe result is cached so every call sees the same
  // adapter identity.
  var defaultAdapter; // undefined = not probed yet, null = unavailable
  function getDefaultStorage() {
    if (defaultAdapter === undefined) {
      try {
        var ls = root.localStorage || null;
        defaultAdapter = ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? {
          get: function (k) { return ls.getItem(k); },
          set: function (k, v) { ls.setItem(k, v); }
        } : null;
      } catch (e) {
        defaultAdapter = null;
      }
    }
    return defaultAdapter;
  }

  /**
   * normalizeName(raw, fallback) -> string
   * Spec §5 name rules: uppercase, strip everything outside A-Z/0-9, cap
   * at 6 characters. A name that is empty after filtering (or missing)
   * falls back to the caller's defaultName VERBATIM — defaults like
   * '紅方'/'藍方' are not re-filtered. 'TEAM' when no default is given.
   */
  function normalizeName(raw, fallback) {
    var s = String(raw == null ? '' : raw)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, NAME_MAX);
    return s || (fallback ? String(fallback) : DEFAULT_NAME);
  }

  function emptyBoards() {
    return { streaks: [], hell: [] };
  }

  function requireBoard(board) {
    if (!Object.prototype.hasOwnProperty.call(BOARDS, board)) {
      throw new Error('unknown board: ' + board);
    }
  }

  function resolveOrder(board, opts) {
    requireBoard(board);
    var order = opts && opts.order;
    if (order == null) { return BOARDS[board]; }
    if (order !== 'asc' && order !== 'desc') {
      throw new Error('unknown order: ' + order);
    }
    return order;
  }

  // Defensively reshapes parsed storage data; corrupt boards/entries are
  // dropped so a bad payload degrades to an empty board, never a crash.
  function sanitizeBoards(data) {
    var boards = emptyBoards();
    if (!data || typeof data !== 'object') { return boards; }
    for (var b in BOARDS) {
      if (Object.prototype.hasOwnProperty.call(data, b) && Array.isArray(data[b])) {
        boards[b] = data[b]
          .filter(function (e) {
            return e && typeof e === 'object' &&
              typeof e.score === 'number' && isFinite(e.score);
          })
          .map(function (e) {
            return { name: typeof e.name === 'string' ? e.name : '', score: e.score };
          });
      }
    }
    return boards;
  }

  function readMemory() {
    if (!memoryBoards) { memoryBoards = emptyBoards(); }
    return memoryBoards;
  }

  function writeMemory(boards) {
    memoryBoards = boards;
  }

  function readBoards(storage) {
    if (!storage || isFailed(storage)) { return readMemory(); }
    var raw;
    try {
      raw = storage.get(STORAGE_KEY);
    } catch (e) {
      fail(storage); // storage is gone: keep this session on memory
      return readMemory();
    }
    if (raw == null) { return emptyBoards(); }
    try {
      return sanitizeBoards(JSON.parse(raw));
    } catch (e) {
      return emptyBoards(); // corrupt payload: start clean, next add overwrites
    }
  }

  function writeBoards(storage, boards) {
    if (!storage || isFailed(storage)) { writeMemory(boards); return; }
    try {
      storage.set(STORAGE_KEY, JSON.stringify(boards));
    } catch (e) {
      fail(storage); // e.g. quota exceeded: keep this session on memory
      writeMemory(boards);
    }
  }

  // Array.prototype.sort is stable (ES2019+), so equal scores keep
  // arrival order — first-come-first-served. The stored array itself is
  // arrival-ordered and JSON keeps that order across reloads.
  function byDesc(a, b) { return b.score - a.score; }
  function byAsc(a, b) { return a.score - b.score; }

  /**
   * add(board, record, opts) -> rank|null
   * board: 'streaks' | 'hell'. record: {name, score} — one record per
   * add; on the dual streak board the caller joins both players into one
   * combo name (a broken streak or a new pairing starts a new record).
   * opts:
   *   order       — 'desc'|'asc', overrides the board default (R2)
   *   defaultName — verbatim fallback name for a nameless record
   *   storage     — injectable {get(key), set(key, string)}; defaults to
   *                 window.localStorage with memory fallback
   * Sorts, keeps the top 8 and returns the new record's 1-based rank, or
   * null when it did not make the board.
   */
  function add(board, record, opts) {
    var order = resolveOrder(board, opts);
    var storage = opts && opts.storage ? opts.storage : getDefaultStorage();
    var boards = readBoards(storage);

    var entry = {
      name: normalizeName(record && record.name, opts && opts.defaultName),
      score: record ? record.score : undefined
    };
    var list = boards[board];
    list.push(entry);
    list.sort(order === 'asc' ? byAsc : byDesc);
    var rank = list.indexOf(entry) + 1;
    if (rank > MAX_ENTRIES) { rank = null; } // did not make the top 8
    list.length = Math.min(list.length, MAX_ENTRIES); // trim the tail in place
    writeBoards(storage, boards);
    return rank;
  }

  /**
   * top(board, n, opts) -> [{name, score}]
   * The board's best n records (default 8) in rank order: position 0 is
   * rank 1 (gold). opts: order override, storage — as in add(). Returns
   * fresh record copies; callers cannot mutate the stored board.
   */
  function top(board, n, opts) {
    var order = resolveOrder(board, opts);
    var storage = opts && opts.storage ? opts.storage : getDefaultStorage();
    var list = readBoards(storage)[board].slice();
    list.sort(order === 'asc' ? byAsc : byDesc);
    var count = n == null ? MAX_ENTRIES : n;
    return list.slice(0, count).map(function (e) {
      return { name: e.name, score: e.score };
    });
  }

  // Test hook: clears the in-memory fallback and the failed-storage list
  // so tests stay hermetic (tests inject fakes and never touch real
  // localStorage).
  function _reset() {
    memoryBoards = null;
    failedStorages = [];
    defaultAdapter = undefined;
  }

  CC.Leaderboard = {
    add: add,
    top: top,
    normalizeName: normalizeName,
    _reset: _reset
  };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Leaderboard;
  }
})(typeof window !== 'undefined' ? window : globalThis);
