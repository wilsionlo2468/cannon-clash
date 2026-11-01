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
  var DEMO_SHOT = { side: 'P1', angle: 50, power: 55, wind: 0 };
  var MUZZLE_FLASH_TIME = 0.12; // seconds the muzzle flash shows
  var EXPLOSION_TIME = 0.5;     // seconds one blast effect lives (Effects pin)
  var RESOLVE_PAUSE = 1.2;      // seconds (core hands the resolve pause to the view)

  /* ------------------------------------------------------------------ *
   *  HUD demo stand-in — shape-compatible with the CC.Match / CC.Cannon *
   *  fields CC.HUD reads (p1/p2 hp/angle/power/weapon/ammo, turn,      *
   *  round, wind, timer, state). Task 11 replaces this with the real   *
   *  match object; the keys below are demo-only.                       *
   * ------------------------------------------------------------------ */
  function fullAmmo() {
    var ammo = {};
    for (var key in CC.Weapons.LIST) { ammo[key] = CC.Weapons.LIST[key].count; }
    return ammo;
  }

  var demoMatch = {
    state: 'AIM',
    turn: 'P1',
    round: 1,
    wind: Math.floor(Math.random() * 11) - 5,
    timer: 30,
    p1: { hp: 100, angle: 45, power: 0, weapon: 'normal', ammo: fullAmmo() },
    p2: { hp: 100, angle: 45, power: 0, weapon: 'normal', ammo: fullAmmo() }
  };
  var resolveAt = 0; // simTime the RESOLVE pause ends (demo next())

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
      demoMatch.p1.angle = DEMO_SHOT.angle;
      var type = demoMatch.p1.weapon; // the selected shell is the one that flies
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
      demo.shot = { points: points, impact: impact, flight: (points.length - 1) * STEP, type: type };
      demo.phase = 'flight';
      demo.t0 = simTime;
      demoMatch.state = 'FLIGHT';
    }

    function landShot() {
      var impact = demo.shot.impact;
      demo.blasts.push({ x: impact.x, y: impact.y, t0: simTime });
      demo.craters.push({ x: impact.x, y: impact.y });
      demo.last = { points: demo.shot.points, impact: impact };
      demo.shot = null;
      demo.phase = 'idle';
      demoMatch.state = 'RESOLVE';
      resolveAt = simTime + RESOLVE_PAUSE;
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
      // HUD demo clock + charge ramp + resolve pause (demo stand-in for
      // CC.Match.tick / startCharge / next — task 11 wires the real ones)
      var st = demoMatch.state;
      if ((st === 'AIM' || st === 'CHARGE') && demoMatch.timer > 0) {
        demoMatch.timer = Math.max(0, demoMatch.timer - dt);
        if (demoMatch.timer === 0) { demoMatch.timer = 30; } // demo loop: no auto-fire machinery here
      }
      if (st === 'CHARGE') {
        var charger = demoMatch[demoMatch.turn.toLowerCase()];
        charger.power = Math.min(100, charger.power + 60 * dt);
      }
      if (st === 'RESOLVE' && simTime >= resolveAt) {
        demoMatch.turn = demoMatch.turn === 'P1' ? 'P2' : 'P1';
        demoMatch.round += 1;
        demoMatch.wind = Math.floor(Math.random() * 11) - 5; // core's uniform -5..+5 roll
        demoMatch.timer = 30;
        demoMatch.state = (demoMatch.p1.hp === 0 && demoMatch.p2.hp === 0) ? 'SUDDEN' : 'AIM';
      }
      // sprites follow the demo match state (single source of truth)
      CANNONS.P1.angle = demoMatch.p1.angle;
      CANNONS.P2.angle = demoMatch.p2.angle;
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
      CC.Sprites.drawShell(ctx, imgs, { x: pts[i].x, y: pts[i].y, type: demo.shot.type, angle: angle });
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
      CC.HUD.draw(ctx, imgs, demoMatch, simTime);
      // demo hints (temporary — task 11 replaces the scene flow; moved
      // below the HUD's left bar/weapon line)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('臨時演示（任務 11 替換）：F 發射 W 武器 A/D 仰角 空白鍵蓄力', 16, 192);
      ctx.fillText('G 傷害藍方 H 傷害紅方 B 重置血量 T 限時警告', 16, 214);
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

    // Demo keys (temporary — task 11's input layer replaces them).
    // A/D: elevation of the side to move; W: cycle its weapon; G/H: 15
    // damage to blue/red; B: reset both HP; T: jump into the warning
    // window; hold Space: charge (release keeps the power, F fires it).
    window.addEventListener('keydown', function (e) {
      var side = demoMatch[demoMatch.turn.toLowerCase()];
      switch (e.key) {
        case 'f': case 'F':
          if (!e.repeat) { fireDemo(); }
          break;
        case 'a': case 'A':
          side.angle = Math.max(0, side.angle - 1);
          break;
        case 'd': case 'D':
          side.angle = Math.min(85, side.angle + 1);
          break;
        case 'w': case 'W': {
          var keys = Object.keys(CC.Weapons.LIST);
          var i = keys.indexOf(side.weapon);
          side.weapon = keys[(i + 1) % keys.length];
          break;
        }
        case 'g': case 'G':
          demoMatch.p2.hp = Math.max(0, demoMatch.p2.hp - 15);
          break;
        case 'h': case 'H':
          demoMatch.p1.hp = Math.max(0, demoMatch.p1.hp - 15);
          break;
        case 'b': case 'B':
          demoMatch.p1.hp = 100;
          demoMatch.p2.hp = 100;
          demoMatch.state = 'AIM';
          demoMatch.timer = 30;
          break;
        case 't': case 'T':
          if (demoMatch.state === 'AIM' || demoMatch.state === 'CHARGE') {
            demoMatch.timer = Math.min(demoMatch.timer, 4);
          }
          break;
        case ' ':
          e.preventDefault();
          if (!e.repeat && demoMatch.state === 'AIM') { demoMatch.state = 'CHARGE'; }
          break;
      }
    });

    window.addEventListener('keyup', function (e) {
      if (e.key === ' ' && demoMatch.state === 'CHARGE') {
        demoMatch.state = 'AIM'; // keep the charged power, F fires it
      }
    });

    requestAnimationFrame(frame);
  }

  CC.Loader.load(CC.Loader.MANIFEST).then(start, fail);
})();
