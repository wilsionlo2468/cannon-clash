'use strict';

/*
 * Tests for per-weapon wind susceptibility (Phase 6): simulate() scales
 * the wind acceleration by WEAPON_WIND_K — heavy shells punch through
 * crosswind (0.6x), pierce rounds drift more (1.2x); unknown/omitted
 * weapons take the full 1.0. The AI's solver and the view's flight
 * integration both route through simulate(), so the coefficient applies
 * everywhere without a second implementation.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/terrain.js');
T.reset();
const B = require('../src/core/ballistics.js');

const WIND = 5;
const POWER = 90;

function drift(weapon) {
  const calm = B.simulate(250, 390, 45, POWER, 0, weapon).impact.x;
  const windy = B.simulate(250, 390, 45, POWER, WIND, weapon).impact.x;
  return windy - calm;
}

test('WEAPON_WIND_K is pinned: heavy 0.6, pierce 1.2, normal/cluster 1', () => {
  assert.deepStrictEqual(B.WEAPON_WIND_K, { normal: 1, heavy: 0.6, pierce: 1.2, cluster: 1 });
});

test('heavy drifts less than normal; pierce drifts more', () => {
  const dNormal = drift('normal');
  const dHeavy = drift('heavy');
  const dPierce = drift('pierce');
  assert.ok(dNormal > 30, 'wind matters at all: ' + dNormal.toFixed(1));
  assert.ok(Math.abs(dHeavy / dNormal - 0.6) < 0.05, 'heavy ~0.6x: ' + (dHeavy / dNormal).toFixed(3));
  assert.ok(Math.abs(dPierce / dNormal - 1.2) < 0.05, 'pierce ~1.2x: ' + (dPierce / dNormal).toFixed(3));
});

test('omitted or unknown weapon defaults to full wind (1.0)', () => {
  const dNone = drift(undefined);
  const dNormal = drift('normal');
  assert.ok(Math.abs(dNone - dNormal) < 0.5, 'no weapon === normal');
  const dNuke = drift('nuke');
  assert.ok(Math.abs(dNuke - dNormal) < 0.5, 'unknown weapon === normal');
});

test('headwind mirrors tailwind (coefficient is symmetric)', () => {
  const calm = B.simulate(250, 390, 45, POWER, 0, 'heavy').impact.x;
  const tail = B.simulate(250, 390, 45, POWER, WIND, 'heavy').impact.x;
  const head = B.simulate(250, 390, 45, POWER, -WIND, 'heavy').impact.x;
  assert.ok(Math.abs((tail - calm) + (head - calm)) < 1.5, 'drift is antisymmetric');
});
