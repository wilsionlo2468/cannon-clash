/* CC.HUD — health bars, aim gauge, wind/round/timer strip (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // ---------------------------------------------------------------- *
  // Health bar (healthbarRed): the frame band and the orange fill strip
  // live in ONE 512x512 image ("框+填充在同一張圖"); regions below are
  // measured from the PNG's alpha channel. Two asset facts drove the
  // numbers: the frame's interior window is a fully transparent cavity
  // (background removal keyed it out), and the fill strip's dark left
  // tail was eaten by the same pass — so the fill is cropped from where
  // the art is still opaque. A dark track rect is painted into the
  // cavity first, then the HP-cropped fill, then the frame over both so
  // its inner bezel overlaps the fill edges. Fill length = HP%
  // (left-anchored for P1; the P2 draw is mirrored, so both drain
  // outward toward the screen edges).
  var HB_FRAME = { x: 26, y: 126, w: 460, h: 154 };
  var HB_WINDOW = { x: 97, y: 54, w: 330, h: 41 };  // cavity, frame-local
  var HB_FILL = { x: 219, y: 317, w: 177, h: 53 };  // opaque orange run of the strip
  var BAR_W = 360;        // display width of the frame; height keeps aspect
  var BAR_TOP = 18;
  var BAR_MARGIN = 24;
  var TRACK = 'rgba(14, 10, 12, 0.85)'; // cavity backdrop behind the fill

  // Blue side placeholder, pinned verbatim by the task brief: tint the red
  // bar with a hue filter until a real blue asset lands. NOTE: 150deg turns
  // this art teal-green (red hue ~14deg + 150); a true blue would want
  // ~210-240deg — swap point is this constant (ideally the loader entry).
  var BLUE_FILTER = 'hue-rotate(150deg)';

  // ---------------------------------------------------------------- *
  // Gauge (gauge): the art ships with a FIXED needle baked in at 45
  // degrees and a partly keyed-out face. Per the design note ("遊戲内指
  // 針由代碼繪製疊加，或以中心區域遮蓋") the pivot region is masked with a
  // face-coloured disc and the live needle is drawn by code on top.
  // Radial layout measured from the art around the hub centre: baked
  // blade r 32..122, printed numerals r ~138..165, printed colour band
  // r ~168..200 — the mask radius covers the blade, stops short of the
  // numerals, and the power arc rides the middle of the colour band.
  var GAUGE_S = 0.55;               // display scale for the 512px art
  var G_PIVOT = { x: 256, y: 305 }; // hub centre, measured from the art
  var G_BACK_R = 205;               // backdrop disc radius (art px) — fills keyed-out face holes
  var G_MASK_R = 130;               // face cover disc radius (art px)
  var G_NEEDLE_L = 124;             // code needle length (art px, = baked blade reach)
  var G_NEEDLE_HW = 17;             // code needle base half-width (art px)
  var G_HUB_R = 30;                 // hub cap radius (art px)
  var G_ARC_R = 184;                // power arc radius (art px)
  var G_ARC_W = 10;                 // power arc stroke width (display px)
  var G_MAX_SWEEP = 90;             // power 100 -> 90 degrees of arc
  var G_BOTTOM_PAD = 7;             // art content bottom (y=372) above the screen bottom
  // The art's decorative "000" power screen (right of the hub, keyed out
  // like the face) is restored as a live readout of the current power.
  var G_SCREEN = { dx: 79, dy: -13, w: 56, h: 26 }; // art px, hub-relative

  // ---------------------------------------------------------------- *
  // Top-centre strip (timer / wind / round) and per-side weapon lines are
  // plain canvas text: wind art is missing (placeholder per the plan),
  // the timer warns red during the last WARN_S seconds, and SUDDEN death
  // replaces the timer with a fixed notice (in SUDDEN the core's timer is
  // a never-ticking full clock — reading it there would lie).
  var WARN_S = 5;
  var TIMER_Y = 48;
  var WIND_Y = 82;
  var ROUND_Y = 110;
  var WEAPON_GAP = 26; // bar bottom -> weapon line baseline

  var FONT_TIMER = 'bold 34px sans-serif';
  var FONT_WIND = 'bold 24px sans-serif';
  var FONT_ROUND = '18px sans-serif';
  var FONT_WEAPON = 'bold 22px sans-serif';

  var COLOR_TIMER = '#f2f4f7';
  var COLOR_WARN = '#ff4b3e';
  var COLOR_WIND = '#e8ecf2';
  var COLOR_ROUND = '#c9cfd8';
  var COLOR_WEAPON_ACTIVE = '#ffdf8a';
  var COLOR_WEAPON_IDLE = '#aeb6c2';

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // HP fraction: the pinned max HP is 100. NaN/undefined/negative -> 0.
  function hpFrac(hp) {
    return clamp01((hp > 0 ? hp : 0) / 100);
  }

  // Side key -> the match's cannon record ('P1' -> p1); unknown -> p1.
  function sideOf(match, turn) {
    return turn === 'P2' ? match.p2 : match.p1;
  }

  // Weapon line under a bar: 「重錘彈 ×2」 / 「普通彈 ∞」. The display name
  // comes from CC.Weapons.LIST (missing entry falls back to the raw key);
  // a missing ammo table prints the name alone.
  function weaponLabel(cannon) {
    if (!cannon) { return ''; }
    var key = cannon.weapon || '';
    var entry = (CC.Weapons && CC.Weapons.LIST && CC.Weapons.LIST[key]) || { name: key };
    var left = cannon.ammo ? cannon.ammo[cannon.weapon] : undefined;
    var count = '';
    if (left !== undefined) {
      count = left === Infinity ? ' ∞' : ' ×' + left;
    }
    return entry.name + count;
  }

  // 「風 ◀◀/▶▶ n」 — arrows point the way the wind blows the shell
  // (negative wind pushes toward -x). Placeholder until wind art lands.
  function windText(wind) {
    if (wind < 0) { return '風 ◀◀ ' + (-wind); }
    if (wind > 0) { return '風 ▶▶ ' + wind; }
    return '風 0';
  }

  // Outline text: dark stroke keeps the strip readable over sky and terrain.
  function label(ctx, text, x, y, font, fill) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 10, 14, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // 3 Hz square wave for the timer warning flash.
  function blinkOn(t) {
    return Math.floor(t * 3) % 2 === 0;
  }

  // One health bar drawn at the shared top-left slot. `filter` tints both
  // the fill and the frame (P2's blue placeholder). Callers mirror the
  // whole bar with a transform; text is never drawn mirrored.
  function drawBar(ctx, img, hp, filter) {
    var s = BAR_W / HB_FRAME.w;
    var frac = hpFrac(hp);
    var wx = BAR_MARGIN + HB_WINDOW.x * s;
    var wy = BAR_TOP + HB_WINDOW.y * s;
    var ww = HB_WINDOW.w * s;
    var wh = HB_WINDOW.h * s;
    ctx.save();
    ctx.filter = filter || 'none';
    ctx.fillStyle = TRACK;
    ctx.fillRect(wx, wy, ww, wh);
    if (frac > 0) {
      // source-crop keeps the segment lines' width while draining
      ctx.drawImage(img, HB_FILL.x, HB_FILL.y, HB_FILL.w * frac, HB_FILL.h, wx, wy, ww * frac, wh);
    }
    ctx.drawImage(img, HB_FRAME.x, HB_FRAME.y, HB_FRAME.w, HB_FRAME.h, BAR_MARGIN, BAR_TOP, BAR_W, HB_FRAME.h * s);
    ctx.restore();
  }

  // Needle polygon helper: tip toward elevation `a` (radians above
  // horizontal, right side), base offset PERPENDICULAR to the needle axis
  // (unit axis (cos, -sin) in canvas coords -> unit normal (sin, cos)),
  // shifted by (ox, oy) for the drop shadow.
  function needlePath(ctx, px, py, a, len, halfW, ox, oy) {
    var sin = Math.sin(a);
    var cos = Math.cos(a);
    ctx.beginPath();
    ctx.moveTo(px - halfW * sin + ox, py - halfW * cos + oy);
    ctx.lineTo(px + len * cos + ox, py - len * sin + oy);
    ctx.lineTo(px + halfW * sin + ox, py + halfW * cos + oy);
    ctx.closePath();
  }

  /**
   * drawGauge(ctx, img, angleDeg, power, charging) — bottom-centre dial.
   * needle angle = current elevation in degrees (0 = horizontal right,
   * 85 = near vertical, matching the baked art needle's 45-degree rest);
   * while charging, a power arc sweeps the printed colour band
   * (power 0..100 -> 0..90 degrees) beside a live digital readout in the
   * art's "000" slot. img may be null: the dial body is code-drawn.
   */
  function drawGauge(ctx, img, angleDeg, power, charging) {
    var s = GAUGE_S;
    var px = ctx.canvas.width / 2;
    var py = ctx.canvas.height - G_BOTTOM_PAD - (372 - G_PIVOT.y) * s;
    var mr = G_MASK_R * s;

    ctx.save();
    // backdrop disc: fixes the keyed-out face holes behind the art
    ctx.beginPath();
    ctx.arc(px, py, G_BACK_R * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(24, 20, 17, 0.92)';
    ctx.fill();
    if (img) {
      ctx.drawImage(img, px - G_PIVOT.x * s, py - G_PIVOT.y * s, 512 * s, 512 * s);
    }
    // face cover disc: hides the baked needle, stops short of the numerals
    var grad = ctx.createRadialGradient(px - mr * 0.25, py - mr * 0.35, mr * 0.15, px, py, mr);
    grad.addColorStop(0, '#b5ab97');
    grad.addColorStop(1, '#948a77');
    ctx.beginPath();
    ctx.arc(px, py, mr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(40, 34, 28, 0.9)';
    ctx.stroke();

    // digital power readout in the art's "000" slot — under the needle, so
    // the blade passes over it like over the dial face at low elevations
    var scr = G_SCREEN;
    ctx.fillStyle = 'rgba(12, 16, 22, 0.85)';
    ctx.fillRect(px + (scr.dx - scr.w / 2) * s, py + (scr.dy - scr.h / 2) * s, scr.w * s, scr.h * s);
    ctx.fillStyle = charging ? '#4fd2ff' : '#2f8fb8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(power > 0 ? power : 0)), px + scr.dx * s, py + scr.dy * s);

    // live needle = current elevation (clamped to the core's 0..85 range)
    var a = Math.max(0, Math.min(85, angleDeg > 0 ? angleDeg : 0)) * Math.PI / 180;
    var len = G_NEEDLE_L * s;
    var halfW = G_NEEDLE_HW * s;
    needlePath(ctx, px, py, a, len, halfW, 2, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    needlePath(ctx, px, py, a, len, halfW, 0, 0);
    ctx.fillStyle = '#2a2622';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#efe8d8';
    ctx.stroke();

    // hub cap over both needles' bases
    ctx.beginPath();
    ctx.arc(px, py, G_HUB_R * s, 0, Math.PI * 2);
    ctx.fillStyle = '#4a443c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1c1916';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 11 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#6c6355';
    ctx.fill();

    // power arc while charging, riding the printed colour band
    if (charging) {
      var sweep = clamp01((power > 0 ? power : 0) / 100) * G_MAX_SWEEP * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(px, py, G_ARC_R * s, -sweep, 0);
      ctx.lineWidth = G_ARC_W;
      ctx.strokeStyle = 'rgba(255, 148, 50, 0.95)';
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * draw(ctx, imgs, match, t) — the full HUD. match is a CC.Match (or a
   * stand-in exposing the fields read here: p1/p2 {hp, angle, power,
   * weapon, ammo}, turn, round, wind, timer, state). t is the logical
   * time in seconds driving the warning flash; defaults to wall clock.
   * Rendering only — nothing here mutates match. Missing images skip
   * their element; the text strip always draws.
   */
  function draw(ctx, imgs, match, t) {
    if (!ctx || !match) { return; }
    if (t === undefined) {
      t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    }
    var W = ctx.canvas.width;
    var bar = imgs ? imgs.healthbarRed : null;

    // health bars: P2 is the mirrored draw; blue = tinted red placeholder
    if (bar) {
      drawBar(ctx, bar, match.p1 && match.p1.hp, 'none');
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      drawBar(ctx, bar, match.p2 && match.p2.hp, BLUE_FILTER);
      ctx.restore();
    }

    // weapon + ammo line under each bar (bright on the side to move)
    var barH = HB_FRAME.h * (BAR_W / HB_FRAME.w);
    var labelY = BAR_TOP + barH + WEAPON_GAP;
    var p1 = match.p1 || {};
    var p2 = match.p2 || {};
    label(ctx, weaponLabel(p1), BAR_MARGIN + BAR_W / 2, labelY, FONT_WEAPON,
      match.turn === 'P1' ? COLOR_WEAPON_ACTIVE : COLOR_WEAPON_IDLE);
    label(ctx, weaponLabel(p2), W - BAR_MARGIN - BAR_W / 2, labelY, FONT_WEAPON,
      match.turn === 'P2' ? COLOR_WEAPON_ACTIVE : COLOR_WEAPON_IDLE);

    // timer / sudden death. timer <= 0 draws blank: with the clock
    // disabled the core parks timer at 0, and with it enabled expiry
    // auto-fires the same tick — a persistent 0 is never a real count.
    if (match.state === 'SUDDEN') {
      var pulse = 0.72 + 0.28 * Math.sin(t * 7);
      label(ctx, '突然死亡', W / 2, TIMER_Y, FONT_TIMER, 'rgba(255, 75, 62, ' + pulse.toFixed(3) + ')');
    } else if (match.timer > 0) {
      var secs = Math.ceil(match.timer);
      var warn = match.timer <= WARN_S && (match.state === 'AIM' || match.state === 'CHARGE');
      var alpha = warn && !blinkOn(t) ? 0.3 : 1;
      var color = warn ? 'rgba(255, 75, 62, ' + alpha + ')' : COLOR_TIMER;
      label(ctx, String(secs), W / 2, TIMER_Y, FONT_TIMER, color);
    }

    label(ctx, windText(match.wind), W / 2, WIND_Y, FONT_WIND, COLOR_WIND);
    label(ctx, '第 ' + (match.round > 0 ? match.round : 1) + ' 回合', W / 2, ROUND_Y, FONT_ROUND, COLOR_ROUND);

    // gauge shows the side to move: elevation needle (+ power while charging)
    var active = sideOf(match, match.turn);
    drawGauge(ctx, imgs ? imgs.gauge : null, active.angle, active.power, match.state === 'CHARGE');
  }

  CC.HUD = { draw: draw, windText: windText };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.HUD;
  }
})(typeof window !== 'undefined' ? window : globalThis);
