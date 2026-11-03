/* CC.HUD — health bars, aim gauge, wind/round/timer strip (browser global + Node module.exports). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // ---------------------------------------------------------------- *
  // Health bars — per-side geometry sets. Each set describes ONE image
  // pipeline: a dark track is painted into the frame's window cavity,
  // the HP-cropped fill maps onto that window (fill length = HP%,
  // left-anchored; the P2 draw is mirrored so both drain outward toward
  // the screen edges), then the frame is drawn over both so its inner
  // bezel overlaps the fill edges.
  //
  // RED (healthbarRed, 512x512): the frame band and the orange fill
  // strip live in ONE image ("框+填充在同一張圖"); regions below are
  // measured from the PNG's alpha channel. The frame's interior window
  // is a fully transparent cavity (background removal keyed it out),
  // and the fill strip's dark left tail was eaten by the same pass —
  // so the fill is cropped from where the art is still opaque.
  //
  // BLUE (healthbarBlueFrame 2123x595 + healthbarBlue): the shipped art
  // is a full glass tube, so a derived frame with the window keyed to
  // transparent was cut from it (window rect measured from the glass
  // pixels). The fill crops the glass back from the ORIGINAL image and
  // maps onto the window at ~1:1, keeping the segment art undistorted.
  var GEO_RED = {
    frame:  { x: 26, y: 126, w: 460, h: 154 },
    window: { x: 97, y: 54, w: 330, h: 41 },   // cavity, frame-local
    fill:   { x: 219, y: 317, w: 177, h: 53 }  // opaque orange run of the strip
  };
  var GEO_BLUE = {
    frame:  { x: 0, y: 0, w: 2123, h: 595 },
    window: { x: 359, y: 189, w: 1394, h: 184 },
    fill:   { x: 362, y: 192, w: 1388, h: 178 }
  };
  var BAR_TOP = 18;
  var BAR_MARGIN = 24;
  var TRACK = 'rgba(14, 10, 12, 0.85)'; // cavity backdrop behind the fill

  // Display sizes: red pins the classic 360 width; blue is sized to the
  // same display HEIGHT so the two tops and the weapon labels align.
  var RED_W = 360;
  var BLUE_W = Math.round(2123 * (154 * RED_W / 460) / 595); // ≈430, height-matched
  var BAR_W = RED_W; // kept for the weapon-label column layout

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
  var G_BOTTOM_PAD = 7;             // art content bottom (y=372) above the screen bottom
  // The art's decorative "000" power screen (right of the hub, keyed out
  // like the face) is restored as a live readout of the current power.
  var G_SCREEN = { dx: 79, dy: -13, w: 56, h: 26 }; // art px, hub-relative

  // ---------------------------------------------------------------- *
  // Power bar (code-drawn, DDTank-style): a horizontal 0..100 strip above
  // the gauge. Replaces the dial's old power arc — the dial now reads
  // ELEVATION only. Shows tick marks, the live %, the descent arrow while
  // the ping-pong curve is falling, and each side's last-fired power as a
  // player-colored notch — the memory anchor for the "last shot 65, try
  // 70" correction loop.
  var PB_W = 480;
  var PB_H = 22;
  var PB_Y = 655;      // top of the power bar (gauge art tops out at ~688)
  var MB_H = 7;        // move-budget bar height, sits just above
  var MB_GAP = 5;

  // Last-shot notch colors per side (matches the shell trail colors).
  var COLOR_P1 = '#ff9a3d';
  var COLOR_P2 = '#4fc3ff';
  var COLOR_FILL_HI = '#ffb347';
  var COLOR_FILL_LO = '#ff5e3a';
  var COLOR_TICK = 'rgba(240, 240, 245, 0.55)';
  var COLOR_TRACK2 = 'rgba(14, 10, 12, 0.85)';

  // ---------------------------------------------------------------- *
  // Top-centre strip (timer / wind / round) and per-side weapon lines are
  // plain canvas text: wind is drawn as chevrons + number (the wind art
  // never landed — code drawing removed that dependency), the timer warns
  // red during the last WARN_S seconds, and SUDDEN death replaces the
  // timer with a fixed notice (in SUDDEN the core's timer is a
  // never-ticking full clock — reading it there would lie).
  var WARN_S = 5;
  var TIMER_Y = 48;
  var WIND_Y = 82;
  var ROUND_Y = 110;
  var WEAPON_GAP = 26; // bar bottom -> weapon line baseline

  var FONT_TIMER = 'bold 34px sans-serif';
  var FONT_WIND = 'bold 24px sans-serif';
  var FONT_ROUND = '18px sans-serif';
  var FONT_WEAPON = 'bold 22px sans-serif';
  var FONT_BAR = 'bold 15px sans-serif';

  var COLOR_TIMER = '#f2f4f7';
  var COLOR_WARN = '#ff4b3e';
  var COLOR_WIND = '#9fd8ff';
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
  // (negative wind pushes toward -x). Kept for the node test hook; the
  // draw path uses chevrons (drawWind below).
  function windText(wind) {
    if (wind < 0) { return '風 ◀◀ ' + (-wind); }
    if (wind > 0) { return '風 ▶▶ ' + wind; }
    return '風 0';
  }

  // Wind as |wind| chevrons blowing in its direction + the number. A
  // chevron is a wide ">" (mirrored for -x); zero draws just 「風 0」.
  function drawWind(ctx, wind, cx, y) {
    var n = Math.abs(wind);
    label(ctx, '風', cx - (n > 0 ? 74 : 14), y, FONT_WIND, COLOR_WIND);
    if (n <= 0) { return; }
    var dir = wind > 0 ? 1 : -1;
    var gap = 26;
    ctx.save();
    ctx.strokeStyle = COLOR_WIND;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = cx + dir * (i * gap - (n - 1) * gap / 2);
      ctx.beginPath();
      ctx.moveTo(x - dir * 7, y - 11);
      ctx.lineTo(x + dir * 6, y - 4);
      ctx.lineTo(x - dir * 7, y + 3);
      ctx.stroke();
    }
    ctx.restore();
    label(ctx, String(n), cx + dir * ((n - 1) * gap / 2 + 26), y, FONT_WIND, COLOR_WIND);
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

  // ---------------------------------------------------------------- *
  // Ammo badge (btn-ammo): the button art sits beside each weapon line.
  // Normal state = plenty of ammo; pressed state = a finite weapon down
  // to its last shot (the low-ammo cue). Infinite ammo stays normal.
  var BADGE_S = 46;
  function drawBadge(ctx, imgs, cannon, cx, cy) {
    var img = imgs ? imgs.btnAmmoNormal : null;
    var left = cannon && cannon.ammo ? cannon.ammo[cannon.weapon] : undefined;
    if (left !== undefined && left !== Infinity && left <= 1 && imgs.btnAmmoPressed) {
      img = imgs.btnAmmoPressed;
    }
    if (!img) { return; }
    ctx.drawImage(img, cx - BADGE_S / 2, cy - BADGE_S / 2, BADGE_S, BADGE_S);
  }

  // One health bar drawn at the shared top-left slot. `geo` selects the
  // asset geometry; frameImg/fillImg may be the same image (red) or two
  // cuts of one art (blue). Callers mirror the whole bar with a
  // transform; text is never drawn mirrored.
  function drawBar(ctx, geo, frameImg, fillImg, hp, dispW) {
    var s = dispW / geo.frame.w;
    var frac = hpFrac(hp);
    var wx = BAR_MARGIN + geo.window.x * s;
    var wy = BAR_TOP + geo.window.y * s;
    var ww = geo.window.w * s;
    var wh = geo.window.h * s;
    ctx.save();
    ctx.fillStyle = TRACK;
    ctx.fillRect(wx, wy, ww, wh);
    if (frac > 0) {
      // source-crop keeps the segment lines' width while draining
      ctx.drawImage(fillImg, geo.fill.x, geo.fill.y, geo.fill.w * frac, geo.fill.h, wx, wy, ww * frac, wh);
    }
    ctx.drawImage(frameImg, geo.frame.x, geo.frame.y, geo.frame.w, geo.frame.h, BAR_MARGIN, BAR_TOP, dispW, geo.frame.h * s);
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
   * drawGauge(ctx, img, angleDeg, charging) — bottom-centre dial.
   * needle angle = current elevation in degrees (0 = horizontal right,
   * 85 = near vertical, matching the baked art needle's 45-degree rest).
   * The art's "000" slot is a live ELEVATION readout — power moved to the
   * dedicated power bar, so the dial reads one thing plainly. img may be
   * null: the dial body is code-drawn.
   */
  function drawGauge(ctx, img, angleDeg, charging) {
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

    // digital ELEVATION readout in the art's "000" slot — under the
    // needle, so the blade passes over it like over the dial face
    var scr = G_SCREEN;
    ctx.fillStyle = 'rgba(12, 16, 22, 0.85)';
    ctx.fillRect(px + (scr.dx - scr.w / 2) * s, py + (scr.dy - scr.h / 2) * s, scr.w * s, scr.h * s);
    ctx.fillStyle = charging ? '#4fd2ff' : '#2f8fb8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(angleDeg > 0 ? angleDeg : 0) + '°', px + scr.dx * s, py + scr.dy * s);

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

    ctx.restore();
  }

  /**
   * drawPowerBar(ctx, match, charging, descending) — the horizontal
   * 0..100 strip: ticks at 0/25/50/75/100, the live fill + % readout, a
   * ▼/▲ while the charge curve is falling, and each side's last-fired
   * power as a persistent player-colored notch (the correction-loop
   * anchor). While not charging the bar idles at the active side's
   * current power.
   */
  function drawPowerBar(ctx, match, charging, descending) {
    var W = ctx.canvas.width;
    var x = (W - PB_W) / 2;
    var active = sideOf(match, match.turn);
    var p = charging ? (active.power > 0 ? active.power : 0) : (active.power > 0 ? active.power : 0);

    ctx.save();
    // track + fill
    ctx.fillStyle = COLOR_TRACK2;
    ctx.fillRect(x - 3, PB_Y - 3, PB_W + 6, PB_H + 6);
    if (p > 0) {
      var grad = ctx.createLinearGradient(x, 0, x + PB_W, 0);
      grad.addColorStop(0, COLOR_FILL_LO);
      grad.addColorStop(1, COLOR_FILL_HI);
      ctx.fillStyle = grad;
      ctx.fillRect(x, PB_Y, PB_W * clamp01(p / 100), PB_H);
    }
    // ticks + numerals
    ctx.strokeStyle = COLOR_TICK;
    ctx.lineWidth = 1;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLOR_TICK;
    for (var v = 0; v <= 100; v += 25) {
      var tx = x + PB_W * v / 100;
      ctx.beginPath();
      ctx.moveTo(tx, PB_Y);
      ctx.lineTo(tx, PB_Y + PB_H);
      ctx.stroke();
      ctx.fillText(String(v), tx, PB_Y + PB_H + 3);
    }
    // last-fired notches: both sides, always visible
    for (var side in { P1: 1, P2: 1 }) {
      var c = side === 'P1' ? match.p1 : match.p2;
      if (!c || !(c.lastPower >= 0)) { continue; }
      var nx = x + PB_W * clamp01(c.lastPower / 100);
      ctx.strokeStyle = side === 'P1' ? COLOR_P1 : COLOR_P2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(nx, PB_Y - 6);
      ctx.lineTo(nx, PB_Y + PB_H + 2);
      ctx.stroke();
    }
    // % readout + descent arrow
    var pct = String(Math.round(p)) + '%' + (charging ? (descending ? ' ▼' : ' ▲') : '');
    label(ctx, pct, W / 2, PB_Y - 6, FONT_BAR, charging ? '#ffe2ae' : '#c9cfd8');
    ctx.restore();
  }

  /**
   * drawMoveBar(ctx, match) — the active side's remaining walking budget
   * as a thin strip right above the power bar. AIM only (walking is).
   */
  function drawMoveBar(ctx, match) {
    if (match.state !== 'AIM') { return; }
    var W = ctx.canvas.width;
    var x = (W - PB_W) / 2;
    var active = sideOf(match, match.turn);
    var range = (CC.Cannon && CC.Cannon.MOVE_RANGE) || 160;
    var frac = clamp01((active.moveBudget > 0 ? active.moveBudget : 0) / range);
    var y = PB_Y - MB_GAP - MB_H;
    ctx.save();
    ctx.fillStyle = COLOR_TRACK2;
    ctx.fillRect(x, y, PB_W, MB_H);
    if (frac > 0) {
      ctx.fillStyle = '#7fd48a';
      ctx.fillRect(x, y, PB_W * frac, MB_H);
    }
    ctx.restore();
    label(ctx, '走位', x - 34, y + MB_H, FONT_BAR, '#c9cfd8');
  }

  /**
   * draw(ctx, imgs, match, t, info) — the full HUD. match is a CC.Match
   * (or a stand-in exposing the fields read here: p1/p2 {hp, angle,
   * power, ammo, moveBudget, lastPower, weapon}, turn, round, wind,
   * timer, state). t is the logical time in seconds driving the warning
   * flash; defaults to wall clock. info (optional): { charge: null |
   * {descending} } — the battle scene's charge context.
   * Rendering only — nothing here mutates match. Missing images skip
   * their element; the text strip always draws.
   */
  function draw(ctx, imgs, match, t, info) {
    if (!ctx || !match) { return; }
    if (t === undefined) {
      t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    }
    info = info || {};
    var W = ctx.canvas.width;
    var redImg = imgs ? imgs.healthbarRed : null;
    var blueImg = imgs ? imgs.healthbarBlue : null;
    var blueFrame = imgs ? (imgs.healthbarBlueFrame || blueImg) : null;

    // health bars: P1 red (left-anchored), P2 the real blue art (mirrored
    // draw drains it outward toward the right edge)
    if (redImg) {
      drawBar(ctx, GEO_RED, redImg, redImg, match.p1 && match.p1.hp, RED_W);
    }
    if (blueFrame && blueImg) {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      drawBar(ctx, GEO_BLUE, blueFrame, blueImg, match.p2 && match.p2.hp, BLUE_W);
      ctx.restore();
    }

    // weapon + ammo line under each bar (bright on the side to move),
    // with the ammo button badge beside it — pressed state = special
    // weapon down to its last shot
    var barH = GEO_RED.frame.h * (RED_W / GEO_RED.frame.w);
    var labelY = BAR_TOP + barH + WEAPON_GAP;
    var p1 = match.p1 || {};
    var p2 = match.p2 || {};
    var txt1 = weaponLabel(p1);
    var txt2 = weaponLabel(p2);
    label(ctx, txt1, BAR_MARGIN + BAR_W / 2, labelY, FONT_WEAPON,
      match.turn === 'P1' ? COLOR_WEAPON_ACTIVE : COLOR_WEAPON_IDLE);
    label(ctx, txt2, W - BAR_MARGIN - BAR_W / 2, labelY, FONT_WEAPON,
      match.turn === 'P2' ? COLOR_WEAPON_ACTIVE : COLOR_WEAPON_IDLE);
    if (imgs) {
      ctx.font = FONT_WEAPON;
      var tw1 = ctx.measureText(txt1).width;
      drawBadge(ctx, imgs, p1, BAR_MARGIN + BAR_W / 2 - tw1 / 2 - 32, labelY - 9);
      ctx.font = FONT_WEAPON;
      var tw2 = ctx.measureText(txt2).width;
      drawBadge(ctx, imgs, p2, W - BAR_MARGIN - BAR_W / 2 + tw2 / 2 + 32, labelY - 9);
    }

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

    drawWind(ctx, match.wind, W / 2, WIND_Y);
    label(ctx, '第 ' + (match.round > 0 ? match.round : 1) + ' 回合', W / 2, ROUND_Y, FONT_ROUND, COLOR_ROUND);

    // power strip + walking budget (the dial below is elevation-only now)
    var charging = match.state === 'CHARGE';
    drawMoveBar(ctx, match);
    drawPowerBar(ctx, match, charging, !!(info.charge && info.charge.descending));

    // gauge shows the side to move: elevation needle + digital angle
    var active = sideOf(match, match.turn);
    drawGauge(ctx, imgs ? imgs.gauge : null, active.angle, charging);
  }

  CC.HUD = { draw: draw, windText: windText };

  // Node test hook
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CC.HUD;
  }
})(typeof window !== 'undefined' ? window : globalThis);
