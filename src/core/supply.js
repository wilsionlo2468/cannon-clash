/* CC.Supply — supply crate: once-per-match spawn roll and blast pickup (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Pins from the task-8 brief, literal — tests depend on these exact
  // values, do not tweak in isolation:
  //   at most ONE crate per match (the record survives a pickup);
  //   eligible from round 3; spawn chance rng() < 0.2 (strict);
  //   x over the valley floor [700, 1000] — the span terrain.js pins
  //   for crates; y = Terrain.heightAt(x) seats the crate on the ground;
  //   pickup reach: any explosion point closer than 40px to the crate.
  var MIN_ROUND = 3;
  var CHANCE = 0.2;
  var X_MIN = 700;
  var X_SPAN = 300;  // x = 700 + rng()*300 over [700, 1000)
  var RADIUS = 40;   // px, strict — compared squared below
  var R2 = RADIUS * RADIUS;

  // The crate is a pure trigger volume: shells are never blocked by it.
  // Nothing here (nor in Terrain/Ballistics) consults a crate during
  // flight — the ONLY interaction is an explosion point landing within
  // RADIUS of one (pickup), so a shell simply flies past or lands on it.

  /**
   * maybeSpawn(match, rng) -> {x, y}|null
   * Rolls for the match's single supply crate. Spawns only when all of
   *   — no crate has appeared yet this match (match.crateSpawned; the
   *     record persists after a pickup, so at most one per match),
   *   — the match is at round >= MIN_ROUND,
   *   — the gate draw rng() < CHANCE (strict)
   * hold; each failed condition returns null, the cheap ones BEFORE any
   * randomness is consumed. On a pass a second rng draw picks
   * x = 700 + rng()*300 over the valley floor and y = Terrain.heightAt(x)
   * seats the crate on the ground.
   *
   * Crate state lives on the match object, both fields owned here:
   * match.crate is the live crate {x, y} (null once picked up) for the
   * view to draw, match.crateSpawned the once-per-match record.
   * CC.Match.create stays unaware of crates (task-5 ledger). The caller
   * (task 11 main loop) rolls when a round starts, e.g. after match.next()
   * hands back 'AIM'.
   */
  function maybeSpawn(match, rng) {
    if (match.crateSpawned) { return null; }
    if (match.round < MIN_ROUND) { return null; }
    if (rng() >= CHANCE) { return null; }
    var x = X_MIN + rng() * X_SPAN;
    var crate = { x: x, y: CC.Terrain.heightAt(x) };
    match.crate = crate;
    match.crateSpawned = true;
    return crate;
  }

  // Does any explosion point reach the crate (strict squared distance)?
  function reaches(crate, points) {
    for (var i = 0; i < points.length; i++) {
      var dx = points[i].x - crate.x;
      var dy = points[i].y - crate.y;
      if (dx * dx + dy * dy < R2) { return true; }
    }
    return false;
  }

  /**
   * pickup(match, side, points) -> boolean
   * Settles a landed shot against the live crate, if any. points is the
   * shot's explosion points — exactly match.lastShot.explosions (the
   * task-5 seam); a cluster shot carries its 3 children, so a scattered
   * child can claim the crate. If ANY point is closer than RADIUS to the
   * crate center: the shooting side's cannon.refill() tops every special
   * shell back up, the crate is removed (match.crate = null; the
   * once-per-match record stays) and true is returned. A miss — or no
   * live crate — returns false and touches nothing.
   * side is who fired the shell, explicit rather than read from
   * match.turn so the caller is free to settle after next() flipped the
   * turn; anything but 'P1'/'P2' throws (no silent wrong-player refill).
   */
  function pickup(match, side, points) {
    if (side !== 'P1' && side !== 'P2') {
      throw new Error('CC.Supply.pickup: side must be "P1" or "P2", got ' + side);
    }
    var crate = match.crate;
    if (!crate || !reaches(crate, points)) { return false; }
    (side === 'P1' ? match.p1 : match.p2).refill();
    match.crate = null;
    return true;
  }

  CC.Supply = { maybeSpawn: maybeSpawn, pickup: pickup };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Supply;
  }
})(typeof window !== 'undefined' ? window : globalThis);
