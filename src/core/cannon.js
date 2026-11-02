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
      weapon: 'normal'
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

  CC.Cannon = { create: create, muzzle: muzzle, MUZZLE_LEN: MUZZLE_LEN };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Cannon;
  }
})(typeof window !== 'undefined' ? window : globalThis);
