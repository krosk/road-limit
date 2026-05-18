import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpeed,
  distToSegment,
  collectAhead,
  detectTurn,
  detectAllTurns,
  corneringSpeed,
  isSingleRoadAhead,
  segmentsAhead,
  normaliseFeatures,
} from '../lib/road.js';
import { haversine } from '../lib/geo.js';

// ── parseSpeed ───────────────────────────────────────────────────────────────

test('parseSpeed: "50" → 50', () => {
  assert.strictEqual(parseSpeed('50'), 50);
});

test('parseSpeed: "130" → 130', () => {
  assert.strictEqual(parseSpeed('130'), 130);
});

test('parseSpeed: "30 mph" → 48', () => {
  assert.strictEqual(parseSpeed('30 mph'), 48);
});

test('parseSpeed: null → null', () => {
  assert.strictEqual(parseSpeed(null), null);
});

test('parseSpeed: "walk" → null', () => {
  assert.strictEqual(parseSpeed('walk'), null);
});

// ── distToSegment ────────────────────────────────────────────────────────────

test('distToSegment: point at midpoint of segment → ~0m', () => {
  // Segment from lon=2.0 to lon=2.01 at lat=48.0
  const c1 = [2.0,   48.0];
  const c2 = [2.01,  48.0];
  // Midpoint is at lon=2.005, lat=48.0
  const d = distToSegment(2.005, 48.0, c1, c2);
  assert.ok(d < 5, `Expected ~0m, got ${d}`);
});

test('distToSegment: point off perpendicular → 50–200m', () => {
  // Segment along lat=48.0 from lon=2.0 to lon=2.01
  // Point is 0.001° north of midpoint ≈ 111m offset
  const c1 = [2.0,   48.0];
  const c2 = [2.01,  48.0];
  const d = distToSegment(2.005, 48.001, c1, c2);
  assert.ok(d >= 50 && d <= 200, `Expected 50–200m, got ${d}`);
});

// ── collectAhead ─────────────────────────────────────────────────────────────

test('collectAhead forward: starts at index 1, gets remaining coords', () => {
  const coords = [
    [2.0, 48.0],
    [2.001, 48.0],
    [2.002, 48.0],
    [2.003, 48.0],
  ];
  const result = collectAhead(coords, 1, true, 100000);
  assert.deepStrictEqual(result, [
    [2.001, 48.0],
    [2.002, 48.0],
    [2.003, 48.0],
  ]);
});

test('collectAhead backward: starts at index 2, gets reversed coords', () => {
  const coords = [
    [2.0, 48.0],
    [2.001, 48.0],
    [2.002, 48.0],
    [2.003, 48.0],
  ];
  const result = collectAhead(coords, 2, false, 100000);
  assert.deepStrictEqual(result, [
    [2.002, 48.0],
    [2.001, 48.0],
    [2.0, 48.0],
  ]);
});

// ── detectTurn ───────────────────────────────────────────────────────────────

test('detectTurn: collinear points → null (circumradius = Infinity)', () => {
  const pts = [
    [2.0, 48.0],
    [2.0, 48.001],
    [2.0, 48.002],
    [2.0, 48.003],
  ];
  assert.strictEqual(detectTurn(pts), null);
});

test('detectTurn: 90° east-then-north turn → detected, angle 80–100°', () => {
  // ~74m east then ~111m north at lat 48 — circumradius ≈ 66m, well under default 2000m
  const pts = [
    [2.0,   48.0],
    [2.001, 48.0],
    [2.001, 48.001],
    [2.001, 48.002],
  ];
  const result = detectTurn(pts);
  assert.ok(result !== null, 'Expected a turn to be detected');
  assert.ok(result.angle >= 80 && result.angle <= 100,
    `Expected angle 80–100°, got ${result.angle}`);
});

test('detectTurn: gentle curve below maxRadius threshold → detected', () => {
  // Slight curve: go east, then slightly north-east — small angle but real curve
  const pts = [
    [2.0,   48.0],
    [2.005, 48.0],
    [2.010, 48.001], // gentle curve, large radius
  ];
  const result = detectTurn(pts, 100000); // very large maxRadius to catch gentle curves
  assert.ok(result !== null, 'Expected gentle curve to be detected with large maxRadius');
});

test('detectTurn: gentle curve above maxRadius threshold → null', () => {
  const pts = [
    [2.0,   48.0],
    [2.005, 48.0],
    [2.010, 48.001],
  ];
  const result = detectTurn(pts, 10); // very small maxRadius — only extremely tight curves
  assert.strictEqual(result, null);
});

// ── detectAllTurns ────────────────────────────────────────────────────────────

test('detectAllTurns: S-bend (two 90° turns) → returns 2 turns', () => {
  // Go east, turn north, go north, turn east again (S-bend with 4 nodes of straight between turns)
  const pts = [
    [2.0,   48.0],
    [2.001, 48.0],   // going east
    [2.001, 48.001], // first turn: east→north
    [2.001, 48.002],
    [2.001, 48.003],
    [2.001, 48.004],
    [2.002, 48.004], // second turn: north→east
    [2.003, 48.004],
  ];
  const result = detectAllTurns(pts, 2000);
  assert.ok(result.length >= 2, `Expected at least 2 turns, got ${result.length}`);
});

test('detectAllTurns: straight road → empty array', () => {
  const pts = [[2.0, 48.0], [2.0, 48.001], [2.0, 48.002], [2.0, 48.003]];
  assert.deepStrictEqual(detectAllTurns(pts), []);
});

// ── corneringSpeed ───────────────────────────────────────────────────────────

test('corneringSpeed: radius=100m, a=0.3*9.81 → speed in 50–80 km/h range', () => {
  const speed = corneringSpeed(100, 0.3 * 9.81);
  assert.ok(speed >= 50 && speed <= 80, `Expected 50–80 km/h, got ${speed}`);
});

test('corneringSpeed: Infinity → null', () => {
  assert.strictEqual(corneringSpeed(Infinity, 0.3 * 9.81), null);
});

// ── isSingleRoadAhead ────────────────────────────────────────────────────────

test('isSingleRoadAhead: 1 segment → true', () => {
  assert.strictEqual(isSingleRoadAhead([{ pts: [], speedLimit: null, turn: null }]), true);
});

test('isSingleRoadAhead: 2 segments → false', () => {
  assert.strictEqual(isSingleRoadAhead([
    { pts: [], speedLimit: null, turn: null },
    { pts: [], speedLimit: null, turn: null },
  ]), false);
});

test('isSingleRoadAhead: 1 forward + 1 behind → true (behind not counted)', () => {
  assert.strictEqual(isSingleRoadAhead([
    { pts: [], speedLimit: null, turn: null, isBehind: true },
    { pts: [], speedLimit: null, turn: null },
  ]), true);
});

// ── segmentsAhead ────────────────────────────────────────────────────────────

test('segmentsAhead: road going east, heading east → 1 segment', () => {
  // Current position at lon=2.348, lat=48.853, heading east (90°)
  // Road goes east from just behind current position
  const lon = 2.348, lat = 48.853;
  const features = [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.346, 48.853],  // slightly west of current pos
        [2.348, 48.853],  // current pos
        [2.350, 48.853],  // east of current pos
        [2.352, 48.853],  // further east
      ],
    },
    properties: {},
  }];
  const segs = segmentsAhead(features, lon, lat, 90, 500);
  assert.strictEqual(segs.length, 1, `Expected 1 segment, got ${segs.length}`);
});

test('segmentsAhead: road going east, heading west → 0 segments', () => {
  // Heading west (270°) — road goes east → should not match
  const lon = 2.346, lat = 48.853;
  const features = [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.348, 48.853],  // east of current pos
        [2.350, 48.853],
        [2.352, 48.853],
      ],
    },
    properties: {},
  }];
  const segs = segmentsAhead(features, lon, lat, 270, 500);
  assert.strictEqual(segs.length, 0, `Expected 0 segments, got ${segs.length}`);
});

test('segmentsAhead: BFS reaches roads two hops from the current road', () => {
  // Road A: car is on this, heading east
  // Road B: connects to A's eastern end, goes north
  // Road C: connects to B's northern end, goes east (two hops from car)
  // Old one-level code misses C; BFS should include all three.
  const lon = 2.348, lat = 48.853;
  const roadA = { type: 'Feature', geometry: { type: 'LineString', coordinates:
    [[2.346, 48.853], [2.350, 48.853], [2.352, 48.853]] }, properties: {} };
  const roadB = { type: 'Feature', geometry: { type: 'LineString', coordinates:
    [[2.352, 48.853], [2.352, 48.855], [2.352, 48.857]] }, properties: {} };
  const roadC = { type: 'Feature', geometry: { type: 'LineString', coordinates:
    [[2.352, 48.857], [2.354, 48.857], [2.356, 48.857]] }, properties: {} };

  const segs = segmentsAhead([roadA, roadB, roadC], lon, lat, 90, 10000);
  assert.ok(segs.length >= 3, `Expected at least 3 segments (A, B, C), got ${segs.length}`);
});

test('segmentsAhead: lookBehind > 0 → includes segment behind car', () => {
  // Car at lon=2.350, heading east (90°)
  // Road extends both west (behind) and east (ahead)
  const lon = 2.350, lat = 48.853;
  const features = [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.346, 48.853],  // behind
        [2.348, 48.853],  // behind
        [2.350, 48.853],  // at car
        [2.352, 48.853],  // ahead
        [2.354, 48.853],  // ahead
      ],
    },
    properties: {},
  }];
  const segsNoLookBehind = segmentsAhead(features, lon, lat, 90, 500, 2000, 0);
  const segsWithLookBehind = segmentsAhead(features, lon, lat, 90, 500, 2000, 500);
  assert.strictEqual(segsNoLookBehind.length, 1, `Without lookBehind expected 1, got ${segsNoLookBehind.length}`);
  assert.strictEqual(segsWithLookBehind.length, 2, `With lookBehind expected 2, got ${segsWithLookBehind.length}`);
});

// ── normaliseFeatures ─────────────────────────────────────────────────────────

const coords = [[2, 48], [2.001, 48]];

test('normaliseFeatures: empty input → empty output', () => {
  assert.deepEqual(normaliseFeatures([]), []);
});

test('normaliseFeatures: LineString passed through unchanged', () => {
  const feat = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
  const result = normaliseFeatures([feat]);
  assert.equal(result.length, 1);
  assert.equal(result[0].geometry.type, 'LineString');
  assert.deepEqual(result[0].geometry.coordinates, coords);
});

test('normaliseFeatures: MultiLineString expanded into separate LineStrings', () => {
  const coords2 = [[2.002, 48], [2.003, 48]];
  const feat = {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: [coords, coords2] },
    properties: { name: 'road' },
  };
  const result = normaliseFeatures([feat]);
  assert.equal(result.length, 2);
  assert.equal(result[0].geometry.type, 'LineString');
  assert.equal(result[1].geometry.type, 'LineString');
  assert.deepEqual(result[0].geometry.coordinates, coords);
  assert.deepEqual(result[1].geometry.coordinates, coords2);
});

test('normaliseFeatures: expanded features inherit properties', () => {
  const feat = {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: [coords, coords] },
    properties: { maxspeed: '50' },
  };
  const result = normaliseFeatures([feat]);
  assert.equal(result[0].properties.maxspeed, '50');
  assert.equal(result[1].properties.maxspeed, '50');
});

test('normaliseFeatures: unknown geometry types ignored', () => {
  const feat = { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] }, properties: {} };
  assert.deepEqual(normaliseFeatures([feat]), []);
});

test('normaliseFeatures: mixed input normalised correctly', () => {
  const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
  const multi = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [coords, coords] }, properties: {} };
  const result = normaliseFeatures([line, multi]);
  assert.equal(result.length, 3);
  assert.ok(result.every(f => f.geometry.type === 'LineString'));
});
