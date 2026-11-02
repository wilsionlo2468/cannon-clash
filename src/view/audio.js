/* CC.Audio — WebAudio synthesized SFX + persisted mute (browser global). */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // localStorage key for the mute toggle (self-decided, task-11 report).
  var MUTE_KEY = 'cc_muted_v1';

  var ctx = null;   // AudioContext, created on first user interaction
  var muted = false;

  try {
    muted = root.localStorage && root.localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) { /* blocked storage: stay unmuted */ }

  function saveMute() {
    try {
      if (root.localStorage) { root.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
    } catch (e) { /* ignore */ }
  }

  /**
   * unlock() — create the AudioContext. Browsers block audio before the
   * first user gesture, so this is called from the first keydown/pointer
   * event (main.js wires it once). Safe to call repeatedly.
   */
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') { ctx.resume(); }
      return;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { return; }
    try { ctx = new AC(); } catch (e) { ctx = null; }
  }

  function ok() {
    return ctx && !muted && ctx.state !== 'closed';
  }

  // Short white-noise buffer, shared by shot and explosion.
  function noiseBuffer(duration) {
    var rate = ctx.sampleRate;
    var buf = ctx.createBuffer(1, Math.max(1, Math.floor(rate * duration)), rate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
    return buf;
  }

  function envGain(t0, attack, peak, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  // --- one-shot sounds ------------------------------------------------

  // 發射：噪聲脈衝 through a lowpass, snappy 0.18s.
  function playShot() {
    var t0 = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.2);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t0);
    lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
    var g = envGain(t0, 0.005, 0.5, 0.18);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.22);
  }

  // 爆炸：低頻轟 (sine sweep 90->28Hz) + dark noise rumble, ~0.7s.
  function playExplosion() {
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.6);
    var og = envGain(t0, 0.008, 0.85, 0.6);
    osc.connect(og).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.7);

    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.5);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t0);
    lp.frequency.exponentialRampToValueAtTime(80, t0 + 0.5);
    var ng = envGain(t0, 0.005, 0.45, 0.45);
    src.connect(lp).connect(ng).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.5);
  }

  // 點擊：short square blip for menu moves.
  function playClick() {
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 620;
    var g = envGain(t0, 0.003, 0.18, 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.09);
  }

  // 限時警告嘀：two quick 880Hz square pips.
  function playBeep() {
    var t0 = ctx.currentTime;
    for (var i = 0; i < 2; i++) {
      var at = t0 + i * 0.12;
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 880;
      var g = envGain(at, 0.004, 0.16, 0.07);
      osc.connect(g).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.1);
    }
  }

  // 命中悶響：a shell actually connecting — low thump + a hard noise tap.
  function playHit() {
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.22);
    var og = envGain(t0, 0.005, 0.6, 0.25);
    osc.connect(og).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.3);

    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.08);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    var ng = envGain(t0, 0.002, 0.3, 0.07);
    src.connect(hp).connect(ng).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.1);
  }

  // --- charge tone (directional) + flight whistle (start/stop pairs) ---

  var charge = null; // {osc, g} while the charge tone is live

  function chargeStart() {
    if (!ok() || charge) { return; }
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0); // the scene steers it via chargeTone()
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    charge = { osc: osc, g: g };
  }

  /**
   * chargeTone(freq) — steer the live charge tone's pitch. The scene maps
   * it to the charge POWER (not time), so it rises while the curve rises
   * and FALLS on the descent — the ear confirms "力度能大也能小".
   */
  function chargeTone(freq) {
    if (!charge) { return; }
    charge.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.03);
  }

  function chargeStop() {
    if (!charge) { return; }
    var now = ctx.currentTime;
    charge.g.gain.cancelScheduledValues(now);
    charge.g.gain.setValueAtTime(charge.g.gain.value || 0.1, now);
    charge.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    charge.osc.stop(now + 0.1);
    charge = null;
  }

  var whistle = null; // {osc, g} while a shell is in the air

  function whistleStart() {
    if (!ok() || whistle) { return; }
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.linearRampToValueAtTime(980, t0 + 0.45); // dive feels faster
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.08);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    whistle = { osc: osc, g: g };
  }

  function whistleStop() {
    if (!whistle) { return; }
    var now = ctx.currentTime;
    whistle.g.gain.cancelScheduledValues(now);
    whistle.g.gain.setValueAtTime(whistle.g.gain.value || 0.06, now);
    whistle.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    whistle.osc.stop(now + 0.07);
    whistle = null;
  }

  /**
   * play(name) — 'shot' | 'explosion' | 'click' | 'beep' | 'hit'. Inert
   * while muted or before unlock(); charge/whistle use their start/stop
   * pairs (and chargeTone).
   */
  function play(name) {
    if (!ok()) { return; }
    if (name === 'shot') { playShot(); }
    else if (name === 'explosion') { playExplosion(); }
    else if (name === 'click') { playClick(); }
    else if (name === 'beep') { playBeep(); }
    else if (name === 'hit') { playHit(); }
  }

  function toggleMuted() {
    muted = !muted;
    saveMute();
    if (muted) { chargeStop(); }
    return muted;
  }

  CC.Audio = {
    unlock: unlock,
    play: play,
    chargeStart: chargeStart,
    chargeTone: chargeTone,
    chargeStop: chargeStop,
    whistleStart: whistleStart,
    whistleStop: whistleStop,
    toggleMuted: toggleMuted,
    isMuted: function () { return muted; },
    MUTE_KEY: MUTE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
