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

  /* ------------------------------------------------------------------ *
   *  臨時演示場景（TEMPORARY DEMO — task 11 replaces this whole scene   *
   *  flow with the real match UI). F fires one demo shell from P1:      *
   *  muzzle flash -> flight -> terrain impact -> explosion -> crater    *
   *  -> last-shot aim assist. Rendering only; no match state involved.  *
   * ------------------------------------------------------------------ */

  // Pinned stances (CC.Cannon.STANCES); idle elevation is the core default 45.
  var CANNONS = {
    P1: { x: 250, y: 400, side: 'P1', angle: 45 },
    P2: { x: 1300, y: 445, side: 'P2', angle: 45 }
  };

  // The demo shot's fixed parameters (P1 fires right). Documented so the
  // expected landing point is reproducible during hand verification.
  var DEMO_SHOT = { side: 'P1', angle: 50, power: 55, wind: 0, type: 'normal' };
  var MUZZLE_FLASH_TIME = 0.12; // seconds the muzzle flash shows
  var EXPLOSION_TIME = 0.5;     // seconds one blast effect lives (Effects pin)

  function start(imgs) {
    var simTime = 0; // logical time, advanced only by fixed steps
    var acc = 0;
    var last = performance.now();

    // Demo scene state -------------------------------------------------
    var demo = {
      phase: 'idle',   // 'idle' | 'flight'
      t0: 0,           // simTime the current phase started
      shot: null,      // {points, impact, flight} while in flight
      flash: null,     // {x, y, t0} muzzle flash
      blasts: [],      // [{x, y, t0}] live explosion effects
      craters: [],     // [{x, y}] persistent scorch decals
      last: null       // {points, impact} aim assist for the previous shot
    };

    // Fire one demo shell: integrate from the muzzle, truncate the flight
    // at the first terrain contact (view-side rule: Ballistics + Terrain.hit).
    function fireDemo() {
      if (demo.phase !== 'idle') { return; }
      var gun = CANNONS[DEMO_SHOT.side];
      gun.angle = DEMO_SHOT.angle; // barrel follows the shot being fired
      var m = CC.Sprites.muzzle(DEMO_SHOT.side, gun.x, gun.y, DEMO_SHOT.angle);
      var sim = CC.Ballistics.simulate(m.x, m.y, DEMO_SHOT.angle, DEMO_SHOT.power, DEMO_SHOT.wind);
      var points = sim.points;
      var impact = null;
      for (var i = 1; i < points.length; i++) {
        var hit = CC.Terrain.hit(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
        if (hit) {
          impact = hit;
          points = points.slice(0, i);
          points.push(hit);
          break;
        }
      }
      if (!impact) { impact = sim.impact || points[points.length - 1]; }
      demo.flash = { x: m.x, y: m.y, t0: simTime };
      demo.shot = { points: points, impact: impact, flight: (points.length - 1) * STEP };
      demo.phase = 'flight';
      demo.t0 = simTime;
    }

    function landShot() {
      var impact = demo.shot.impact;
      demo.blasts.push({ x: impact.x, y: impact.y, t0: simTime });
      demo.craters.push({ x: impact.x, y: impact.y });
      demo.last = { points: demo.shot.points, impact: impact };
      demo.shot = null;
      demo.phase = 'idle';
    }

    function update(dt) {
      simTime += dt;
      if (demo.phase === 'flight' && simTime - demo.t0 >= demo.shot.flight) {
        landShot();
      }
      // retire finished blasts (craters/lastShot persist until the next shot)
      for (var i = demo.blasts.length - 1; i >= 0; i--) {
        if (simTime - demo.blasts[i].t0 >= EXPLOSION_TIME) {
          demo.blasts.splice(i, 1);
        }
      }
    }

    function drawMuzzleFlash() {
      if (!demo.flash) { return; }
      var age = simTime - demo.flash.t0;
      if (age < 0 || age >= MUZZLE_FLASH_TIME) { return; }
      var p = age / MUZZLE_FLASH_TIME;
      var img = imgs.vfxFlash;
      if (!img) { return; }
      var s = 0.2 + 0.25 * p;
      var w = img.width * s;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(img, demo.flash.x - w / 2, demo.flash.y - w / 2, w, w);
      ctx.restore();
    }

    function drawShell() {
      var pts = demo.shot.points;
      var i = Math.min(pts.length - 1, Math.floor((simTime - demo.t0) / STEP));
      var a = pts[Math.max(0, i - 1)];
      var b = pts[Math.min(pts.length - 1, i + 1)];
      var angle = Math.atan2(b.y - a.y, b.x - a.x);
      CC.Sprites.drawShell(ctx, imgs, { x: pts[i].x, y: pts[i].y, type: DEMO_SHOT.type, angle: angle });
    }

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      CC.Layers.draw(ctx, imgs, simTime);
      for (var i = 0; i < demo.craters.length; i++) {
        CC.Effects.crater(ctx, imgs, demo.craters[i].x, demo.craters[i].y);
      }
      CC.Sprites.drawCannon(ctx, imgs, CANNONS.P1);
      CC.Sprites.drawCannon(ctx, imgs, CANNONS.P2);
      if (demo.phase === 'flight') { drawShell(); }
      for (var j = 0; j < demo.blasts.length; j++) {
        CC.Effects.explosion(ctx, imgs, demo.blasts[j].x, demo.blasts[j].y, simTime - demo.blasts[j].t0);
      }
      drawMuzzleFlash();
      if (demo.last) {
        CC.Effects.lastShot(ctx, demo.last.points, demo.last.impact);
      }
      // demo hint (temporary — task 11 replaces the scene flow)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('F = 發射演示彈（臨時演示，任務 11 替換）', 16, 28);
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

    window.addEventListener('keydown', function (e) {
      if ((e.key === 'f' || e.key === 'F') && !e.repeat) { fireDemo(); }
    });

    requestAnimationFrame(frame);
  }

  CC.Loader.load(CC.Loader.MANIFEST).then(start, fail);
})();
