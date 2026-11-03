/* CC.Scenes — scene flow: TITLE -> (DIFFICULTY) -> BATTLE -> SETTLE ->
 * (auto rematch) / BOARDS. Single entry point set(name, params); the
 * active scene is also CC.Input's sink. Task-11 pins live here:
 * charge 0->100 over 1.6s, AI think delay 1.2s + 0.8s barrel tween,
 * settle auto-rematch after 3s, ESC to title immediate.
 */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Pinned view-side timings (task-11 brief / seam notes).
  var RESOLVE_PAUSE = 1.2;      // s, view-timed (core builds none in)
  var AI_THINK_DELAY = CC.AI.THINK_DELAY; // 1.2s pinned by core
  var AI_TWEEN_TIME = 0.8;      // s, barrel tween to the AI angle
  var SETTLE_AUTO = 3;          // s, automatic rematch
  var MUZZLE_FLASH_TIME = 0.12; // s the muzzle flash shows
  var FLASH_FROM = 0.3;         // muzzle flash scale range (self-drawn;
  var FLASH_TO = 0.6;           //  explosion blasts use Effects' 0.4->1.7)
  var TIMER_WARN_S = 5;         // beeping window
  var STEP = 1 / 60;            // flight sample spacing (Ballistics DT)

  var ANGLE_RATE = 40;   // deg/s, pinned by the brief
  var ANGLE_MAX = 85;
  var MOVE_RATE = 140;   // px/s while a walk key is held (budget 160 -> ~1.1s)
  var CRATE_W = 48;      // display width of the supply crate
  var BANNER_TIME = 1;   // s the turn banner shows
  var RECOIL_TIME = 0.18; // s the barrel kick plays after firing
  var RECOIL_PX = 8;      // px the cannon shifts back at the kick's peak

  // Per-side trail/tint colors (match the HUD's last-shot notches).
  var SIDE_COLOR = { P1: '#ff9a3d', P2: '#4fc3ff' };

  // Unified controls (both clusters drive whichever side holds the turn):
  //   A/D or ←/→  walk (AIM only, per-turn budget)
  //   W/S or ↑/↓  elevation
  //   SPACE hold→release  charge & fire (ping-pong curve, release = power)
  //   Q/E or Tab  cycle weapon (E/Tab forward, Q back)
  //   M mute / F fullscreen / ESC title — global

  function nowMs() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  var MENU_BG = 'rgba(10, 12, 18, 0.55)';
  var MENU_HI = '#ffdf8a';
  var MENU_LO = '#aeb6c2';
  var FONT_TITLE = 'bold 44px sans-serif';
  var FONT_ITEM = '26px sans-serif';
  var FONT_HINT = '16px sans-serif';
  var FONT_BANNER = 'bold 40px sans-serif';

  var S = {
    ctx: null,
    imgs: null,
    input: null,
    t: 0,          // logical scene time (seconds), advanced by update
    scene: null,   // active scene object
    name: '',
    // session-persistent bits that survive scene switches:
    names: { p1: '', p2: '' },         // editable on the title screen
    limit: true,                       // title toggle: 30s turn limit on/off
    streaks: { easy: 0, normal: 0, hell: 0 }, // session win streaks (per difficulty)
    pvpCombo: null,  // {name, streak} — current pair's combo streak (resets on a lineup change)
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function setSink(scene) { if (S.input) { S.input.setSink(scene); } }

  // Shared text helper: dark outline keeps labels readable over art.
  function label(ctx, text, x, y, font, fill, align) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 10, 14, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawBackdrop(ctx, t) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    CC.Layers.draw(ctx, S.imgs, t);
  }

  function menu(ctx, items, cursor, x, y, lh, selectedTag) {
    ctx.save();
    ctx.fillStyle = MENU_BG;
    var w = 460;
    var top = y - 34;
    ctx.fillRect(x - w / 2, top, w, items.length * lh + 18);
    ctx.restore();
    for (var i = 0; i < items.length; i++) {
      var text = items[i] + (i === cursor ? ' ◀' : '');
      label(ctx, text, x, y + i * lh, FONT_ITEM,
        i === cursor ? MENU_HI : MENU_LO);
    }
  }

  /* ==================================================================
   * TITLE — keyart + logo + menu; name entry (A-Z/0-9, <=6, Tab to
   * switch slot, Backspace to erase); 限時 toggle.
   * ================================================================== */
  var title = {
    cursor: 0,
    slot: 0, // active name-entry slot: 0 = P1, 1 = P2 (P2 hidden in ai mode memory)
    items: function () {
      return ['雙人對戰', '單人挑戰 AI', '排行榜', '限時：' + (S.limit ? '開' : '關')];
    },
    enter: function () {
      this.cursor = 0;
      this.slot = 0;
    },
    keyDown: function (key, e) {
      var n = this.items().length;
      if (key === 'ArrowUp') { this.cursor = (this.cursor + n - 1) % n; CC.Audio.play('click'); return; }
      if (key === 'ArrowDown') { this.cursor = (this.cursor + 1) % n; CC.Audio.play('click'); return; }
      if (key === 'Enter') {
        CC.Audio.play('click');
        if (this.cursor === 0) { set('battle', { mode: 'pvp' }); }
        else if (this.cursor === 1) { set('difficulty'); }
        else if (this.cursor === 2) { set('boards'); }
        else { S.limit = !S.limit; }
        return;
      }
      if (key === 'Tab') { this.slot = 1 - this.slot; e.preventDefault(); return; }
      if (key === 'Backspace') {
        var k = 'p' + (this.slot + 1);
        S.names[k] = S.names[k].slice(0, -1);
        return;
      }
      // name entry: A-Z/0-9 straight capture, <=6 chars, uppercase.
      // Returns true (consumed) so nothing else reacts — EXCEPT 'm'/'f':
      // those stay reserved for the global mute/fullscreen keys (spec
      // §9.1; final review — names simply cannot contain M/F).
      if (key.length === 1 && /[A-Za-z0-9]/.test(key) && key !== 'm' && key !== 'f') {
        var kk = 'p' + (this.slot + 1);
        if (S.names[kk].length < 6) { S.names[kk] += key.toUpperCase(); }
        return true;
      }
      return false;
    },
    update: function () { },
    draw: function (ctx) {
      drawBackdrop(ctx, S.t);
      var W = ctx.canvas.width;
      var H = ctx.canvas.height;
      if (S.imgs.keyart) {
        var img = S.imgs.keyart;
        var s = Math.max(W / img.width, H / img.height);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
        ctx.globalAlpha = 1;
      }
      if (S.imgs.logo) {
        var logo = S.imgs.logo;
        var lw = Math.min(620, logo.width);
        ctx.drawImage(logo, (W - lw) / 2, 40, lw, logo.height * lw / logo.width);
      }
      menu(ctx, this.items(), this.cursor, W / 2, H / 2 + 30, 56);
      // name entry row
      var ny = H - 46;
      label(ctx, '名字：', W / 2 - 330, ny, FONT_HINT, MENU_LO, 'right');
      var c1 = S.names.p1 + (this.slot === 0 ? '_' : '');
      var c2 = S.names.p2 + (this.slot === 1 ? '_' : '');
      label(ctx, 'P1 ' + c1, W / 2 - 240, ny, FONT_HINT, this.slot === 0 ? MENU_HI : MENU_LO, 'left');
      label(ctx, 'P2 ' + c2, W / 2 - 120, ny, FONT_HINT, this.slot === 1 ? MENU_HI : MENU_LO, 'left');
      label(ctx, 'Tab 切換輸入格 Backspace 刪字；上下鍵+Enter 選單', W / 2 + 120, ny, FONT_HINT, MENU_LO, 'left');
    }
  };

  /* ==================================================================
   * DIFFICULTY — the single-player sub-select (easy / normal / hell).
   * ================================================================== */
  var difficulty = {
    cursor: 1,
    keys: ['easy', 'normal', 'hell'],
    names: { easy: '簡單', normal: '普通', hell: '地獄' },
    enter: function () { this.cursor = 1; },
    keyDown: function (key) {
      var n = this.keys.length;
      if (key === 'ArrowUp' || key === 'ArrowLeft') { this.cursor = (this.cursor + n - 1) % n; CC.Audio.play('click'); return; }
      if (key === 'ArrowDown' || key === 'ArrowRight') { this.cursor = (this.cursor + 1) % n; CC.Audio.play('click'); return; }
      if (key === 'Enter') {
        CC.Audio.play('click');
        set('battle', { mode: 'ai', difficulty: this.keys[this.cursor] });
        return;
      }
      if (key === 'Escape') { set('title'); }
    },
    update: function () { },
    draw: function (ctx) {
      drawBackdrop(ctx, S.t);
      var W = ctx.canvas.width;
      var H = ctx.canvas.height;
      if (S.imgs.logo) {
        var lw = Math.min(520, S.imgs.logo.width);
        ctx.drawImage(S.imgs.logo, (W - lw) / 2, 60, lw, S.imgs.logo.height * lw / S.imgs.logo.width);
      }
      var items = this.keys.map(function (k) { return difficulty.names[k]; });
      menu(ctx, items, this.cursor, W / 2, H / 2 + 30, 56);
      label(ctx, '上下鍵+Enter 選擇，ESC 返回', W / 2, H - 40, FONT_HINT, MENU_LO);
    }
  };

  /* ==================================================================
   * BATTLE — the real match. View owns: flight integration + terrain
   * truncation, muzzle flashes, blasts, craters, last-shot trail, the
   * charge ramp, the AI turn (delay + tween), supply wiring, timer beeps.
   * ================================================================== */
  function battleFactory(params) {
    var mode = params.mode;
    var difficultyKey = params.difficulty || null;
    var human = mode === 'pvp' ? { P1: true, P2: true } : { P1: true, P2: false };
    // effective names: typed on the title screen, else the defaults
    // (self-decided, report-noted: PvP pair 'TEAM'/'TEAM', solo 'ACE')
    var NAMES = {
      p1: S.names.p1 || (mode === 'pvp' ? 'TEAM' : 'ACE'),
      p2: S.names.p2 || 'TEAM'
    };

    var p1 = CC.Cannon.create('P1');
    var p2 = CC.Cannon.create('P2');
    var match = CC.Match.create(
      { p1: p1, p2: p2 },
      {
        turnLimitSec: S.limit ? undefined : 0,
        rng: Math.random,
        streakKey: mode === 'ai' ? 'HUMAN' : null,
        streakSide: 'P1'
      }
    );

    var b = {
      match: match,
      mode: mode,
      difficulty: difficultyKey,
      // view-side effect state
      flight: null,    // {points, impact, t0, dur, type, by}
      blasts: [],      // [{x, y, t0}]
      craters: [],     // [{x, y}] persistent decals
      flashes: [],     // [{x, y, t0}] muzzle flashes
      trail: null,     // {points, impact} last-shot aim assist
      resolveAt: 0,
      lastBeepSec: -1,
      wantFire: false,
      chargeActive: false, // Space held and a charge is running
      chargeT: 0,          // charge duration in GAME time (exact release power)
      lastFrameMs: nowMs(),// wall-clock stamp of the last fixed step
      lastTurn: null,      // turn-banner tracking
      banner: null,        // {text, t0} — shown BANNER_TIME s at each turn start
      // juice state (Phase 5)
      cam: CC.Camera.create(),
      recoil: { P1: 0, P2: 0 }, // seconds of barrel kick left, per side
      dmgPops: [],         // [{x, y, text, t0}] damage numbers
      hitFlashes: [],      // [{x, y, t0}] white bursts on struck cannons
      childFlights: [],    // cluster bomblet replays {points, impact, by, startT, done}
      // AI turn state
      ai: null,        // {phase:'wait', at} | {phase:'tween', from, to, power, t0}
      over: false
    };

    function sideCannon(side) { return side === 'P2' ? p2 : p1; }
    function isAiTurn() { return mode === 'ai' && match.turn === 'P2'; }

    function cycleWeapon(c, dir) {
      var keys = Object.keys(CC.Weapons.LIST);
      var i = keys.indexOf(c.weapon);
      c.weapon = keys[(i + dir + keys.length) % keys.length];
      CC.Audio.play('click');
    }

    // Snapshot the shooter's selection BEFORE fire so the flown shell type
    // is known even when the clock's auto-fire (inside match.tick) fires.
    function snapshot() {
      var c = sideCannon(match.turn);
      var left = c.ammo[c.weapon];
      var usable = left === Infinity || left > 0;
      return { weapon: usable ? c.weapon : 'normal', side: match.turn };
    }

    // View-side flight: integrate from the cannon's MUZZLE — the shared
    // core origin (CC.Cannon.muzzle; the AI solver uses the same point,
    // so shots land where the solution aimed) — and truncate at the first
    // real terrain contact (Terrain.hit per segment), keeping the samples.
    function launchFlight(snap) {
      var c = sideCannon(snap.side);
      var m = CC.Cannon.muzzle(c);
      var sim = CC.Ballistics.simulate(m.x, m.y, snap.side === 'P2' ? 180 - c.angle : c.angle, c.power, match.wind, snap.weapon);
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
      b.flashes.push({ x: m.x, y: m.y, t0: S.t });
      b.flight = {
        points: points,
        impact: impact,
        t0: S.t,
        dur: (points.length - 1) * STEP,
        type: snap.weapon,
        by: snap.side
      };
      b.trail = null; // the old trail retires when a new shell flies
      b.recoil[snap.side] = RECOIL_TIME;
      CC.Audio.play('shot');
      CC.Audio.whistleStart();
    }

    function land() {
      var impact = b.flight.impact;
      b.blasts.push({ x: impact.x, y: impact.y, t0: S.t });
      b.craters.push({ x: impact.x, y: impact.y });
      var by = b.flight.by;
      b.trail = { points: b.flight.points, impact: impact };
      b.flight = null;
      CC.Audio.play('explosion');
      CC.Audio.whistleStop();
      var last = match.land(impact); // core settles damage, sets RESOLVE
      if (last) {
        CC.Supply.pickup(match, by, last.explosions);
        // impact response: camera punch+shake by the damage, hit feedback
        // on every cannon the blast actually connected with
        var total = last.dmg.P1 + last.dmg.P2;
        b.cam.kick(total > 0 ? Math.min(1, 0.35 + total / 60) : 0.18);
        if (total > 0) { CC.Audio.play('hit'); }
        for (var hi = 0; hi < last.hits.length; hi++) {
          var hc = last.hits[hi].cannon;
          b.dmgPops.push({ x: hc.x, y: hc.y - 74, text: '-' + last.hits[hi].dmg, t0: S.t });
          b.hitFlashes.push({ x: hc.x, y: hc.y, t0: S.t });
        }
        // cluster bomblets: replay each child's REAL flight (core-computed
        // lobs) staggered through the resolve pause; extra pause time so
        // the fan-out reads before the next turn begins
        if (last.lobs && last.lobs.length) {
          var stagger = 0.16;
          for (var li = 0; li < last.lobs.length; li++) {
            b.childFlights.push({
              points: last.lobs[li].points,
              impact: last.lobs[li].impact,
              by: by,
              startT: S.t + 0.12 + li * stagger,
              done: false
            });
          }
          b.resolveAt = S.t + RESOLVE_PAUSE + 0.12 + last.lobs.length * stagger + 0.5;
          return;
        }
      }
      b.resolveAt = S.t + RESOLVE_PAUSE;
    }

    function goSettle() {
      var winner = match.winner;
      var rounds = match.rounds;
      var streak;
      var board;
      if (mode === 'pvp') {
        // the pair streak: either side winning continues it. The streak
        // belongs to the COMBO NAME (規格 §5: 兩人一條記錄，拆夥重新計數)
        // — a different pairing restarts at 1 (review fix: the session
        // streak used to be global and never reset on a lineup change).
        var combo = NAMES.p1 + '+' + NAMES.p2;
        streak = (S.pvpCombo && S.pvpCombo.name === combo) ? S.pvpCombo.streak + 1 : 1;
        S.pvpCombo = { name: combo, streak: streak };
        board = 'streaks';
        // upsert: one record per pairing, higher streak replaces in place,
        // a lower/equal rematch leaves the board untouched
        CC.Leaderboard.upsert('streaks', { name: combo, score: streak }, { rawName: true });
      } else {
        var delta = match.streakDelta;
        streak = delta === 1 ? S.streaks[difficultyKey] + 1 : 0;
        // spec §5 has only two boards (dual streaks / hell clear): the
        // single-player streak lives in the session state only (final
        // review finding 2 — 'ACE' entries must not pollute the dual board)
        S.streaks[difficultyKey] = streak;
        if (difficultyKey === 'hell' && delta === 1) {
          CC.Leaderboard.add('hell', { name: NAMES.p1, score: rounds }); // plain name: normal filter
        }
      }
      set('settle', {
        winner: winner, rounds: rounds, mode: mode,
        difficulty: difficultyKey, streak: streak,
        board: board || null, limit: S.limit,
        names: { p1: NAMES.p1, p2: NAMES.p2 }
      });
    }

    b.keyDown = function (key, e) {
      if (key === 'Escape') { set('title'); return; }
      if (match.state !== 'AIM' && match.state !== 'CHARGE' && match.state !== 'SUDDEN') { return; }
      if (!human[match.turn]) { return; } // AI's move
      var c = sideCannon(match.turn);
      if (key === 'e' || key === 'Tab') {
        if (key === 'Tab' && e) { e.preventDefault(); }
        cycleWeapon(c, 1);
        return;
      }
      if (key === 'q') { cycleWeapon(c, -1); return; }
      if (key === ' ') {
        if (match.state === 'AIM') {
          if (match.startCharge()) { // resets power to 0 (the ping-pong curve starts here)
            b.chargeT = 0; // the charge clock runs on GAME time (update-accumulated)
            b.chargeActive = true;
            CC.Audio.chargeStart();
          }
        } else if (match.state === 'SUDDEN' && !e.repeat) {
          b.wantFire = true; // no charging in sudden death: fire straight (core pins 65)
        }
      }
      // w/s/arrows/a/d: polled per-frame in update (held keys), nothing here
    };

    b.keyUp = function (key) {
      if (key === ' ' && b.chargeActive && match.state === 'CHARGE' && human[match.turn]) {
        // the release power is the charge curve at the EXACT held duration:
        // the game-time total plus the wall-clock fraction elapsed since the
        // last fixed step — release timing carries no frame quantization
        b.chargeT += (nowMs() - b.lastFrameMs) / 1000;
        sideCannon(match.turn).power = CC.Ballistics.chargePower(b.chargeT);
        b.chargeActive = false;
        CC.Audio.chargeStop();
        b.wantFire = true; // release fires with the charged power kept
      }
    };

    b.update = function (dt) {
      var st = match.state;
      var charging = st === 'CHARGE';

      // human controls: both key clusters drive whichever side holds the
      // turn (unified mapping — no more per-side key sets)
      if ((st === 'AIM' || charging || st === 'SUDDEN') && human[match.turn]) {
        var c = sideCannon(match.turn);
        // elevation: W/S or up/down, 40 deg/s, 0..85 (aimable mid-charge)
        var adir = (S.input.isDown('w') || S.input.isDown('ArrowUp') ? 1 : 0) -
                   (S.input.isDown('s') || S.input.isDown('ArrowDown') ? 1 : 0);
        if (adir) { c.angle = clamp(c.angle + adir * ANGLE_RATE * dt, 0, ANGLE_MAX); }
        // walking: A/D or left/right, AIM only, spent from the budget
        if (st === 'AIM') {
          var mdir = (S.input.isDown('d') || S.input.isDown('ArrowRight') ? 1 : 0) -
                     (S.input.isDown('a') || S.input.isDown('ArrowLeft') ? 1 : 0);
          if (mdir) { match.move(mdir * MOVE_RATE * dt); }
        }
        // charge: the ping-pong curve evaluated at the accumulated game time
        if (charging && b.chargeActive) {
          b.chargeT += dt;
          c.power = CC.Ballistics.chargePower(b.chargeT);
          // the tone follows POWER, not time: it falls on the descent too
          CC.Audio.chargeTone(220 + c.power * 6);
        }
      }
      if (st !== 'CHARGE') { b.chargeActive = false; }
      b.lastFrameMs = nowMs(); // keyup adds the wall-clock residual to chargeT

      // barrel kick decay
      b.recoil.P1 = Math.max(0, b.recoil.P1 - dt);
      b.recoil.P2 = Math.max(0, b.recoil.P2 - dt);

      // AI turn: 1.2s think delay, then a 0.8s barrel tween, then fire.
      if (isAiTurn() && (st === 'AIM' || st === 'SUDDEN')) {
        if (!b.ai) {
          b.ai = { phase: 'wait', at: S.t + AI_THINK_DELAY };
        } else if (b.ai.phase === 'wait' && S.t >= b.ai.at) {
          var shot = CC.AI.pickShot(match, b.difficulty);
          // pickShot may go out of bounds — the view clamps.
          b.ai = {
            phase: 'tween',
            from: p2.angle,
            to: clamp(shot.angle, 0, ANGLE_MAX),
            power: clamp(shot.power, 0, 100),
            t0: S.t
          };
        } else if (b.ai.phase === 'tween') {
          var p = clamp((S.t - b.ai.t0) / AI_TWEEN_TIME, 0, 1);
          p2.angle = b.ai.from + (b.ai.to - b.ai.from) * p;
          if (p >= 1) {
            p2.angle = b.ai.to;
            p2.power = b.ai.power;
            b.ai = null;
            b.wantFire = true;
          }
        }
      }

      // manual fire request (charge release / sudden-death shot).
      // Snapshot BEFORE fire: spend() decrements ammo, so a post-fire
      // snapshot could misread the spent shell as a 'normal' fallback.
      if (b.wantFire && (match.state === 'AIM' || match.state === 'CHARGE' || match.state === 'SUDDEN')) {
        b.wantFire = false;
        var manual = snapshot();
        CC.Audio.chargeStop();
        match.fire();
        if (match.state === 'FLIGHT' && !b.flight) { launchFlight(manual); }
      }

      // turn clock (auto-fires at power 50 on expiry, inside tick)
      var snap = (match.state === 'AIM' || match.state === 'CHARGE') ? snapshot() : null;
      match.tick(dt);

      // a clock auto-fire happened this step?
      if (match.state === 'FLIGHT' && !b.flight && snap) {
        launchFlight(snap);
      }

      // charge tone follows the state
      if (match.state === 'CHARGE' && !charging && human[match.turn]) { CC.Audio.chargeStart(); }
      if (match.state !== 'CHARGE' && charging) { CC.Audio.chargeStop(); }

      // flight landing
      if (b.flight && S.t - b.flight.t0 >= b.flight.dur) { land(); }

      // cluster bomblet replays: each child detonates (blast + thump)
      // when its replayed flight reaches its core-computed landing
      for (var ci = b.childFlights.length - 1; ci >= 0; ci--) {
        var cf = b.childFlights[ci];
        if (S.t < cf.startT) { continue; }
        var cdur = (cf.points.length - 1) * STEP;
        if (S.t - cf.startT >= cdur) {
          b.blasts.push({ x: cf.impact.x, y: cf.impact.y, t0: S.t });
          b.cam.kick(0.3);
          CC.Audio.play('explosion');
          b.childFlights.splice(ci, 1);
        }
      }

      // resolve pause -> next(); a fresh round rolls the supply crate
      if (match.state === 'RESOLVE' && S.t >= b.resolveAt) {
        var r = match.next();
        if (r === 'AIM' || r === 'SUDDEN') {
          CC.Supply.maybeSpawn(match, Math.random);
        } else if (r === 'OVER') {
          b.over = true;
          goSettle();
          return;
        }
      }

      // turn banner: every fresh AIM turn announces its holder for 1s
      if (match.state === 'AIM' && match.turn !== b.lastTurn) {
        b.lastTurn = match.turn;
        var who = match.turn === 'P1' ? NAMES.p1 : NAMES.p2;
        b.banner = { text: (match.turn === 'P1' ? 'P1 ' : 'P2 ') + who + ' 回合', t0: S.t };
      }

      // timer warning beeps (last 5s of AIM/CHARGE, one pair per second)
      if ((match.state === 'AIM' || match.state === 'CHARGE') && match.timer <= TIMER_WARN_S && match.timer > 0) {
        var sec = Math.ceil(match.timer);
        if (sec !== b.lastBeepSec) {
          b.lastBeepSec = sec;
          CC.Audio.play('beep');
        }
      }

      // camera: chase the shell in flight, ride the active gun otherwise
      var shellState = null;
      if (b.flight) {
        var fpts = b.flight.points;
        var fidx = clamp(Math.floor((S.t - b.flight.t0) / STEP), 0, fpts.length - 1);
        var cur = fpts[fidx];
        var nxt = fpts[Math.min(fpts.length - 1, fidx + 1)];
        shellState = { x: cur.x, y: cur.y, vx: (nxt.x - cur.x) * 60, vy: (nxt.y - cur.y) * 60 };
      }
      b.cam.update(dt, { state: match.state, shell: shellState, focus: sideCannon(match.turn) });
    };

    b.draw = function (ctx) {
      var W = ctx.canvas.width;
      var H = ctx.canvas.height;
      var imgs = S.imgs;
      var i;

      // --- world layers under the camera transform ---
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      b.cam.apply(ctx);
      CC.Layers.draw(ctx, imgs, S.t, { deform: true }); // terrain cut by the live heightfield
      for (i = 0; i < b.craters.length; i++) {
        CC.Effects.crater(ctx, imgs, b.craters[i].x, b.craters[i].y, 0.35); // scorch mark
      }
      // supply crate: truthy check — undefined before the first roll,
      // null after a pickup (seam note; HUD handles it the same way)
      if (match.crate && imgs.crate) {
        var cw = CRATE_W;
        var ch = cw * imgs.crate.height / imgs.crate.width;
        ctx.drawImage(imgs.crate, match.crate.x - cw / 2, match.crate.y - ch, cw, ch);
      }
      // cannons with the barrel-kick offset (presentation only: a cloned
      // stance, the core object is never mutated)
      drawGun(ctx, p1);
      drawGun(ctx, p2);
      if (b.flight) {
        var pts = b.flight.points;
        var idx = clamp(Math.floor((S.t - b.flight.t0) / STEP), 0, pts.length - 1);
        var a = pts[Math.max(0, idx - 1)];
        var c2 = pts[Math.min(pts.length - 1, idx + 1)];
        var cur = pts[idx];
        CC.Effects.shellShadow(ctx, cur.x, cur.y, CC.Terrain.heightAt(cur.x));
        CC.Effects.flightTrail(ctx, pts, idx, SIDE_COLOR[b.flight.by]);
        CC.Sprites.drawShell(ctx, imgs, {
          x: cur.x, y: cur.y, type: b.flight.type,
          angle: Math.atan2(c2.y - a.y, c2.x - a.x)
        });
      }
      for (i = 0; i < b.blasts.length; i++) {
        CC.Effects.explosion(ctx, imgs, b.blasts[i].x, b.blasts[i].y, S.t - b.blasts[i].t0);
      }
      // cluster bomblets replaying their real flights
      for (i = 0; i < b.childFlights.length; i++) {
        var cf2 = b.childFlights[i];
        if (S.t < cf2.startT) { continue; }
        var cidx = clamp(Math.floor((S.t - cf2.startT) / STEP), 0, cf2.points.length - 1);
        var ca = cf2.points[Math.max(0, cidx - 1)];
        var cc = cf2.points[Math.min(cf2.points.length - 1, cidx + 1)];
        CC.Effects.flightTrail(ctx, cf2.points, cidx, SIDE_COLOR[cf2.by]);
        CC.Sprites.drawShell(ctx, imgs, {
          x: cf2.points[cidx].x, y: cf2.points[cidx].y, type: 'cluster',
          angle: Math.atan2(cc.y - ca.y, cc.x - ca.x)
        });
      }
      // muzzle flash (self-drawn, retires after MUZZLE_FLASH_TIME)
      for (i = b.flashes.length - 1; i >= 0; i--) {
        var fl = b.flashes[i];
        var age = S.t - fl.t0;
        if (age >= MUZZLE_FLASH_TIME || !imgs.vfxFlash) {
          if (age >= MUZZLE_FLASH_TIME) { b.flashes.splice(i, 1); }
          continue;
        }
        var fp = age / MUZZLE_FLASH_TIME;
        var scale = FLASH_FROM + (FLASH_TO - FLASH_FROM) * fp;
        var w = imgs.vfxFlash.width * scale;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - fp;
        ctx.drawImage(imgs.vfxFlash, fl.x - w / 2, fl.y - w / 2, w, w);
        ctx.restore();
      }
      if (b.trail) { CC.Effects.lastShot(ctx, b.trail.points, b.trail.impact); }
      // hit feedback: white bursts + floating damage numbers
      for (i = b.hitFlashes.length - 1; i >= 0; i--) {
        var hf = b.hitFlashes[i];
        var hAge = S.t - hf.t0;
        if (hAge >= CC.Effects.HITFLASH_TIME) { b.hitFlashes.splice(i, 1); continue; }
        CC.Effects.hitFlash(ctx, hf.x, hf.y, hAge);
      }
      for (i = b.dmgPops.length - 1; i >= 0; i--) {
        var dpop = b.dmgPops[i];
        var dAge = S.t - dpop.t0;
        if (dAge >= CC.Effects.DMG_TIME) { b.dmgPops.splice(i, 1); continue; }
        CC.Effects.damageNumber(ctx, dpop.x, dpop.y, dpop.text, dAge);
      }
      ctx.restore();

      // --- HUD, hints, banner: screen space, camera-free ---
      var charge = null;
      if (match.state === 'CHARGE' && b.chargeActive) {
        charge = { elapsed: b.chargeT, descending: (b.chargeT % 3.8) > 1.9 };
      }
      CC.HUD.draw(ctx, imgs, match, S.t, charge);
      var hint = '';
      if (b.flight) { hint = ''; }
      else if (isAiTurn()) { hint = b.ai && b.ai.phase === 'tween' ? 'AI 調整砲管…' : 'AI 思考中…'; }
      else if (human[match.turn]) { hint = 'A/D 走位 · W/S 仰角 · Q/E 換彈 · 長按空白蓄力，放開發射'; }
      if (hint) { label(ctx, hint, W / 2, 160, FONT_HINT, MENU_HI); }

      if (b.banner && match.state === 'AIM' && S.t - b.banner.t0 < BANNER_TIME) {
        var bp = (S.t - b.banner.t0) / BANNER_TIME;
        var alpha = bp < 0.15 ? bp / 0.15 : bp > 0.75 ? (1 - bp) / 0.25 : 1;
        label(ctx, b.banner.text, W / 2, 300, FONT_BANNER,
          'rgba(255, 223, 138, ' + clamp(alpha, 0, 1).toFixed(3) + ')');
      }
    };

    // one cannon with its recoil offset applied (cloned stance)
    function drawGun(ctx, c) {
      var p = b.recoil[c.side] > 0 ? b.recoil[c.side] / RECOIL_TIME : 0;
      var back = c.side === 'P1' ? -1 : 1; // kick away from the bore
      CC.Sprites.drawCannon(ctx, S.imgs, {
        side: c.side, x: c.x + back * RECOIL_PX * p, y: c.y, angle: c.angle
      });
    }

    return b;
  }

  /* ==================================================================
   * SETTLE — winner + rounds + streak; 3s auto rematch; ESC immediate.
   * ================================================================== */
  function settleFactory(params) {
    var st = {
      params: params,
      autoAt: 0,
      text: params.winner === 'P1' ? 'P1 ' + params.names.p1 + ' 勝' : 'P2 ' + params.names.p2 + ' 勝',
      streakText: params.mode === 'pvp'
        ? '雙人組合連勝：' + params.streak
        : (params.streak > 0 ? '連勝：' + params.streak : '連勝中斷')
    };
    st.enter = function () { st.autoAt = S.t + SETTLE_AUTO; };
    st.keyDown = function (key) {
      if (key === 'Escape') { set('title'); }
      // Enter skips the wait and rematches right away
      if (key === 'Enter') { rematch(); }
    };
    function rematch() {
      set('battle', { mode: st.params.mode, difficulty: st.params.difficulty });
    }
    st.update = function () {
      if (S.t >= st.autoAt) { rematch(); }
    };
    st.draw = function (ctx) {
      drawBackdrop(ctx, S.t);
      var W = ctx.canvas.width;
      var H = ctx.canvas.height;
      ctx.save();
      ctx.fillStyle = 'rgba(8, 10, 16, 0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      // result card: the red panel art behind the text (natural aspect,
      // centred), with the winner's gold medal pinned over its top edge
      var panel = S.imgs ? S.imgs.panelRed : null;
      if (panel) {
        var pw = 560;
        var ph = pw * panel.height / panel.width;
        ctx.drawImage(panel, W / 2 - pw / 2, H / 2 - ph / 2 - 6, pw, ph);
      }
      var gold = S.imgs ? S.imgs.medalGold : null;
      if (gold) {
        var mw = 110;
        ctx.drawImage(gold, W / 2 - mw / 2, H / 2 - 160 - mw / 2, mw, mw * gold.height / gold.width);
      }
      label(ctx, st.text, W / 2, H / 2 - 60, FONT_TITLE, MENU_HI);
      label(ctx, '本局回合數：' + st.params.rounds, W / 2, H / 2, FONT_ITEM, '#e8ecf2');
      label(ctx, st.streakText, W / 2, H / 2 + 44, FONT_ITEM, '#e8ecf2');
      if (st.params.board === 'hell' || st.params.mode === 'ai') {
        // hell board note when a hell clear was recorded
        if (st.params.mode === 'ai' && st.params.difficulty === 'hell' && st.params.winner === 'P1') {
          label(ctx, '地獄通關已記入排行榜', W / 2, H / 2 + 88, FONT_HINT, MENU_HI);
        }
      }
      var left = Math.max(0, Math.ceil(st.autoAt - S.t));
      label(ctx, left + ' 秒後再來一局（Enter 立即，ESC 回標題）', W / 2, H / 2 + 130, FONT_HINT, MENU_LO);
    };
    return st;
  }

  /* ==================================================================
   * BOARDS — medals + top 8 of both boards; Enter/ESC returns.
   * ================================================================== */
  var boards = {
    enter: function () { },
    keyDown: function (key) {
      if (key === 'Enter' || key === 'Escape') { set('title'); }
    },
    update: function () { },
    draw: function (ctx) {
      drawBackdrop(ctx, S.t);
      var W = ctx.canvas.width;
      var H = ctx.canvas.height;
      ctx.save();
      ctx.fillStyle = MENU_BG;
      ctx.fillRect(W / 2 - 520, 90, 1040, H - 200);
      ctx.restore();
      label(ctx, '排行榜', W / 2, 70, FONT_TITLE, MENU_HI);
      if (S.imgs.leaderboard) {
        var m = S.imgs.leaderboard;
        var mw = 220;
        ctx.drawImage(m, W / 2 - mw / 2, 100, mw, m.height * mw / m.width);
      }
      var cols = [
        { title: '連勝榜', list: CC.Leaderboard.top('streaks', 8) },
        { title: '地獄通關（回合數少者勝）', list: CC.Leaderboard.top('hell', 8) }
      ];
      var medalImgs = [S.imgs ? S.imgs.medalGold : null,
                       S.imgs ? S.imgs.medalSilver : null,
                       S.imgs ? S.imgs.medalBronze : null];
      for (var c = 0; c < 2; c++) {
        var x = W / 2 + (c === 0 ? -260 : 260);
        label(ctx, cols[c].title, x, 210, FONT_ITEM, MENU_HI);
        var list = cols[c].list;
        for (var i = 0; i < 8; i++) {
          var e = list[i];
          var text = e ? (i + 1) + '. ' + e.name + ' — ' + e.score : (i + 1) + '. ---';
          var medal = i === 0 ? '#ffd76a' : i === 1 ? '#cfd6de' : i === 2 ? '#d09a62' : MENU_LO;
          // top-3 rows get the actual medal art hugging the text's left edge
          if (medalImgs[i]) {
            ctx.font = FONT_HINT;
            var tw = ctx.measureText(text).width;
            var ms = 26;
            ctx.drawImage(medalImgs[i], x - tw / 2 - ms - 10, 260 + i * 40 - ms + 4, ms, ms * medalImgs[i].height / medalImgs[i].width);
          }
          label(ctx, text, x, 260 + i * 40, FONT_HINT, medal);
        }
      }
      label(ctx, 'Enter / ESC 返回標題', W / 2, H - 60, FONT_HINT, MENU_LO);
    }
  };

  // --- single entry point ---------------------------------------------

  var factories = {
    title: function () { return title; },
    difficulty: function () { return difficulty; },
    boards: function () { return boards; },
    battle: battleFactory,
    settle: settleFactory
  };

  /**
   * set(name, params) — switch to a scene. Cleans the previous scene's
   * audio state (no leaked charge tone across switches); each battle is
   * a fresh factory closure, so timers/listeners cannot leak.
   */
  function set(name, params) {
    CC.Audio.chargeStop();
    var scene = factories[name](params || {});
    if (scene.enter) { scene.enter(); }
    S.scene = scene;
    S.name = name;
    setSink(scene);
  }

  function update(dt) { S.t += dt; if (S.scene && S.scene.update) { S.scene.update(dt); } }
  function draw() { if (S.scene && S.scene.draw) { S.scene.draw(S.ctx); } }

  /**
   * init(opts) — {canvas, ctx, imgs, input}; called once by main.js.
   */
  function init(opts) {
    S.ctx = opts.ctx;
    S.imgs = opts.imgs;
    S.input = opts.input;
  }

  CC.Scenes = {
    init: init,
    set: set,
    update: update,
    draw: draw,
    // test/inspection hooks
    current: function () { return S.name; },
    scene: function () { return S.scene; }, // inspection hook (IAB hand-verify)
    session: function () { return S; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
