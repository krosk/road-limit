import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gravityInDeviceFrame,
  removeGravity,
  phoneToWorldFrame,
  worldToCarFrame,
  applyEMA,
} from '../lib/motion.js';

const approx = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

// ── gravityInDeviceFrame ──────────────────────────────────────────────────────

test('gravityInDeviceFrame(0, 0): flat phone → gz=+9.81', () => {
  const g = gravityInDeviceFrame(0, 0);
  assert.ok(approx(g.x, 0), `Expected x≈0, got ${g.x}`);
  assert.ok(approx(g.y, 0), `Expected y≈0, got ${g.y}`);
  assert.ok(approx(g.z, 9.81), `Expected z≈+9.81, got ${g.z}`);
});

test('gravityInDeviceFrame(90, 0): upright portrait → gy=-9.81', () => {
  const g = gravityInDeviceFrame(90, 0);
  assert.ok(approx(g.x, 0), `Expected x≈0, got ${g.x}`);
  assert.ok(approx(g.y, -9.81), `Expected y≈-9.81, got ${g.y}`);
  assert.ok(approx(g.z, 0), `Expected z≈0, got ${g.z}`);
});

// ── removeGravity ─────────────────────────────────────────────────────────────

test('removeGravity: stationary upright phone → all ≈ 0', () => {
  // Upright portrait (beta=90, gamma=0): gravity is (0, -9.81, 0)
  const r = removeGravity(0, -9.81, 0, 90, 0);
  assert.ok(approx(r.x, 0), `Expected x≈0, got ${r.x}`);
  assert.ok(approx(r.y, 0), `Expected y≈0, got ${r.y}`);
  assert.ok(approx(r.z, 0), `Expected z≈0, got ${r.z}`);
});

test('removeGravity: stationary flat phone → all ≈ 0', () => {
  // Flat (beta=0, gamma=0): gravity is (0, 0, +9.81)
  const r = removeGravity(0, 0, 9.81, 0, 0);
  assert.ok(approx(r.x, 0), `Expected x≈0, got ${r.x}`);
  assert.ok(approx(r.y, 0), `Expected y≈0, got ${r.y}`);
  assert.ok(approx(r.z, 0), `Expected z≈0, got ${r.z}`);
});

// ── phoneToWorldFrame ─────────────────────────────────────────────────────────

test('phoneToWorldFrame(0, 0, -2, 90, 0): upright portrait deceleration → north=-2', () => {
  const w = phoneToWorldFrame(0, 0, -2, 90, 0);
  assert.ok(approx(w.east, 0), `Expected east≈0, got ${w.east}`);
  assert.ok(approx(w.north, -2), `Expected north≈-2, got ${w.north}`);
  assert.ok(approx(w.up, 0), `Expected up≈0, got ${w.up}`);
});

test('phoneToWorldFrame(2, 0, 0, 0, 0): flat phone east accel → east=2', () => {
  const w = phoneToWorldFrame(2, 0, 0, 0, 0);
  assert.ok(approx(w.east, 2), `Expected east≈2, got ${w.east}`);
  assert.ok(approx(w.north, 0), `Expected north≈0, got ${w.north}`);
  assert.ok(approx(w.up, 0), `Expected up≈0, got ${w.up}`);
});

// ── worldToCarFrame ───────────────────────────────────────────────────────────

test('worldToCarFrame(1, 0, 0): east accel, heading north → forward≈0, lateral≈1', () => {
  const c = worldToCarFrame(1, 0, 0);
  assert.ok(approx(c.forward, 0), `Expected forward≈0, got ${c.forward}`);
  assert.ok(approx(c.lateral, 1), `Expected lateral≈1, got ${c.lateral}`);
});

test('worldToCarFrame(1, 0, 90): east accel, heading east → forward≈1, lateral≈0', () => {
  const c = worldToCarFrame(1, 0, 90);
  assert.ok(approx(c.forward, 1), `Expected forward≈1, got ${c.forward}`);
  assert.ok(approx(c.lateral, 0), `Expected lateral≈0, got ${c.lateral}`);
});

test('worldToCarFrame(0, 1, 0): north accel, heading north → forward≈1, lateral≈0', () => {
  const c = worldToCarFrame(0, 1, 0);
  assert.ok(approx(c.forward, 1), `Expected forward≈1, got ${c.forward}`);
  assert.ok(approx(c.lateral, 0), `Expected lateral≈0, got ${c.lateral}`);
});

// ── applyEMA ─────────────────────────────────────────────────────────────────

test('applyEMA(0, 1, 1): alpha=1 → 1 exactly', () => {
  assert.strictEqual(applyEMA(0, 1, 1), 1);
});

test('applyEMA: 100 iterations alpha=0.1 → converges >0.99', () => {
  let val = 0;
  for (let i = 0; i < 100; i++) {
    val = applyEMA(val, 1, 0.1);
  }
  assert.ok(val > 0.99, `Expected >0.99 after 100 iterations, got ${val}`);
});
