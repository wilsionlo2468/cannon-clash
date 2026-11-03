/* CC.Cannon — cannon state: stance, HP, ammo, damage hooks (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Stances pinned by the task brief: P1 on the left platform top, P2 on
  // the right (terrain.heightAt(250) === 400, heightAt(1300) === 445,
  // pinned by the task-3 tests). angle is the shared 0..85 elevation the
  // input layer drives (task 11 limits both sides to it) — the per-side
  // firing direction is the caller's concern: P1 fires at +angle, P2 at
  // 180-angle (the task-6 AI tests already shoot 135deg from the right).
  var STANCES = {
    P1: { x: 250, y: 400 },
    P2: { x: 1300, y: 445 }
  };

  /**
   * create(side) -> cannon
   * side is 'P1' or 'P2' (anything else throws). Returns the full cannon
   * state: stance, hp:100, elevation angle:45, charge power:0, selection
   * weapon:'normal', and a private ammo copy of the pinned LIST counts.
   * spend/onHit/refill are the three downstream hooks: firing spends one
   * shell of the selected weapon, a settled blast calls onHit(dmg), and a
   * supply-crate pickup (task 8) calls refill() to top every special
   * shell back up. Needs CC.Weapons (loaded first per index.html order).
   */
  function create(side) {
    var stance = STANCES[side];
    if (!stance) {
      throw new Error('CC.Cannon.create: side must be "P1" or "P2", got ' + side);
    }
    var list = CC.Weapons.LIST;
    var ammo = {};
    for (var key in list) { ammo[key] = list[key].count; }

    var cannon = {
      side: side,
      x: stance.x,
      y: stance.y,
      hp: 100,
      angle: 45,
      power: 0,
      ammo: ammo,
      weapon: 'normal',
      moveBudget: MOVE_RANGE // per-turn walking budget (match resets it)
    };

    /**
     * spend() -> boolean — consume one shell of the selected weapon.
     * Infinite stock (normal) always succeeds without counting down; a
     * finite empty stock refuses (false) and never goes negative; so does
     * an unusable selection (no phantom ammo entry is created).
     */
    cannon.spend = function () {
      var left = cannon.ammo[cannon.weapon];
      if (left === undefined) { return false; } // unknown weapon key
      if (left !== Infinity && left <= 0) { return false; }
      if (left !== Infinity) { cannon.ammo[cannon.weapon] = left - 1; }
      return true;
    };

    /**
     * onHit(dmg) -> hp — settle damage onto this cannon; HP clamps at 0.
     * Returns the remaining HP (0 means defeated; the match layer reads it).
     */
    cannon.onHit = function (dmg) {
      cannon.hp = Math.max(0, cannon.hp - dmg);
      return cannon.hp;
    };

    /**
     * refill() — supply-crate pickup: top every weapon back to its pinned
     * LIST count (normal stays Infinity; all specials return to full).
     * The weapon selection is left untouched.
     */
    cannon.refill = function () {
      for (var key in list) { cannon.ammo[key] = list[key].count; }
    };

    /**
     * sink() — re-seat the cannon on the (possibly freshly carved)
     * surface under it. Called after every landing and after any
     * horizontal move: the stance y is wherever the terrain now is.
     */
    cannon.sink = function () {
      cannon.y = CC.Terrain.heightAt(cannon.x);
    };

    /**
     * knock(dir) — heavy-shell shockwave: shove the cannon KNOCKBACK px
     * horizontally (dir is the unit direction, +1/-1), clamped to the
     * field, then re-seat it on the surface below the new x. Does not
     * touch the move budget — being shoved is not walking.
     */
    cannon.knock = function (dir) {
      var x = cannon.x + (dir >= 0 ? 1 : -1) * KNOCKBACK;
      cannon.x = x < X_MIN ? X_MIN : x > X_MAX ? X_MAX : x;
      cannon.sink();
    };

    /**
     * jump(dx) -> number — leap dx px (signed) in one bound, spending the
     * move budget 1:1 like walking. Unlike move(), the whole span is NOT
     * slope-checked (Terrain.walkable is skipped): the hop clears crater
     * rims and steep valley walls a walk would refuse — the way out when
     * a heavy shell has dug you into a pit. The request is capped by both
     * JUMP_RANGE and the remaining budget, then the field bounds; returns
     * the px actually jumped (0 when nothing remains) and re-seats the
     * cannon on the surface under the new x. Leaping off a platform edge
     * is legal (knock can already shove you off) — the valley floor below
     * is a real stance, not a trap.
     */
    cannon.jump = function (dx) {
      var cap = Math.min(cannon.moveBudget, JUMP_RANGE);
      var want = Math.max(-cap, Math.min(cap, dx));
      var nx = cannon.x + want;
      if (nx < X_MIN) { nx = X_MIN; }
      if (nx > X_MAX) { nx = X_MAX; }
      var actual = nx - cannon.x;
      if (!actual) { return 0; }
      cannon.x = nx;
      cannon.moveBudget -= Math.abs(actual);
      cannon.sink();
      return actual;
    };

    /**
     * move(dx) -> number — walk dx px (signed) within this turn's budget.
     * The request is capped by the remaining budget and the field bounds;
     * the whole span must be walkable (Terrain.walkable — valley walls
     * and fresh crater rims refuse) or nothing moves. Returns the px
     * actually moved (0 when refused), and re-seats the cannon on the
     * surface under the new x. The view walks in small per-frame steps,
     * so a refused span reads as "stopped at the wall".
     */
    cannon.move = function (dx) {
      var want = dx;
      if (want > cannon.moveBudget) { want = cannon.moveBudget; }
      if (want < -cannon.moveBudget) { want = -cannon.moveBudget; }
      var nx = cannon.x + want;
      if (nx < X_MIN) { nx = X_MIN; }
      if (nx > X_MAX) { nx = X_MAX; }
      var actual = nx - cannon.x;
      if (!actual) { return 0; }
      if (!CC.Terrain.walkable(cannon.x, nx)) { return 0; }
      cannon.x = nx;
      cannon.moveBudget -= Math.abs(actual);
      cannon.sink();
      return actual;
    };

    return cannon;
  }

  // Barrel length in px from the pivot to the muzzle — the launch origin.
  // The barrel art reaches ~131-136px along the bore, so 130 keeps the
  // launch visually at the tip while giving core and view ONE shared
  // origin: before this, the AI solved from the stance while the view
  // flew from the art muzzle — a fixed few-px bias on every AI shot.
  var MUZZLE_LEN = 130;

  /**
   * muzzle(cannon, angleDeg?) -> {x, y}
   * The launch origin: the cannon's pivot pushed MUZZLE_LEN px along the
   * bore. Elevation defaults to the cannon's live angle (the shared
   * 0..85; pass the directional angle to preview another elevation). The
   * per-side firing direction is the cannon convention — P1's bore points
   * +x, P2's -x — and screen y grows downward, hence -sin.
   */
  function muzzle(cannon, angleDeg) {
    var a = (angleDeg === undefined ? cannon.angle : angleDeg) * Math.PI / 180;
    var dir = cannon.side === 'P1' ? 1 : -1;
    return {
      x: cannon.x + dir * Math.cos(a) * MUZZLE_LEN,
      y: cannon.y - Math.sin(a) * MUZZLE_LEN
    };
  }

  // Horizontal knockback: a heavy shell's shockwave shoves a struck
  // cannon this many px away from the blast (it can be shoved off a
  // platform edge or into a crater). Kept beside the movement bounds the
  // knock must respect.
  var KNOCKBACK = 30;
  var X_MIN = 80;   // the cannon art is ~164px wide; keep the body
  var X_MAX = 1520; // inside the 1600px field

  // Per-turn walking budget (px), reset by the match every advance —
  // enough to reposition meaningfully on a platform, not to cross the
  // field. A jump spends the same budget, capped per bound by:
  var MOVE_RANGE = 160;
  var JUMP_RANGE = 120; // one leap crosses at most this many px

  CC.Cannon = {
    create: create,
    muzzle: muzzle,
    MUZZLE_LEN: MUZZLE_LEN,
    KNOCKBACK: KNOCKBACK,
    X_MIN: X_MIN,
    X_MAX: X_MAX,
    MOVE_RANGE: MOVE_RANGE,
    JUMP_RANGE: JUMP_RANGE
  };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Cannon;
  }
})(typeof window !== 'undefined' ? window : globalThis);
