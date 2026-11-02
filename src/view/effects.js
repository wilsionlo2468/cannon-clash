/* CC.Effects — explosion, crater decal and last-shot aim assist (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Values pinned by the task brief: the flash+smoke window is 0.5s with the
  // flash scaling 0.4 -> 1.7 while fading out; the crater decal is 11% of the
  // canvas wide. Spark gravity matches the flight model (CC.Ballistics G).
  var DURATION = 0.5;
  var FLASH_FROM = 0.4;
  var FLASH_TO = 1.7;
  var CRATER_WIDTH = 0.11; // fraction of canvas width
  var SPARK_G = 900;

  var FLASH_KEY = 'vfxFlash';
  var SMOKE_KEY = 'vfxSmoke';
  var SPARK_KEY = 'vfxSpark';
  var CRATER_KEY = 'crater';

  // Smoke plume: rises ~80px while growing and fading, released slightly
  // above the blast so it reads as drifting off the fireball.
  var SMOKE_RISE = 80;
  var SMOKE_LIFT = 26;
  var SMOKE_FROM = 0.35;
  var SMOKE_GROW = 0.45;
  var SMOKE_ALPHA = 0.85;

  // Last-shot aim assist (option B): dashed trajectory trail + diamond on
  // the landing point, no live prediction arc. The polyline is thinned to a
  // capped number of segments — the dash pattern hides the thinning.
  var TRAIL_COLOR = 'rgba(255, 214, 130, 0.85)';
  var TRAIL_MAX_SEGMENTS = 40;
  var DASH = [10, 8];
  var DIAMOND_R = 9;

  // 1 -> 0, quadratic ease-out (fast start, soft landing) for scale/rise.
  function easeOut(p) {
    return 1 - (1 - p) * (1 - p);
  }

  // Deterministic seed from the explosion point: explosion() is stateless and
  // redrawn every frame, so the 6..10 spark scatter must not re-roll per frame.
  function seedOf(x, y) {
    return ((x * 73856093) ^ (y * 19349663)) >>> 0;
  }

  // Mulberry32 — tiny deterministic PRNG, enough for effect scatter.
  function makeRng(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // One additive sprite centered at (x, y): drawn size = natural * scale.
  function blit(ctx, img, x, y, scale, alpha, composite) {
    var w = img.width * scale;
    var h = img.height * scale;
    ctx.save();
    if (composite) { ctx.globalCompositeOperation = composite; }
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  /**
   * explosion(ctx, imgs, x, y, t) — the blast at (x, y), t seconds in.
   * Lives t in [0, 0.5s]: vfxFlash scales 0.4 -> 1.7 (ease-out) while fading;
   * one vfxSmoke plume rises, grows and fades; 6..10 vfxSpark particles toss
   * ballistically outward. Deterministic in (x, y): safe to call every frame
   * with the same t. Outside the window (incl. negative t): draws nothing.
   */
  function explosion(ctx, imgs, x, y, t) {
    if (!(t >= 0) || t >= DURATION) { return; }
    var p = t / DURATION;
    var flash = imgs[FLASH_KEY];
    var smoke = imgs[SMOKE_KEY];
    var spark = imgs[SPARK_KEY];

    if (flash) {
      blit(ctx, flash, x, y, FLASH_FROM + (FLASH_TO - FLASH_FROM) * easeOut(p), 1 - p, 'lighter');
    }
    if (smoke) {
      var lift = SMOKE_LIFT + SMOKE_RISE * easeOut(p);
      blit(ctx, smoke, x, y - lift, SMOKE_FROM + SMOKE_GROW * p, SMOKE_ALPHA * (1 - p));
    }
    if (spark) {
      var rng = makeRng(seedOf(x | 0, y | 0));
      var count = 6 + Math.floor(rng() * 5); // 6..10
      for (var i = 0; i < count; i++) {
        var ang = -Math.PI / 2 + (rng() - 0.5) * 2.4; // spread ~+/-69 deg around up
        var speed = 140 + rng() * 160;
        var px = x + Math.cos(ang) * speed * t;
        var py = y + Math.sin(ang) * speed * t + 0.5 * SPARK_G * t * t;
        blit(ctx, spark, px, py, 0.07 + rng() * 0.05, 1 - p, 'lighter');
      }
    }
  }

  /**
   * crater(ctx, imgs, x, y, alpha) — scorch decal centered on the impact
   * point, 11% of the canvas wide (176px at the 1600 field), sunk 10% of
   * its height so the ellipse straddles the terrain surface line.
   * Persistent: the scene keeps its own crater list and calls this every
   * frame for each one. alpha (default 1) tints it down — with real
   * carve holes in the heightfield the decal is now a scorch MARK, not
   * the hole itself.
   */
  function crater(ctx, imgs, x, y, alpha) {
    var img = imgs[CRATER_KEY];
    if (!img) { return; }
    var w = ctx.canvas.width * CRATER_WIDTH;
    var h = w * img.height / img.width;
    ctx.save();
    if (alpha !== undefined && alpha < 1) { ctx.globalAlpha = alpha; }
    ctx.drawImage(img, x - w / 2, y - h / 2 + h * 0.1, w, h);
    ctx.restore();
  }

  /**
   * lastShot(ctx, points, impact) — aim assist option B: the previous
   * shot's trajectory as a dashed line plus a diamond marker on the landing
   * point. No live prediction arc. points is the flight sample list
   * (CC.Ballistics.simulate, truncated at the terrain hit by the caller);
   * impact may be null (then only the trail draws).
   */
  function lastShot(ctx, points, impact) {
    if (!points || points.length < 2) { return; }
    var stride = Math.max(1, Math.ceil((points.length - 1) / TRAIL_MAX_SEGMENTS));
    ctx.save();
    ctx.strokeStyle = TRAIL_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = stride; i < points.length - 1; i += stride) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    // always finish exactly on the final sample (the landing point)
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (impact) {
      ctx.beginPath();
      ctx.moveTo(impact.x, impact.y - DIAMOND_R);
      ctx.lineTo(impact.x + DIAMOND_R, impact.y);
      ctx.lineTo(impact.x, impact.y + DIAMOND_R);
      ctx.lineTo(impact.x - DIAMOND_R, impact.y);
      ctx.closePath();
      ctx.fillStyle = TRAIL_COLOR;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- *
  // Juice (Phase 5): flight trail, ground shadow, damage popups, hit
  // flash. All stateless-in-(args, t) like explosion() — the scene keeps
  // the timers and calls these every frame.
  var TRAIL_SEGMENTS = 16;   // how many recent flight samples glow
  var TRAIL_WIDTH = 3;
  var SHADOW_MAX = 18;       // shadow rx at ground level
  var SHADOW_MIN = 6;
  var SHADOW_FADE_H = 900;   // px of altitude at which the shadow vanishes
  var DMG_TIME = 0.9;        // s a damage number floats
  var DMG_RISE = 46;
  var HITFLASH_TIME = 0.32;

  /**
   * flightTrail(ctx, points, idx, color) — the glow behind the shell in
   * flight: the most recent TRAIL_SEGMENTS samples as a fading polyline.
   * color is the shooter's side color; idx is the current sample index.
   */
  function flightTrail(ctx, points, idx, color) {
    if (!points || points.length < 2) { return; }
    var from = Math.max(0, idx - TRAIL_SEGMENTS);
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = from + 1; i <= Math.min(idx, points.length - 1); i++) {
      var p = (i - from) / (Math.min(idx, points.length - 1) - from + 1);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.05 + 0.4 * p * p;
      ctx.lineWidth = TRAIL_WIDTH * (0.4 + 0.6 * p);
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * shellShadow(ctx, x, shellY, groundY) — soft ellipse on the ground
   * under the shell: smaller and fainter the higher it flies. groundY is
   * Terrain.heightAt(x) (the caller reads it).
   */
  function shellShadow(ctx, x, shellY, groundY) {
    var h = groundY - shellY;
    if (h <= 0 || h >= SHADOW_FADE_H) { return; }
    var p = h / SHADOW_FADE_H; // 0 at ground, ->1 high
    var rx = SHADOW_MAX + (SHADOW_MIN - SHADOW_MAX) * p;
    ctx.save();
    ctx.globalAlpha = 0.32 * (1 - p);
    ctx.fillStyle = 'rgba(10, 8, 8, 1)';
    ctx.beginPath();
    ctx.ellipse(x, groundY - 2, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * damageNumber(ctx, x, y, text, t) — a damage popup floating up from
   * the struck cannon. Lives DMG_TIME seconds; red, outlined, easing up.
   */
  function damageNumber(ctx, x, y, text, t) {
    if (!(t >= 0) || t >= DMG_TIME) { return; }
    var p = t / DMG_TIME;
    ctx.save();
    ctx.globalAlpha = 1 - p * p;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(10, 10, 14, 0.9)';
    ctx.fillStyle = '#ff5a48';
    var ty = y - DMG_RISE * easeOut(p);
    ctx.strokeText(text, x, ty);
    ctx.fillText(text, x, ty);
    ctx.restore();
  }

  /**
   * hitFlash(ctx, x, y, t) — a white burst over a cannon the moment a
   * blast connects with it. Lives HITFLASH_TIME seconds.
   */
  function hitFlash(ctx, x, y, t) {
    if (!(t >= 0) || t >= HITFLASH_TIME) { return; }
    var p = t / HITFLASH_TIME;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 * (1 - p);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y - 20, 26 + 26 * easeOut(p), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  CC.Effects = {
    explosion: explosion,
    crater: crater,
    lastShot: lastShot,
    flightTrail: flightTrail,
    shellShadow: shellShadow,
    damageNumber: damageNumber,
    hitFlash: hitFlash,
    DMG_TIME: DMG_TIME,
    HITFLASH_TIME: HITFLASH_TIME
  };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Effects;
  }
})(typeof window !== 'undefined' ? window : globalThis);
