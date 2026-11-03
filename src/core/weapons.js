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
    pierce:  { name: '穿甲彈', dmg: 25, count: 3,        radius: 40 },
    cluster: { name: '集束彈', dmg: 12, count: 1,        radius: 35, children: 3 }
  };

  // 穿甲彈 penetration: past the first terrain contact the round burrows
  // on (Ballistics.simulatePierce) this many px of path length before
  // detonating — the punish-a-dug-in-enemy shot that reaches through
  // crater rims and ridge walls. v1.2: pierce's dmg moved 15->25 alongside
  // (it was below normal's 20 — a niche shell nobody had a reason to fire;
  // now it is the precision punish tool at 3x25 potential).
  var PENETRATE_PX = 110;

  // Cluster bomblets: bursting out of the parent impact with raw velocity
  // (Ballistics.lob). v1.2 spread: [0, 150, 240] px/s lateral with the
  // pop raised to -190 (was [0, 120, 180] / -160) — the higher arc carries
  // the scattered children over ridge walls and crater rims (~130px reach
  // instead of ~64), making 集束彈 the anti-cover shell: it rains over
  // exactly the obstacles the 穿甲彈 tunnels through. Child 1 still
  // launches STRAIGHT UP (vx 0) — it rises and falls back onto the impact
  // point, preserving controller ruling R10's "a direct hit always
  // connects"; children 2/3 launch sideways with the side drawn from rng()
  // (one call each). Cluster does not detonate at its own impact — the
  // brief's settlement clause covers only the three children — so the
  // children are the cluster's entire damage delivery (dmg12/radius35).
  var CLUSTER_VX = [0, 150, 240];
  var CLUSTER_VY = -190;

  // Crater radius per weapon (D1: the ground deforms where shells land).
  // Deliberately NOT on LIST — the brief pins the LIST literal verbatim —
  // and not the blast radius: piercing shells gouge a narrow hole (22)
  // while heavy shells shovel out a wide one (85).
  var CARVE_R = { normal: 45, heavy: 85, pierce: 22, cluster: 18 };

  function weapon(key) {
    var w = LIST[key];
    if (!w) { throw new Error('CC.Weapons: unknown weapon "' + key + '"'); }
    return w;
  }

  function carveRadius(key) {
    weapon(key); // unknown keys throw the standard error
    return CARVE_R[key];
  }

  /**
   * explosions(key, impact, rng, wind) -> {points, lobs}
   * Every explosion point a shell of `key` produces when it lands at
   * `impact`, plus the flights that delivered them:
   *   normal/heavy/pierce -> points [impact], lobs [] (the shell's own
   *     flight is the view's business).
   *   cluster -> the three bomblets. Each is launched from the impact and
   *     integrated to its FIRST REAL terrain contact (Ballistics.lob —
   *     wind applies): child 1 straight up, back onto the impact (R10);
   *     children 2/3 sideways at ±CLUSTER_VX with the side drawn from
   *     rng() (one call each). points[i] is lobs[i].impact. rng is a
   *     () -> [0,1) source (Math.random in play); injectable so tests
   *     pin the sides deterministically.
   * Needs CC.Terrain + CC.Ballistics (loaded first per index.html order).
   */
  function explosions(key, impact, rng, wind) {
    var w = weapon(key);
    if (!w.children) {
      return { points: [{ x: impact.x, y: impact.y }], lobs: [] };
    }
    var points = [];
    var lobs = [];
    for (var i = 0; i < w.children; i++) {
      var speed = CLUSTER_VX[i];
      var vx = i > 0 ? (rng() < 0.5 ? -1 : 1) * speed : speed; // child 1: fixed, no rng
      var flight = CC.Ballistics.lob(impact.x, impact.y, vx, CLUSTER_VY, wind || 0);
      points.push(flight.impact);
      lobs.push(flight);
    }
    return { points: points, lobs: lobs };
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

  CC.Weapons = {
    LIST: LIST,
    explosions: explosions,
    settle: settle,
    carveRadius: carveRadius,
    PENETRATE_PX: PENETRATE_PX
  };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Weapons;
  }
})(typeof window !== 'undefined' ? window : globalThis);
