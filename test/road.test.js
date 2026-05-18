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
  firstTurnAhead,
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

test('segmentsAhead: backward BFS junction branch filtered when heading provided', () => {
  // Car heading north (0°) at (2.0, 48.0).
  // roadA goes north — BFS collects it forward.
  // roadB shares roadA's ahead node and goes south — net bearing ≈ 180°,
  //   which is >90° from heading → must be filtered from the overlay.
  const lon = 2.0, lat = 48.0;
  const roadA = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 47.999], [2.0, 48.0], [2.0, 48.001], [2.0, 48.002],
    ]},
    properties: {},
  };
  const roadB = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.001], [2.0, 48.0005], [2.0, 47.999],
    ]},
    properties: {},
  };
  const segsWithHeading    = segmentsAhead([roadA, roadB], lon, lat, 0, 500);
  const segsWithoutHeading = segmentsAhead([roadA, roadB], lon, lat, null, 500);
  assert.strictEqual(segsWithHeading.length, 1,
    `Expected 1 (backward branch filtered), got ${segsWithHeading.length}`);
  assert.ok(segsWithoutHeading.length >= 2,
    `Without heading filter expected ≥2, got ${segsWithoutHeading.length}`);
});

// ── firstTurnAhead ─────────────────────────────────────────────────────────────

const A = 0.30 * 9.81;
const MAX_R = 2000;

const leftTurnFeature = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [
    [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 48.001],
  ]},
  properties: {},
};

const rightTurnFeature = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [
    [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 47.999],
  ]},
  properties: {},
};

const straightFeature = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [
    [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.003, 48.0],
  ]},
  properties: {},
};

test('firstTurnAhead: no features → null', () => {
  assert.strictEqual(firstTurnAhead([], 2.0, 48.0, 90, 500, MAX_R, A), null);
});

test('firstTurnAhead: straight road → null', () => {
  assert.strictEqual(firstTurnAhead([straightFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50), null);
});

test('firstTurnAhead: 90° left turn (east→north) within lookahead → direction left', () => {
  const result = firstTurnAhead([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(result !== null, 'Expected turn to be detected');
  assert.strictEqual(result.direction, 'left');
});

test('firstTurnAhead: 90° right turn (east→south) within lookahead → direction right', () => {
  const result = firstTurnAhead([rightTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(result !== null, 'Expected turn to be detected');
  assert.strictEqual(result.direction, 'right');
});

test('firstTurnAhead: turn beyond lookahead → null', () => {
  // Turn node is at cumdist ≈ 73 m — only find it with lookahead > 73 m
  assert.strictEqual(firstTurnAhead([leftTurnFeature], 2.0, 48.0, 90, 50, MAX_R, A, 50), null);
});

test('firstTurnAhead: track branching off a tertiary road does not suppress turn card', () => {
  // Car heading east on a tertiary road that turns left (north) ahead.
  // A track branches northward from the same junction.
  // Both pass the net-bearing filter (90° from heading), but the track
  // has class=track → MINOR_CLASSES → discarded, leaving 1 group → turn shown.
  const tertiaryRoad = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 48.001],
    ]},
    properties: { class: 'tertiary' },
  };
  const trackBranch = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.002, 48.0], [2.002, 48.001], [2.002, 48.002],
    ]},
    properties: { class: 'track' },
  };
  const result = firstTurnAhead([tertiaryRoad, trackBranch], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(result !== null, 'track branch should be discarded; turn card must show');
  assert.strictEqual(result.direction, 'left');
});

test('firstTurnAhead: junction (2 forward segments) → null', () => {
  // Branch road with second node ~89 m away — fits within 120 m budget
  const branchFeature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.001, 48.0], [2.001, 48.0008],
    ]},
    properties: {},
  };
  const result = firstTurnAhead([leftTurnFeature, branchFeature], 2.0, 48.0, 90, 120, MAX_R, A, 50);
  assert.strictEqual(result, null);
});

test('firstTurnAhead: short feature-boundary stub does not create spurious junction', () => {
  // Two features share a node. The car is matched to feature A between nodes 1 and 2
  // (heading south → forward=false → segIdx=1). The BFS walk gives only [node1, node0]
  // = 2 pts, ~24 m going SSW (204°). Feature B starts at node1 and continues south
  // for 7 pts (~165°), ending in a right turn. Without the min-length guard the stub
  // creates a second direction group (39° apart from longCont) → junction. With the
  // guard (stub <30 m cannot create a group) the stub joins B's group within the
  // wider 45° tolerance, leaving 1 direction group → turn card shown.
  const shortStub = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0001, 48.0000],  // node 0 — south endpoint
      [2.0002, 48.0002],  // node 1 — junction with longContinuation
      [2.0003, 48.0004],  // node 2 — car is between node1 and node2
      [2.0004, 48.0006],  // node 3 — north end
    ]},
    properties: {},
  };
  const longContinuation = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0002, 48.0002],  // node 0 — shared with shortStub node 1
      [2.0001, 47.9999],  // going SSW
      [2.0001, 47.9996],
      [2.0001, 47.9993],
      [2.0001, 47.9990],
      [2.0004, 47.9990],  // right turn going east
      [2.0007, 47.9990],
    ]},
    properties: {},
  };
  // Car exactly on shortStub segment [node1→node2], heading south (180°).
  // Segment bears NNE so forward=false, segIdx=1.
  // Walk backward: [node1, node0] = 2 pts, ~23 m — cannot create a direction group.
  // longCont 7-pt walk has net bearing ~165° and length >30 m — creates the group.
  // 23 m stub (204°) joins that group within the 45° tolerance (angDiff=39°).
  // 1 group → turn detection runs on longCont's pts → right turn is detected.
  const result = firstTurnAhead([shortStub, longContinuation], 2.00025, 48.0003, 180, 500, MAX_R, A, 50);
  assert.ok(result !== null, 'short stub should join the longer segment\'s group, not create a spurious junction');
});

test('firstTurnAhead: backward BFS branch does not suppress turn card', () => {
  // A road heading south then turning right (west), with a branch heading north from
  // the junction. The north branch is 180° from the car's heading (180°) — a "backward"
  // BFS branch produced because BFS always explores both directions at junction nodes.
  // With the heading filter (>90° from heading filtered out), the north branch is
  // discarded and the turn card is shown.
  const southToWestRoad = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.002], [2.0, 48.001], [2.0, 48.0], [1.999, 48.0],
    ]},
    properties: {},
  };
  const northBranch = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.001], [2.0, 48.003],
    ]},
    properties: {},
  };
  const result = firstTurnAhead([southToWestRoad, northBranch], 2.0, 48.002, 180, 500, MAX_R, A, 50);
  assert.ok(result !== null, 'northward branch (>90° from heading) should be filtered; turn card must show');
  assert.strictEqual(result.direction, 'right');
});

test('firstTurnAhead: distanceToStart > 0 for non-immediate turn', () => {
  const result = firstTurnAhead([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(result !== null);
  assert.ok(result.distanceToStart > 0, `Expected distanceToStart > 0, got ${result.distanceToStart}`);
});

test('firstTurnAhead: minSpeed > 0', () => {
  const result = firstTurnAhead([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(result !== null);
  assert.ok(result.minSpeed !== null && result.minSpeed > 0);
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
  const coords2 = [[2.002, 48], [2.003, 48]];
  const feat = {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: [coords, coords2] },
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
  const c2 = [[2.002, 48], [2.003, 48]];
  const c3 = [[2.004, 48], [2.005, 48]];
  const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
  const multi = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [c2, c3] }, properties: {} };
  const result = normaliseFeatures([line, multi]);
  assert.equal(result.length, 3);
  assert.ok(result.every(f => f.geometry.type === 'LineString'));
});
