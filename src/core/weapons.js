/* CC.Weapons — shell stats table, blast settlement, cluster split (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Shell table pinned verbatim by the task brief. KEY ORDER is the
  // task-11 "W" rotation order — do not reorder, rename or renumber.
  // count is the per-match stock (Infinity = unlimited normal shells);
  // radius is the blast radius in px; cluster.children marks the 3
  // bomblets a cluster shell splits into on landing.
  var LIST = {
    normal:  { name: '普通彈', dmg: 20, count: Infinity, radius: 50 },
    heavy:   { name: '重錘彈', dmg: 45, count: 2,        radius: 70 },
    pierce:  { name: '穿甲彈', dmg: 15, count: 3,        radius: 40 },
    cluster: { name: '集束彈', dmg: 12, count: 1,        radius: 35, children: 3 }
  };

  // Cluster scatter distances, pinned by the brief: the three children
  // land at impact.x ± SPREAD[i] (magnitude per child in order, sign
  // random). Cluster does NOT detonate at its own impact — the brief
  // settles only the three children (confirmed with the user 2026-11-01)
  // — so this spread is the cluster's entire damage delivery. Kept off
  // LIST: the brief pins the LIST literal verbatim.
  var SPREAD = [60, 90, 120];

  function weapon(key) {
    var w = LIST[key];
    if (!w) { throw new Error('CC.Weapons: unknown weapon "' + key + '"'); }
    return w;
  }

  /**
   * explosions(key, impact, rng) -> [{x, y}, ...]
   * Every explosion point a shell of `key` produces when it lands at
   * `impact`: the impact itself for normal/heavy/pierce; for cluster the
   * three children — impact.x ± SPREAD[i] with the sign drawn from rng()
   * (one call per child), landing y = Terrain.heightAt(x) — the main
   * impact being only the scatter origin. rng is a () -> [0,1) source
   * (Math.random in play); injected so tests pin the signs deterministically.
   * Needs CC.Terrain (loaded first per index.html order).
   */
  function explosions(key, impact, rng) {
    var w = weapon(key);
    if (!w.children) { return [{ x: impact.x, y: impact.y }]; }
    var points = [];
    for (var i = 0; i < w.children; i++) {
      var x = impact.x + (rng() < 0.5 ? -1 : 1) * SPREAD[i];
      points.push({ x: x, y: CC.Terrain.heightAt(x) });
    }
    return points;
  }

  /**
   * settle(key, explosion, cannons) -> [{cannon, dmg}, ...]
   * The pinned settlement rule for ONE explosion point: every cannon
   * whose center lies strictly inside the blast radius (dist < radius)
   * takes dmg = round(w.dmg * (1 - dist / w.radius)), the linear falloff
   * rounded half-up. Cannons at or beyond the radius are not listed.
   * Pure: nothing is mutated here — the caller applies each hit via
   * cannon.onHit(dmg), staying free to filter (e.g. already-dead cannons).
   * Self-damage is natural: pass both cannons and a blast near one's own
   * base hurts its owner.
   */
  function settle(key, explosion, cannons) {
    var w = weapon(key);
    var hits = [];
    for (var i = 0; i < cannons.length; i++) {
      var c = cannons[i];
      var dx = explosion.x - c.x;
      var dy = explosion.y - c.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < w.radius) {
        hits.push({ cannon: c, dmg: Math.round(w.dmg * (1 - dist / w.radius)) });
      }
    }
    return hits;
  }

  CC.Weapons = { LIST: LIST, explosions: explosions, settle: settle };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Weapons;
  }
})(typeof window !== 'undefined' ? window : globalThis);
