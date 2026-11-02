/* CC.Match — turn state machine: rotation, turn clock, resolution, sudden death, streak (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Pins: the 30s soft turn limit (0/null disables it — the title-screen
  // toggle is task 11's); clock expiry auto-fires at power 50, the brief's
  // literal value (controller-confirmed over the plan's "current charge"
  // wording — a partial charge is discarded). The RESOLVE pause (1.2s) is
  // view-timed: task 11 calls next(), core builds in no countdown for it.
  var DEFAULT_TURN_LIMIT = 30; // seconds
  var AUTO_FIRE_POWER = 50;    // clock expiry while still aiming
  var SUDDEN_POWER = 65;       // fixed power for sudden-death deciding shots

  // Controller ruling R12: wind is UNIFORM over the integers -5..+5 —
  // floor(random*11) - 5 gives all 11 values equal probability 1/11.
  // (Supersedes the task-brief step-3 round formula, whose two edge
  // values were half as likely as the inner nine.)
  function rollWind(rng) {
    return Math.floor(rng() * 11) - 5;
  }

  function other(side) {
    return side === 'P1' ? 'P2' : 'P1';
  }

  /**
   * create(cannons, opts) -> match
   * cannons = {p1, p2}: the two CC.Cannon instances (created by the
   * caller, kept by reference — the match fires and damages them in
   * place). opts:
   *   turnLimitSec — per-turn soft limit, default 30; 0/null disables the
   *     clock (tick() then never auto-fires).
   *   rng — () -> [0,1) source, Math.random in play; drives the pinned
   *     wind roll and the cluster scatter handed to Weapons.explosions.
   *     Injectable so tests pin the randoms deterministically.
   *   streakKey / streakSide — optional identity of the competitor whose
   *     win streak this match decides, and the side they play (default
   *     'P1', the single-player human side). OVER then carries
   *     streakDelta: +1 when the holder's side won, -1 when it lost, null
   *     without a streakKey. Whether the leaderboards consume it is the
   *     caller's decision (task 7/11).
   *
   * State flow (task-5 brief, literal):
   *   AIM/CHARGE --fire()--> FLIGHT --land(impact)--> RESOLVE --next()-->
   *   AIM (side switch, wind re-roll, round+1). Every landing passes
   *   through RESOLVE — the view times the pause there — and next()
   *   hands out the outcome:
   *     one cannon at 0 HP  -> 'OVER' with winner
   *     both at 0 HP        -> 'SUDDEN' (review focus 5: never an error
   *                            or deadlock), then deciding shots fire
   *                            FROM the SUDDEN state (fire/land accept
   *                            it) until one lands unequal per-side
   *                            damage: with both HP clamped at 0, the
   *                            shot's damage is the only live form of
   *                            the brief's "HP 高者勝" (less damage
   *                            taken = higher effective HP); an equal
   *                            or blank shot keeps SUDDEN for the next
   *                            one — per the controller ruling the
   *                            state stays 'SUDDEN' until decided.
   * land(impact) settles through the task-4 chain — Weapons.explosions ->
   * settle -> cannon.onHit — so self-damage is natural and no blast math
   * is re-implemented here. lastShot records what a landing produced
   * ({weapon, impact, explosions, hits, dmg}) for the view's effects and
   * task 8's crate pickup.
   */
  function create(cannons, opts) {
    opts = opts || {};
    var p1 = cannons && cannons.p1;
    var p2 = cannons && cannons.p2;
    if (!p1 || !p2 || typeof p1.onHit !== 'function' || typeof p2.onHit !== 'function') {
      throw new Error('CC.Match.create: p1/p2 must be cannons from CC.Cannon.create');
    }
    var rng = opts.rng || Math.random;
    var limit = opts.turnLimitSec === undefined ? DEFAULT_TURN_LIMIT : opts.turnLimitSec;
    var streakSide = opts.streakSide || 'P1';

    // Per-flight bookkeeping (internal: only fire/land/next read these).
    var firedWeapon = null;    // what the current flight carries
    var firedInSudden = false; // is it a sudden-death deciding shot?

    var match = {
      state: 'AIM',
      turn: 'P1',
      round: 1,
      wind: rollWind(rng),
      timer: limit > 0 ? limit : 0,
      p1: p1,
      p2: p2,
      winner: null,
      rounds: null,      // set at OVER: the round the deciding shot landed in
      streakDelta: null, // set at OVER: +1/-1 with a streakKey, else null
      lastShot: null     // set at land(): {weapon, impact, explosions, hits, dmg}
    };

    function cannonOf(side) {
      return side === 'P1' ? p1 : p2;
    }

    function over(winner) {
      match.state = 'OVER';
      match.winner = winner;
      match.rounds = match.round;
      match.streakDelta = opts.streakKey ? (winner === streakSide ? 1 : -1) : null;
    }

    // Hand the turn over: side switch, wind re-roll, round+1, fresh clock.
    function advance(state) {
      match.turn = other(match.turn);
      match.round += 1;
      match.wind = rollWind(rng);
      match.timer = limit > 0 ? limit : 0;
      match.state = state;
      return state;
    }

    /**
     * startCharge() -> 'CHARGE'|null — AIM -> CHARGE; the input layer
     * drives cannon.power from the charge clock while the key is held.
     * The charge always begins from ZERO: power used to survive across
     * turns (only ever ramped up), making the previous shot's value both
     * the invisible baseline and a hard floor — the "power can only grow"
     * ratchet. Inert elsewhere.
     */
    match.startCharge = function () {
      if (match.state !== 'AIM') { return null; }
      cannonOf(match.turn).power = 0;
      match.state = 'CHARGE';
      return 'CHARGE';
    };

    /**
     * fire() -> weapon key|null — fire the current turn's cannon with its
     * live state (angle/power/weapon as the caller set them; from CHARGE
     * that is the charged power). Valid from AIM/CHARGE/SUDDEN, null
     * no-op otherwise (key handlers may race the flow). The selected
     * shell is spent via cannon.spend(); an empty or unknown selection
     * falls back to 普通彈 so the clock's auto-fire can never deadlock
     * (review focus 3). Returns the weapon actually fired — the caller
     * simulates exactly that shell.
     */
    match.fire = function () {
      if (match.state !== 'AIM' && match.state !== 'CHARGE' && match.state !== 'SUDDEN') {
        return null;
      }
      var c = cannonOf(match.turn);
      if (match.state === 'SUDDEN') {
        // Sudden death has no charge mechanic: deciding shots fire at the
        // fixed power, never the stale last-shot value.
        c.power = SUDDEN_POWER;
      }
      c.lastPower = c.power; // what this shot actually used — the view's
      c.lastAngle = c.angle; // "previous shot" gauge marker reads these
      var weapon = c.weapon;
      if (!c.spend()) {
        weapon = 'normal';
        c.spend(); // infinite stock — never refuses
      }
      firedWeapon = weapon;
      firedInSudden = match.state === 'SUDDEN';
      match.state = 'FLIGHT';
      return weapon;
    };

    /**
     * land(impact) -> lastShot|null — settle the in-flight shell at the
     * impact the caller's flight integration produced (view-side
     * Ballistics + Terrain.hit, per the plan's cross-task ledger).
     * FLIGHT -> RESOLVE always: even a lethal landing gets the resolve
     * pause before next() hands out the outcome.
     */
    match.land = function (impact) {
      if (match.state !== 'FLIGHT') { return null; }
      var points = CC.Weapons.explosions(firedWeapon, impact, rng);
      var hits = [];
      var dmg = { P1: 0, P2: 0 };
      for (var i = 0; i < points.length; i++) {
        var settled = CC.Weapons.settle(firedWeapon, points[i], [p1, p2]);
        for (var j = 0; j < settled.length; j++) {
          settled[j].cannon.onHit(settled[j].dmg);
          dmg[settled[j].cannon.side] += settled[j].dmg;
          hits.push(settled[j]);
        }
      }
      match.lastShot = {
        weapon: firedWeapon,
        impact: { x: impact.x, y: impact.y },
        explosions: points,
        hits: hits,
        dmg: dmg
      };
      match.state = 'RESOLVE';
      return match.lastShot;
    };

    /**
     * next() -> 'AIM'|'SUDDEN'|'OVER'|null — close the resolve pause and
     * hand out the outcome (see create for the full rules). Inert outside
     * RESOLVE.
     */
    match.next = function () {
      if (match.state !== 'RESOLVE') { return null; }
      var dead1 = p1.hp === 0;
      var dead2 = p2.hp === 0;
      if (dead1 && dead2) {
        // 同回合雙歸零 -> SUDDEN, never an error or deadlock (review focus
        // 5). The pinned geometry cannot reach this with one shell (blast
        // reach < cannon separation); the branch exists for exactly the
        // case the brief calls out and is driven in tests through the
        // real chain with a pre-zeroed cannon.
        if (firedInSudden && match.lastShot.dmg.P1 !== match.lastShot.dmg.P2) {
          // Deciding shot: less damage taken wins — "HP 高者勝" in its
          // only live form (HP clamps at 0-0; the shot's damage is the
          // effective-HP difference). An equal or blank shot falls
          // through: the state stays SUDDEN for the next deciding shot.
          over(match.lastShot.dmg.P1 < match.lastShot.dmg.P2 ? 'P1' : 'P2');
          return 'OVER';
        }
        // Sudden-death entry (or a blank deciding shot): "HP 高者勝" with
        // both HP clamped to 0 compares equal, so per the controller
        // ruling the match goes to the next shot, state staying SUDDEN
        // until one decides.
        return advance('SUDDEN');
      }
      if (dead1) { over('P2'); return 'OVER'; }
      if (dead2) { over('P1'); return 'OVER'; }
      return advance('AIM');
    };

    /**
     * tick(dt) — the turn clock. Counts down only in AIM/CHARGE (the
     * brief's 皆然) and only when a limit is set; at zero it auto-fires
     * exactly once (FLIGHT freezes the clock) so the machine can never
     * sit dead on the clock (review focus 3). Expiring mid-charge fires
     * the CURRENT charge — a partial charge is no longer discarded —
     * while expiring before the charge began falls back to the pinned
     * AUTO_FIRE_POWER.
     */
    match.tick = function (dt) {
      if (match.state !== 'AIM' && match.state !== 'CHARGE') { return; }
      if (!(limit > 0) || !(dt > 0)) { return; }
      match.timer = Math.max(0, match.timer - dt);
      if (match.timer === 0) {
        if (match.state === 'AIM') {
          cannonOf(match.turn).power = AUTO_FIRE_POWER;
        }
        match.fire();
      }
    };

    return match;
  }

  CC.Match = { create: create };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Match;
  }
})(typeof window !== 'undefined' ? window : globalThis);
