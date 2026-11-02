/* CC.Layers — layered parallax scene composition (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Bands in draw order (back to front).
  // amplitude: max horizontal drift as a fraction of the canvas width
  // period: drift cycle in seconds
  // invert: flip phase so the band moves opposite its neighbours
  var BANDS = [
    { key: 'backdrop',     amplitude: 0.006, period: 30, invert: false },
    { key: 'layerFar',     amplitude: 0.014, period: 22, invert: false },
    { key: 'layerMid',     amplitude: 0.028, period: 15, invert: true  },
    { key: 'layerTerrain', amplitude: 0,     period: 0,  invert: false },
  ];

  // dx = A * sin(t / period * 2*pi), A in pixels.
  function driftX(band, t, width) {
    if (!band.period) { return 0; }
    var dx = band.amplitude * width * Math.sin((t / band.period) * Math.PI * 2);
    return band.invert ? -dx : dx;
  }

  // Draw one band horizontally tiled and bottom-aligned, shifted by dx.
  // Two copies always cover the viewport because |dx| < image width.
  function drawBand(ctx, img, dx) {
    var w = img.width;
    var y = ctx.canvas.height - img.height;
    var x = dx % w;
    if (x > 0) { x -= w; }
    ctx.drawImage(img, x, y);
    if (x + w < ctx.canvas.width) {
      ctx.drawImage(img, x + w, y);
    }
  }

  /**
   * draw(ctx, imgs, t, opts) — paint the full layered scene at logical
   * time t (seconds). imgs: {bandKey: HTMLImageElement} as produced by
   * CC.Loader.load. opts.deform: draw the terrain band CLIPPED BY THE
   * LIVE HEIGHTFIELD (battle only) — the art keeps its look while carved
   * craters cut real holes into it, edged with a dark lip. Menu scenes
   * omit opts and get the pristine composition.
   */
  function draw(ctx, imgs, t, opts) {
    for (var i = 0; i < BANDS.length; i++) {
      var band = BANDS[i];
      var img = imgs[band.key];
      if (!img) { continue; }
      if (opts && opts.deform && band.key === 'layerTerrain') {
        drawDeformedTerrain(ctx, img, t);
        continue;
      }
      drawBand(ctx, img, driftX(band, t, ctx.canvas.width));
    }
  }

  // The playable terrain: the art tiled bottom-aligned, clipped to
  // "below the heightfield surface", plus a dark lip stroked along that
  // surface so fresh cut edges read as broken ground. The pristine
  // heightfield reproduces the pinned polyline the art was drawn against,
  // so undeformed terrain looks exactly like the unclipped band.
  function drawDeformedTerrain(ctx, img, t) {
    var s = CC.Terrain.samples();
    var H = s.H;
    var step = s.step;
    var W = ctx.canvas.width;
    var Ht = ctx.canvas.height;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H[0]);
    for (var i = 1; i < H.length; i++) {
      ctx.lineTo(i * step, H[i]);
    }
    ctx.lineTo(W, Ht);
    ctx.lineTo(0, Ht);
    ctx.closePath();
    ctx.clip();
    drawBand(ctx, img, driftX(BANDS[3], t, W)); // amplitude 0: no drift
    ctx.restore();

    // surface lip: one dark pass along the heightfield line
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 20, 14, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, H[0]);
    for (var j = 1; j < H.length; j++) {
      ctx.lineTo(j * step, H[j]);
    }
    ctx.stroke();
    ctx.restore();
  }

  CC.Layers = { BANDS: BANDS, draw: draw };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Layers;
  }
})(typeof window !== 'undefined' ? window : globalThis);
