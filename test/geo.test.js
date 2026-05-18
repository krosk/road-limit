import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, bearingTo, angleDiff, circumradius, destPoint, ptAtDistance, bearingAtDistance } from '../lib/geo.js';

// ── haversine ────────────────────────────────────────────────────────────────

test('haversine: same point → 0', () => {
  assert.strictEqual(haversine(48.8566, 2.3522, 48.8566, 2.3522), 0);
});

test('haversine: Paris to Lyon ≈ 391 km', () => {
  // Paris: 48.8566, 2.3522  Lyon: 45.7640, 4.8357
  const d = haversine(48.8566, 2.3522, 45.7640, 4.8357);
  assert.ok(d >= 390000 && d <= 395000, `Expected ~391km, got ${d}`);
});

// ── bearingTo ────────────────────────────────────────────────────────────────

test('bearingTo: due north → ~0°', () => {
  const b = bearingTo(0, 0, 1, 0);
  assert.ok(b < 1 || b > 359, `Expected ~0°, got ${b}`);
});

test('bearingTo: due east → ~90°', () => {
  const b = bearingTo(0, 0, 0, 1);
  assert.ok(Math.abs(b - 90) < 1, `Expected ~90°, got ${b}`);
});

test('bearingTo: due south → ~180°', () => {
  const b = bearingTo(1, 0, 0, 0);
  assert.ok(Math.abs(b - 180) < 1, `Expected ~180°, got ${b}`);
});

// ── angleDiff ────────────────────────────────────────────────────────────────

test('angleDiff: same angle → 0', () => {
  assert.strictEqual(angleDiff(90, 90), 0);
});

test('angleDiff: wraps 355→5 → 10', () => {
  const d = angleDiff(355, 5);
  assert.ok(Math.abs(d - 10) < 0.001, `Expected 10, got ${d}`);
});

test('angleDiff: 0→180 → 180', () => {
  const d = angleDiff(0, 180);
  assert.ok(Math.abs(d - 180) < 0.001, `Expected 180, got ${d}`);
});

// ── circumradius ─────────────────────────────────────────────────────────────

test('circumradius: collinear points → Infinity', () => {
  // Three points on the same line going north
  const p1 = [2.0, 48.0];
  const p2 = [2.0, 48.001];
  const p3 = [2.0, 48.002];
  const r = circumradius(p1, p2, p3);
  assert.strictEqual(r, Infinity);
});

test('circumradius: 90° right-angle turn with ~80m segments → radius < 200m', () => {
  // Build a right-angle turn: go east 80m, then north 80m
  // Start at (lat=48.0, lon=2.0)
  // ~80m east ≈ 0.00072° lon at lat 48
  // ~80m north ≈ 0.00072° lat
  const p1 = [2.0,       48.0];       // [lon, lat]
  const p2 = [2.00072,   48.0];       // 80m east
  const p3 = [2.00072,   48.00072];   // 80m north from p2
  const r = circumradius(p1, p2, p3);
  assert.ok(r < 200, `Expected radius < 200m, got ${r}`);
  assert.ok(r > 0, `Expected positive radius, got ${r}`);
});

// ── destPoint ────────────────────────────────────────────────────────────────

test('destPoint: go 1000m north, haversine back ≈ 1000m', () => {
  const [lat2, lon2] = destPoint(48.0, 2.0, 0, 1000);
  const d = haversine(48.0, 2.0, lat2, lon2);
  assert.ok(Math.abs(d - 1000) < 2, `Expected ~1000m, got ${d}`);
});

test('destPoint: go 1000m north, bearing back ≈ 180°', () => {
  const [lat2, lon2] = destPoint(48.0, 2.0, 0, 1000);
  const b = bearingTo(lat2, lon2, 48.0, 2.0);
  assert.ok(Math.abs(b - 180) < 1, `Expected ~180°, got ${b}`);
});

// ── ptAtDistance ──────────────────────────────────────────────────────────────

// East-going polyline: each 0.001° lon ≈ 73 m at lat 48
const eastPts = [[2.000, 48.000], [2.001, 48.000], [2.002, 48.000]];

test('ptAtDistance: d=0 returns first point', () => {
  const p = ptAtDistance(eastPts, 0);
  assert.ok(Math.abs(p[0] - 2.000) < 0.0001);
  assert.ok(Math.abs(p[1] - 48.000) < 0.0001);
});

test('ptAtDistance: d > length returns last point', () => {
  const p = ptAtDistance(eastPts, 100000);
  assert.ok(Math.abs(p[0] - 2.002) < 0.0001);
});

test('ptAtDistance: midpoint of first segment', () => {
  const segLen = haversine(48.000, 2.000, 48.000, 2.001);
  const p = ptAtDistance(eastPts, segLen / 2);
  assert.ok(Math.abs(p[0] - 2.0005) < 0.0001, `expected lon ≈ 2.0005, got ${p[0]}`);
});

test('ptAtDistance: exactly at second node', () => {
  const segLen = haversine(48.000, 2.000, 48.000, 2.001);
  const p = ptAtDistance(eastPts, segLen);
  assert.ok(Math.abs(p[0] - 2.001) < 0.0001);
});

// ── bearingAtDistance ─────────────────────────────────────────────────────────

test('bearingAtDistance: eastward road returns ~90°', () => {
  const b = bearingAtDistance(eastPts, 50);
  assert.ok(Math.abs(b - 90) < 1, `expected ~90°, got ${b}`);
});

test('bearingAtDistance: northward road returns ~0°', () => {
  const northPts = [[2.000, 48.000], [2.000, 48.001], [2.000, 48.002]];
  const b = bearingAtDistance(northPts, 50);
  assert.ok(b < 1 || b > 359, `expected ~0°, got ${b}`);
});

test('bearingAtDistance: d beyond length returns bearing of last segment', () => {
  const b = bearingAtDistance(eastPts, 100000);
  assert.ok(Math.abs(b - 90) < 1);
});
