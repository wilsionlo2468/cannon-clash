/* CC.Loader — image preloading (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Manifest keys are fixed by the design spec — do not rename.
  // Paths are relative to index.html (repo root).
  var MANIFEST = {
    backdrop:     'assets/art/backdrop.png',
    layerFar:     'assets/art/layer-far.png',
    layerMid:     'assets/art/layer-mid.png',
    layerTerrain: 'assets/art/layer-terrain.png',
    baseRed:      'assets/art/cannon-base-red.png',
    barrelRed:    'assets/art/cannon-barrel-red.png',
    baseBlue:     'assets/art/cannon-base-blue.png',
    barrelBlue:   'assets/art/cannon-barrel-blue.png',
    shellNormal:  'assets/art/shell-normal.png',
    shellHeavy:   'assets/art/shell-heavy.png',
    shellRivet:   'assets/art/shell-rivet.png',
    shellCluster: 'assets/art/shell-cluster.png',
    crate:        'assets/art/crate.png',
    keyart:       'assets/art/keyart-v2.png',
    logo:         'assets/art/logo-title.png',
    panelBlue:    'assets/art/panel-blue.png',
    healthbarRed: 'assets/art/hud-healthbar-red.png',
    gauge:        'assets/art/gauge-angle-power.png',
    leaderboard:  'assets/art/leaderboard-medals.png',
    vfxSpark:     'assets/art/vfx-spark.png',
    vfxFlash:     'assets/art/vfx-flash.png',
    vfxSmoke:     'assets/art/vfx-smoke.png',
    crater:       'assets/art/crater.png',
  };

  function loadImage(path) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('CC.Loader: failed to load ' + path)); };
      img.src = path;
    });
  }

  /**
   * load(manifest) -> Promise<{[key]: HTMLImageElement}>
   * Resolves once every image in the manifest ({key: path}) is loaded;
   * rejects on the first failure.
   */
  function load(manifest) {
    var imgs = {};
    var jobs = Object.keys(manifest).map(function (key) {
      return loadImage(manifest[key]).then(function (img) { imgs[key] = img; });
    });
    return Promise.all(jobs).then(function () { return imgs; });
  }

  CC.Loader = { MANIFEST: MANIFEST, load: load };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.Loader;
  }
})(typeof window !== 'undefined' ? window : globalThis);
