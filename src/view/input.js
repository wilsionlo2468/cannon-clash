/* CC.Input — keyboard state + global keys, dispatching to the active
 * scene sink (browser global). Unified control map (both clusters drive
 * whichever side holds the turn — hot-seat, no per-side key sets):
 *   A/D or ←/→  walk (AIM only, per-turn budget)
 *   W/S or ↑/↓  elevation ±40 deg/s (clamped 0..85)
 *   SPACE hold→release  charge & fire (ping-pong curve, release = power)
 *   Q/E or Tab  cycle weapon (E/Tab forward, Q back)
 *   Global: M mute, ESC back to title, F fullscreen.
 * The active scene (CC.Scenes) receives keyDown(key, e) / keyUp(key, e)
 * / update(dt) through setSink(); input.js itself owns only the held-key
 * set and the global keys.
 */
(function (root) {
  'use strict';

  var CC = (root.CC = root.CC || {});

  // Elevation rate pinned by the task brief: 40 degrees per second.
  var ANGLE_RATE = 40;

  function normalize(key) {
    // letters: case-insensitive ('a' and 'A' are the same control);
    // everything else (' ', 'Enter', 'ArrowLeft', 'Escape', ...) verbatim.
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function create() {
    var held = Object.create(null); // normalized key -> true while down (cleared on blur)
    var sink = null;                // active scene handler (may be null)

    function onKeyDown(e) {
      CC.Audio.unlock(); // first-gesture audio unlock (autoplay policy)
      var key = normalize(e.key);
      held[key] = true;
      // The active scene sees the key first; returning true consumes it
      // (the title's name entry swallows 'm', everything else falls
      // through to the global keys below).
      // keep arrows/space from scrolling the page (no other scrollable
      // content; harmless when a scene consumes them)
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' ||
          key === 'ArrowRight' || key === ' ') { e.preventDefault(); }
      if (sink && sink.keyDown && sink.keyDown(key, e) === true) { return; }
      // Global keys (unconsumed): M mute, F fullscreen. ESC is scene-flow
      // and is handled by the scene's keyDown.
      if (key === 'm' && !e.repeat) { CC.Audio.toggleMuted(); return; }
      if (key === 'f' && !e.repeat) { toggleFullscreen(); return; }
    }

    function onKeyUp(e) {
      var key = normalize(e.key);
      held[key] = false;
      if (sink && sink.keyUp) { sink.keyUp(key, e); }
    }

    function toggleFullscreen() {
      var doc = root.document;
      if (doc.fullscreenElement) {
        if (doc.exitFullscreen) { doc.exitFullscreen(); }
      } else if (doc.documentElement.requestFullscreen) {
        doc.documentElement.requestFullscreen();
      }
    }

    function onBlur() {
      // window lost focus: no keyup will arrive — drop every held key so
      // elevation does not keep drifting after alt-tab (review minor)
      held = Object.create(null);
    }

    return {
      /** Install the window listeners (called once by main.js). */
      attach: function () {
        root.addEventListener('keydown', onKeyDown);
        root.addEventListener('keyup', onKeyUp);
        root.addEventListener('blur', onBlur);
      },
      /** Swap the active scene sink: {keyDown?, keyUp?, update?}. */
      setSink: function (s) { sink = s; },
      /** Is a normalized key currently held down? */
      isDown: function (key) { return !!held[normalize(key)]; },
      ANGLE_RATE: ANGLE_RATE
    };
  }

  CC.Input = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
