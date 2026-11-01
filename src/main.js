/* Game entry — fixed-step simulation (60 Hz) driven by requestAnimationFrame. */
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
    var simTime = 0; // logical time, advanced only by fixed steps
    var acc = 0;
    var last = performance.now();

    function update(dt) {
      // Gameplay systems arrive in later tasks; the loop advances logical time.
      simTime += dt;
    }

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      CC.Layers.draw(ctx, imgs, simTime);
    }

    function frame(now) {
      acc += (now - last) / 1000;
      last = now;
      var steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        update(STEP);
        acc -= STEP;
        steps += 1;
      }
      if (acc >= STEP) { acc = 0; } // drop backlog after a long stall
      render();
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  CC.Loader.load(CC.Loader.MANIFEST).then(start, fail);
})();
