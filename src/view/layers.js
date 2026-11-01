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
   * draw(ctx, imgs, t) — paint the full layered scene at logical time t (seconds).
   * imgs: {bandKey: HTMLImageElement} as produced by CC.Loader.load.
   */
  function draw(ctx, imgs, t) {
    for (var i = 0; i < BANDS.length; i++) {
      var img = imgs[BANDS[i].key];
      if (!img) { continue; }
      drawBand(ctx, img, driftX(BANDS[i], t, ctx.canvas.width));
    }
  }

  CC.Layers = { BANDS: BANDS, draw: draw };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Layers;
  }
})(typeof window !== 'undefined' ? window : globalThis);
