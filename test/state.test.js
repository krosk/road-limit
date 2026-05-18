import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyGPS, smoothCompass, applyMotion } from '../lib/state.js';

const MIN_SPEED = 5 / 3.6; // m/s

describe('createState', () => {
  test('initial position is null', () => {
    const s = createState();
    assert.equal(s.lat, null);
    assert.equal(s.lon, null);
  });

  test('initial speed is 0', () => {
    assert.equal(createState().speed, 0);
  });

  test('initial heading is null, lastHeading is 0', () => {
    const s = createState();
    assert.equal(s.heading, null);
    assert.equal(s.lastHeading, 0);
  });
});

describe('applyGPS', () => {
  test('updates lat/lon/accuracy', () => {
    const s = createState();
    const next = applyGPS(s, { latitude: 48.853, longitude: 2.348, speed: 0, heading: null, accuracy: 10 }, MIN_SPEED);
    assert.equal(next.lat, 48.853);
    assert.equal(next.lon, 2.348);
    assert.equal(next.accuracy, 10);
  });

  test('stores previous position', () => {
    const next = applyGPS(createState(), { latitude: 48.1, longitude: 2.1, speed: 0, heading: null, accuracy: 5 }, MIN_SPEED);
    assert.equal(next.prevLat, 48.1);
    assert.equal(next.prevLon, 2.1);
  });

  test('null speed treated as 0', () => {
    const next = applyGPS(createState(), { latitude: 48.853, longitude: 2.348, speed: null, heading: 90, accuracy: 5 }, MIN_SPEED);
    assert.equal(next.speed, 0);
  });

  test('speed below threshold — heading not updated', () => {
    const s = { ...createState(), heading: 45, lastHeading: 45 };
    const next = applyGPS(s, { latitude: 48.853, longitude: 2.348, speed: 1, heading: 90, accuracy: 5 }, MIN_SPEED);
    assert.equal(next.heading, 45);
    assert.equal(next.lastHeading, 45);
  });

  test('speed above threshold with GPS heading — heading updated', () => {
    const next = applyGPS(createState(), { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 5 }, MIN_SPEED);
    assert.equal(next.heading, 90);
    assert.equal(next.lastHeading, 90);
  });

  test('speed above threshold, no GPS heading, prev position — computed from bearing', () => {
    const s = { ...createState(), prevLat: 48.853, prevLon: 2.346 };
    const next = applyGPS(s, { latitude: 48.853, longitude: 2.350, speed: 10, heading: null, accuracy: 5 }, MIN_SPEED);
    assert.ok(Math.abs(next.heading - 90) < 1, `expected ~90°, got ${next.heading}`);
  });

  test('speed above threshold, no GPS heading, no prev — heading unchanged', () => {
    const s = { ...createState(), heading: 45, lastHeading: 45 };
    const next = applyGPS(s, { latitude: 48.853, longitude: 2.348, speed: 10, heading: null, accuracy: 5 }, MIN_SPEED);
    assert.equal(next.heading, 45);
  });

  test('does not mutate original state', () => {
    const s = createState();
    const copy = { ...s };
    applyGPS(s, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 5 }, MIN_SPEED);
    assert.deepEqual(s, copy);
  });
});

describe('smoothCompass', () => {
  test('first call — returns alpha directly', () => {
    assert.equal(smoothCompass(null, 90), 90);
  });

  test('returns value in [0, 360)', () => {
    const v = smoothCompass(350, 10);
    assert.ok(v >= 0 && v < 360);
  });

  test('steps toward new value', () => {
    const next = smoothCompass(0, 100);
    assert.ok(next > 0 && next < 100);
  });

  test('wraps forward across 0 — 350 toward 10 steps clockwise', () => {
    // diff = 10 - 350 = -340 → wrap to +20 → step = 0.1*20 = +2 → ≈ 352
    const next = smoothCompass(350, 10);
    assert.ok(next > 350 || next < 5, `expected ≈352, got ${next}`);
  });

  test('wraps backward across 360 — 10 toward 350 steps counter-clockwise', () => {
    // diff = 350 - 10 = 340 → wrap to -20 → step = -2 → ≈ 8
    const next = smoothCompass(10, 350);
    assert.ok(next >= 7 && next <= 10, `expected ≈8, got ${next}`);
  });

  test('converges to target after many steps', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = smoothCompass(v, 90);
    assert.ok(Math.abs(v - 90) < 0.01, `expected ≈90, got ${v}`);
  });
});

describe('applyMotion', () => {
  test('returns null for empty event', () => {
    assert.equal(applyMotion(createState(), {}, 0.15), null);
  });

  test('returns null for event with null acceleration', () => {
    const event = { acceleration: { x: null, y: null, z: null } };
    assert.equal(applyMotion(createState(), event, 0.15), null);
  });

  test('returns new state from pure acceleration event', () => {
    const s = createState();
    const event = { acceleration: { x: 1.0, y: 0.0, z: 0.0 } };
    const next = applyMotion(s, event, 0.15);
    assert.notEqual(next, null);
    assert.ok(next.latG > 0 || next.longG > 0);
  });

  test('returns new state from accelerationIncludingGravity event', () => {
    const s = createState();
    const event = { accelerationIncludingGravity: { x: 1.0, y: -9.81, z: 0.0 } };
    const next = applyMotion(s, event, 0.15);
    assert.notEqual(next, null);
  });

  test('smoothLat and latG are identical in returned state', () => {
    const event = { acceleration: { x: 2.0, y: 0.0, z: 0.0 } };
    const next = applyMotion(createState(), event, 0.15);
    assert.equal(next.smoothLat, next.latG);
    assert.equal(next.smoothLong, next.longG);
  });

  test('does not mutate original state', () => {
    const s = createState();
    const copy = { ...s };
    applyMotion(s, { acceleration: { x: 1, y: 0, z: 0 } }, 0.15);
    assert.deepEqual(s, copy);
  });
});
