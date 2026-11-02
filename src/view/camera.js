/* CC.Camera — battle camera: follow-zoom state machine + impact shake
 * (browser global). Pure presentation: it reads a small context each frame
 * and produces one world->screen transform. The HUD never passes through
 * it (the scene applies the transform to world layers only, HUD draws
 * after the transform is popped).
 *
 *   AIM     : 1.15x eased onto the active cannon (reads as "your gun")
 *   FLIGHT  : 1.6x chasing the shell with velocity lookahead
 *   IMPACT  : zoom punch + decaying shake, strength scaled by the damage
 *   RESOLVE : eases back to the full 1.0x field view
 *
 * The view rect is always clamped inside the 1600x900 world and zoom is
 * always >= 1, so the letterboxed canvas never shows out-of-world gaps.
 */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  var WORLD_W = 1600;
  var WORLD_H = 900;

  var ZOOM_AIM = 1.15;
  var ZOOM_FLY = 1.6;
  var ZOOM_HIT = 1.85;    // the impact punch peak
  var ZOOM_IDLE = 1.0;

  var EASE = 5;           // 1/s lerp rate toward targets
  var PUNCH_DECAY = 3.2;  // 1/s exponential decay of the punch zoom
  var SHAKE_DECAY = 6.5;  // 1/s exponential decay of the shake amplitude
  var LOOKAHEAD = 0.28;   // s of shell velocity added to the chase target
  var LOOKAHEAD_MAX = 200; // px cap on the lookahead offset
  var FOCUS_LIFT = 70;    // aim focus sits this many px above the cannon

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function create() {
    var cam = {
      zoom: ZOOM_IDLE,
      cx: WORLD_W / 2,
      cy: WORLD_H / 2,
      punch: 0,   // extra zoom from the last impact, decays away
      shake: 0,   // px amplitude, decays away
      t: 0
    };

    // Chase/aim target -> clamped center for the CURRENT zoom.
    function clampCenter(cx, cy, z) {
      var hw = WORLD_W / (2 * z);
      var hh = WORLD_H / (2 * z);
      return {
        x: clamp(cx, hw, WORLD_W - hw),
        y: clamp(cy, hh, WORLD_H - hh)
      };
    }

    /**
     * kick(strength01) — impact response. strength01 0..1 scales the zoom
     * punch and the shake (the scene passes dmg / 45).
     */
    cam.kick = function (strength01) {
      var s = clamp(strength01, 0, 1);
      cam.punch = Math.max(cam.punch, 0.35 + 0.4 * s);
      cam.shake = Math.max(cam.shake, 5 + 16 * s);
    };

    /**
     * update(dt, ctxState) — advance the state machine one fixed step.
     * ctxState: { state, focus {x,y} (active cannon), shell {x,y,vx,vy} | null }
     */
    cam.update = function (dt, s) {
      cam.t += dt;
      cam.punch *= Math.exp(-PUNCH_DECAY * dt);
      cam.shake *= Math.exp(-SHAKE_DECAY * dt);
      if (cam.punch < 0.01) { cam.punch = 0; }
      if (cam.shake < 0.15) { cam.shake = 0; }

      var targetZoom;
      var target;
      if (s.state === 'FLIGHT' && s.shell) {
        targetZoom = ZOOM_FLY;
        var lx = clamp(s.shell.vx * LOOKAHEAD, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
        var ly = clamp(s.shell.vy * LOOKAHEAD, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
        target = clampCenter(s.shell.x + lx, s.shell.y + ly, targetZoom);
      } else if (s.state === 'AIM' || s.state === 'CHARGE' || s.state === 'SUDDEN') {
        targetZoom = ZOOM_AIM;
        target = s.focus
          ? clampCenter(s.focus.x, s.focus.y - FOCUS_LIFT, targetZoom)
          : clampCenter(WORLD_W / 2, WORLD_H / 2, targetZoom);
      } else { // RESOLVE / OVER / anything else: the whole field
        targetZoom = ZOOM_IDLE;
        target = clampCenter(WORLD_W / 2, WORLD_H / 2, targetZoom);
      }

      var k = 1 - Math.exp(-EASE * dt);
      var effZoom = targetZoom + cam.punch; // the punch rides on the state zoom
      cam.zoom += (effZoom - cam.zoom) * k;
      // keep the view legal at the CURRENT (eased) zoom
      var c = clampCenter(cam.cx, cam.cy, cam.zoom);
      cam.cx += (target.x - c.x) * k;
      cam.cy += (target.y - c.y) * k;
      c = clampCenter(cam.cx, cam.cy, cam.zoom);
      cam.cx = c.x;
      cam.cy = c.y;
    };

    /**
     * apply(ctx) — push the world transform (call inside ctx.save()).
     */
    cam.apply = function (ctx) {
      var sx = 0;
      var sy = 0;
      if (cam.shake > 0) {
        sx = Math.sin(cam.t * 47.3) * cam.shake;
        sy = Math.sin(cam.t * 35.7 + 1.7) * cam.shake * 0.7;
      }
      ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.cx + sx, -cam.cy + sy);
    };

    /** Snapshot for tests/debug. */
    cam.state = function () {
      return { zoom: cam.zoom, cx: cam.cx, cy: cam.cy, shake: cam.shake };
    };

    return cam;
  }

  CC.Camera = { create: create, WORLD_W: WORLD_W, WORLD_H: WORLD_H };
})(typeof window !== 'undefined' ? window : globalThis);
