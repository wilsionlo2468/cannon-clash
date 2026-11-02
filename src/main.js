/* Game entry — fixed-step simulation (60 Hz) driven by requestAnimationFrame.
 * Wires input, scene flow and audio together; all gameplay lives in
 * CC.Scenes (single entry point Scenes.set). */
(function () {
  'use strict';

  var CC = window.CC;
  var STEP = 1 / 60;    // simulation timestep in seconds
  var MAX_STEPS = 5;    // cap catch-up steps after a stall (spiral-of-death guard)

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  function fail(err) {
    console.error(err);
    ctx.fillStyle = '#ff5a5a';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Asset load failed: ' + ((err && err.message) || err),
      canvas.width / 2, canvas.height / 2);
  }

  function start(imgs) {
    var input = CC.Input.create();
    input.attach();
    CC.Scenes.init({ canvas: canvas, ctx: ctx, imgs: imgs, input: input });
    CC.Scenes.set('title');

    // Audio context must be created inside a user gesture (autoplay
    // policy); keydown already unlocks via input, pointer covers mouse.
    window.addEventListener('pointerdown', function () { CC.Audio.unlock(); });

    var last = performance.now();
    var acc = 0;

    function frame(now) {
      acc += (now - last) / 1000;
      last = now;
      var steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        CC.Scenes.update(STEP);
        acc -= STEP;
        steps += 1;
      }
      if (acc >= STEP) { acc = 0; } // drop backlog after a long stall
      CC.Scenes.draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  CC.Loader.load(CC.Loader.MANIFEST).then(start, fail);
})();
