/* CC.Sprites — cannon and shell sprite rendering (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Draw scale for the 512px cannon art. 0.32 puts the ~150px base comfortably
  // on the 260px pinned platforms (left 170..430, right 1170..1430); the shell
  // scale keeps the 194px ball art at a readable ~28px in flight.
  var CANNON_SCALE = 0.32;
  var SHELL_SCALE = 0.11;
  var IMG = 512; // cannon images are square 512x512

  // Barrel rotation pivot as a fraction of the barrel image, pinned verbatim
  // by the task brief: (14%,68%) for P1 / (86%,68%) for P2. The red art faces
  // right (breech left), the blue art faces left, so each side mounts its own
  // image at its own pivot and P1 rotates counter-clockwise (up-right) while
  // P2 rotates clockwise (up-left) for the same shared elevation angle.
  var BARREL_PIVOT = {
    P1: { x: 0.14, y: 0.68 },
    P2: { x: 0.86, y: 0.68 }
  };

  // Lowest opaque art row as a fraction of image height (measured from the
  // PNGs' alpha channels: base-red legs end at 454/512, base-blue at 448/512).
  // Anchoring THIS row to the stance line makes the base sit on the ground —
  // bottom-aligning the raw image would leave its transparent margin floating.
  var BASE_GROUND = { P1: 454 / IMG, P2: 448 / IMG };
  var BASE_SINK = 2; // px below the stance line, hides the anti-aliased feet

  // Muzzle offset from the barrel pivot as a fraction of image size (measured
  // from the art: red opening ~(485,251), blue ~(30,256)). P1's +x/-y is
  // mirrored for P2. Used to spawn flashes and shells at the barrel mouth.
  var MUZZLE_OFFSET = {
    P1: { x: 0.807, y: -0.19 },
    P2: { x: -0.801, y: -0.18 }
  };

  var SIDES = {
    P1: { base: 'baseRed', barrel: 'barrelRed' },
    P2: { base: 'baseBlue', barrel: 'barrelBlue' }
  };

  // Weapon key (CC.Weapons.LIST) -> loader manifest key.
  var SHELL_IMG = {
    normal: 'shellNormal',
    heavy: 'shellHeavy',
    pierce: 'shellRivet',
    cluster: 'shellCluster'
  };

  /**
   * muzzle(side, x, y, angleDeg) -> {x, y}
   * World position of the barrel mouth for a cannon at stance (x, y) with
   * the given elevation: the pivot-anchored muzzle offset rotated with the
   * barrel (P1 counter-clockwise, P2 clockwise, mirroring drawCannon).
   */
  function muzzle(side, x, y, angleDeg) {
    var off = MUZZLE_OFFSET[side];
    if (!off) { return { x: x, y: y }; }
    var rad = (side === 'P1' ? -1 : 1) * angleDeg * Math.PI / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var dx = off.x * IMG * CANNON_SCALE;
    var dy = off.y * IMG * CANNON_SCALE;
    return { x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos };
  }

  /**
   * drawCannon(ctx, imgs, c) — base seated on the ground + barrel rotated to
   * the elevation. c = {x, y, angle, side}: (x, y) is the pinned stance point
   * (the barrel pivot sits exactly there), angle is the shared 0..85
   * elevation in DEGREES, side is 'P1'|'P2'. Missing images are skipped
   * individually (same graceful degradation as CC.Layers.draw).
   */
  function drawCannon(ctx, imgs, c) {
    var side = SIDES[c.side];
    if (!side) { return; }
    var base = imgs[side.base];
    var barrel = imgs[side.barrel];
    var size = IMG * CANNON_SCALE;
    if (base) {
      // art-bottom row lands on the stance line (+sink), horizontally centered
      ctx.drawImage(base, c.x - size / 2, c.y + BASE_SINK - BASE_GROUND[c.side] * size, size, size);
    }
    if (barrel) {
      var pivot = BARREL_PIVOT[c.side];
      var rad = (c.side === 'P1' ? -1 : 1) * c.angle * Math.PI / 180;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(rad);
      ctx.drawImage(barrel, -pivot.x * size, -pivot.y * size, size, size);
      ctx.restore();
    }
  }

  /**
   * drawShell(ctx, imgs, s) — one shell in flight. s = {x, y, type, angle}:
   * (x, y) is the shell center, type is the CC.Weapons key ('normal',
   * 'heavy', 'pierce', 'cluster'), angle is the velocity heading in RADIANS
   * (atan2 of the flight direction — canvas-native, unlike the cannon's
   * degrees). Unknown type or missing image: skip silently.
   */
  function drawShell(ctx, imgs, s) {
    var img = imgs[SHELL_IMG[s.type]];
    if (!img) { return; }
    var d = img.width * SHELL_SCALE;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.drawImage(img, -d / 2, -d / 2, d, d);
    ctx.restore();
  }

  CC.Sprites = { drawCannon: drawCannon, drawShell: drawShell, muzzle: muzzle };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Sprites;
  }
})(typeof window !== 'undefined' ? window : globalThis);
