import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSpeed,
  distToSegment,
  matchRoad,
  collectAhead,
  detectTurn,
  detectAllTurns,
  corneringSpeed,
  isSingleRoadAhead,
  segmentsAhead,
  normaliseFeatures,
  firstTurnAhead,
} from '../lib/road.js';
import { haversine, bearingTo } from '../lib/geo.js';

// Convenience wrapper: matches the old firstTurnAhead(features,...) call pattern
const fta = (features, lon, lat, heading, lookahead, maxR, a, matchMaxDist = 50) =>
  firstTurnAhead(segmentsAhead(features, lon, lat, heading, lookahead, maxR, 0, matchMaxDist), heading, lookahead, maxR, a);

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

test('segmentsAhead: BFS propagates when car is at a feature endpoint (2-coord feature boundary)', () => {
  // Reproduces a bridge tile where the matched feature has only 2 coords and
  // the car lands on the endpoint node. collectAhead yields 1 pt, so the old
  // code skipped junction discovery and returned 0 segments.
  //
  // Layout (heading south, ~180°):
  //   bridgeSegment: [north] → [junction]   (car is AT [junction], heading south)
  //   continuation:  [junction] → [south1] → [south2] → [south3]
  const lon = 2.0, lat = 48.001;          // car at the south end of the bridge
  const bridgeSegment = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.002],   // north end
      [2.0, 48.001],   // junction node — car is here
    ]},
    properties: { class: 'primary' },
  };
  const continuation = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.001],   // junction node
      [2.0, 48.0007],
      [2.0, 48.0004],
      [2.0, 48.0],
    ]},
    properties: { class: 'primary' },
  };
  const segs = segmentsAhead([bridgeSegment, continuation], lon, lat, 180, 500);
  const forward = segs.filter(s => !s.isBehind);
  assert.ok(forward.length >= 1,
    `Expected ≥1 forward segment via BFS propagation, got ${forward.length}`);
});



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
  assert.strictEqual(fta([], 2.0, 48.0, 90, 500, MAX_R, A).card, null);
});

test('firstTurnAhead: no features → reason no match', () => {
  assert.strictEqual(fta([], 2.0, 48.0, 90, 500, MAX_R, A).reason, 'no match');
});

test('firstTurnAhead: straight road → null', () => {
  assert.strictEqual(fta([straightFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50).card, null);
});

test('firstTurnAhead: straight road → reason straight', () => {
  assert.strictEqual(fta([straightFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50).reason, 'straight');
});

test('firstTurnAhead: 90° left turn (east→north) within lookahead → direction left', () => {
  const { card } = fta([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'Expected turn to be detected');
  assert.strictEqual(card.direction, 'left');
});

test('firstTurnAhead: 90° right turn (east→south) within lookahead → direction right', () => {
  const { card } = fta([rightTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'Expected turn to be detected');
  assert.strictEqual(card.direction, 'right');
});

test('firstTurnAhead: turn beyond lookahead → null', () => {
  // Turn node is at cumdist ≈ 73 m — only find it with lookahead > 73 m
  assert.strictEqual(fta([leftTurnFeature], 2.0, 48.0, 90, 50, MAX_R, A, 50).card, null);
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
  const { card } = fta([tertiaryRoad, trackBranch], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'track branch should be discarded; turn card must show');
  assert.strictEqual(card.direction, 'left');
});

test('firstTurnAhead: track with more pts in same bearing group does not evict main road', () => {
  // Reproduces the roads_14 pattern: a track branches at a junction node on a
  // tertiary road and travels in a similar direction (≈25° difference), falling
  // into the same bearing group.  The track has more pts (4) than the tertiary
  // stub (3) but must NOT replace it.  The track is perfectly straight — if it
  // were selected the turn card would return null; the tertiary has a genuine
  // right bend so it returns a non-null result.
  const tertiary = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.001], [2.0, 48.0], [1.999, 47.999], [1.997, 47.998],
    ]},
    properties: { class: 'tertiary' },
  };
  // Track branches at [2.0,48.0] (junction node), net bearing ≈198° (25° off
  // tertiary's ≈225°) → joins the same direction group, more pts but straight.
  const track = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [1.9993, 47.9986], [1.9986, 47.9972], [1.9979, 47.9958],
      [1.9972, 47.9944], [1.9965, 47.993], [1.9958, 47.9916],
    ]},
    properties: { class: 'track' },
  };
  const { card } = fta([tertiary, track], 2.0, 48.001, 210, 500, MAX_R, A, 50);
  // With old code (pts.length wins): track replaces tertiary → straight → null.
  // With new code (class wins): tertiary kept → right bend detected → non-null.
  assert.ok(card !== null, 'tertiary bend must be detected; track must not evict main road');
  assert.strictEqual(card.direction, 'right', 'direction must come from tertiary geometry');
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
  const { card } = fta([shortStub, longContinuation], 2.00025, 48.0003, 180, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'short stub should join the longer segment\'s group, not create a spurious junction');
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
  const { card } = fta([southToWestRoad, northBranch], 2.0, 48.002, 180, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'northward branch (>90° from heading) should be filtered; turn card must show');
  assert.strictEqual(card.direction, 'right');
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
  const result = fta([leftTurnFeature, branchFeature], 2.0, 48.0, 90, 120, MAX_R, A, 50);
  assert.strictEqual(result.card, null);
  assert.strictEqual(result.reason, 'junction');
});

test('firstTurnAhead: distanceToStart > 0 for non-immediate turn', () => {
  const { card } = fta([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null);
  assert.ok(card.distanceToStart > 0, `Expected distanceToStart > 0, got ${card.distanceToStart}`);
});

test('firstTurnAhead: minSpeed > 0', () => {
  const { card } = fta([leftTurnFeature], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null);
  assert.ok(card.minSpeed !== null && card.minSpeed > 0);
});

test('firstTurnAhead: service road spur in same bearing group does not evict primary road (roads_28)', () => {
  // Reproduces roads_28: a service road spur connects near the bridge junction,
  // travels in roughly the same direction as the highway, and has MORE pts than
  // the primary bridge.  Before the fix (service not in MINOR_CLASSES), the
  // service road's tight curve (low minSpeed) would replace the primary road's
  // gentler curve.  After the fix, primary always wins.
  const primary = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      // gentle right arc heading NNE then NE (large radius → high minSpeed)
      [2.0, 48.0],
      [2.0001, 48.0003],
      [2.0003, 48.0006],
      [2.0006, 48.0009],
      [2.001,  48.0011],
      [2.0015, 48.0012],
    ]},
    properties: { class: 'primary' },
  };
  // Service road branches from near the junction with more pts and a tight S-curve
  const service = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0002, 48.0003],  // near junction — within 25 m of primary coords
      [2.0004, 48.0006],
      [2.0007, 48.0008],
      [2.001,  48.0007],  // tight right turn here
      [2.0013, 48.0008],
      [2.0015, 48.001],
      [2.0016, 48.0013],
    ]},
    properties: { class: 'service' },
  };
  const { card } = fta([primary, service], 2.0, 48.0, 20, 500, MAX_R, A, 50);
  // Service road must not evict primary: result must reflect primary's geometry.
  // Primary's gentle arc gives a much higher minSpeed than a tight service-road curve.
  assert.ok(card !== null, 'turn card must be shown');
  // The primary road's minSpeed must be above the service road's tight corner speed.
  // This catches regression: service road spur used instead of primary.
  assert.ok(card.minSpeed > 30, `primary road must dominate; got minSpeed=${card.minSpeed}`);
});

test('firstTurnAhead: minor road parallel to motorway does not suppress turn card (roads_29)', () => {
  // Reproduces roads_29: car on a motorway (class=motorway) with many class=minor roads
  // branching from junction nodes. Before fix, 'minor' was not in MINOR_CLASSES, so
  // minor-road direction groups were treated as "main roads" alongside the motorway
  // group, producing multiple distinct directions → junction suppression → no card.
  // After fix, minor groups are discarded when a motorway group exists.
  const motorway = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 48.001],
    ]},
    properties: { class: 'motorway', oneway: 1 },
  };
  // Minor road joins at [2.001, 48.0] and continues east then NE — a distinctly
  // different net bearing from the motorway's NNE, creating a separate direction
  // group with the old code. It is >30 m long to allow it to create a new group.
  const minorRoad = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.001, 48.0], [2.002, 48.0003], [2.003, 48.0003],
    ]},
    properties: { class: 'minor' },
  };
  const { card } = fta([motorway, minorRoad], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'minor road must not create a spurious junction on a motorway');
});

test('firstTurnAhead: oneway road is not walked backward in BFS (opposite carriageway fix)', () => {
  // Reproduces the roads_29 pattern where BFS queues the reverse walk on a oneway
  // feature whose backward direction happens to pass the heading filter.
  // A secondary road going west (oneway=1) connects at the same node as the main
  // road. Without the fix, backward walk on it goes east — a different net bearing
  // from the main road's NNE — creating a second direction group → junction → null.
  // After the fix, only the forward (west) walk is queued; the heading filter
  // rejects it, leaving a single group → turn card shown.
  const mainRoad = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 48.001],
    ]},
    properties: { class: 'secondary' },
  };
  // Oneway road: coordinates go west (lon decreasing), so forward=west, backward=east.
  // Its last node [2.001, 48.0] coincides with mainRoad's second node.
  const onewayWest = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.003, 48.0], [2.001, 48.0],
    ]},
    properties: { class: 'secondary', oneway: 1 },
  };
  const { card } = fta([mainRoad, onewayWest], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(card !== null, 'backward walk on a oneway road must not create a spurious junction');
});

test('firstTurnAhead: null heading uses matched-road direction — opposite oneway carriageway filtered (roads_29)', () => {
  // Reproduces the roads_29 divided-highway scenario when heading is unknown
  // (app just started, below minSpeedForHeading, or compass unavailable).
  // Without the fix, heading=null skips the direction filter and the opposite
  // carriageway (oneway=1 going west) passes through as a second motorway
  // direction group → junction → null.
  // With the fix, the matched road's own initBearing is used as a reference
  // direction when heading===null, so the opposite carriageway is filtered.
  const eastCarriageway = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [2.001, 48.0], [2.002, 48.0], [2.002, 48.001],
    ]},
    properties: { class: 'motorway', oneway: 1 },
  };
  const westCarriageway = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.002, 48.0002], [2.001, 48.0002], [2.0, 48.0002],
    ]},
    properties: { class: 'motorway', oneway: 1 },
  };
  // With heading=90°: should show turn card (works before and after fix)
  const withHeading = fta([eastCarriageway, westCarriageway], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(withHeading.card !== null, 'turn card must be shown with known heading');
  // With heading=null: must also show turn card using matched-road direction as reference
  const nullHeading = fta([eastCarriageway, westCarriageway], 2.0, 48.0, null, 500, MAX_R, A, 50);
  assert.ok(nullHeading.card !== null, 'turn card must be shown even with null heading on a divided highway');
});

test('firstTurnAhead: motorway ramp branches do not suppress turn card (roads_32)', () => {
  // Reproduces roads_32: car on a motorway with on-ramp/off-ramp geometry (ramp:1)
  // creating two extra direction groups that all share class=motorway.
  // Before fix, all three groups survived the minor filter → junction → no card.
  // After fix, ramp groups are discarded when a non-ramp motorway group exists.
  const mainMotorway = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.0, 48.0], [2.001, 48.0], [2.002, 48.001], [2.003, 48.002],
    ]},
    properties: { class: 'motorway', oneway: 1 },
  };
  // On-ramp peeling off to the right (different net bearing) — ramp:1
  const onRamp = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.001, 48.0], [2.002, 48.0], [2.003, 48.0],
    ]},
    properties: { class: 'motorway', ramp: 1, oneway: 1 },
  };
  // Loop ramp starting in travel direction but curving back — ramp:1
  const loopRamp = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [2.001, 48.0], [2.002, 48.0005], [2.0015, 48.001], [2.001, 48.0015],
    ]},
    properties: { class: 'motorway', ramp: 1 },
  };
  const { card, reason } = fta([mainMotorway, onRamp, loopRamp], 2.0, 48.0, 90, 500, MAX_R, A, 50);
  assert.ok(reason !== 'junction', `ramp branches must not suppress turn card; got reason=${reason}`);
});

test('firstTurnAhead: matched ramp with curvy continuation shows turn card (roads_33)', () => {
  // Reproduces roads_33: car is on a motorway ramp (oneway+ramp) that ends at a junction J.
  // From J, the ramp continues as a curvy segment (90° left turn) - this gives the turn card.
  // A parallel non-ramp motorway at a different bearing also branches from J.
  // Before fix: old ramp filter removed both ramp groups → non-ramp motorway (straight) → no card.
  // After fix: inverse ramp filter removes the non-ramp group; series merge joins the two
  // ramp segments (straight end + curvy continuation) into one path → turn card shown.
  const matchedRamp = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[0, 48], [0.001, 48], [0.002, 48]] },
    properties: { class: 'motorway', ramp: 1, oneway: 1 },
  };
  const curvyRamp = { // continues from J=[0.002, 48], turns sharply north (tight left turn)
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [0.002, 48], [0.003, 48], [0.003, 48.003],
    ]},
    properties: { class: 'motorway', ramp: 1 },
  };
  const parallelMotorway = { // non-ramp at a different bearing from J — should be filtered
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [
      [0.002, 48], [0.005, 48.0015], [0.008, 48.003],
    ]},
    properties: { class: 'motorway', oneway: 1 },
  };
  const { card, reason } = fta(
    [matchedRamp, curvyRamp, parallelMotorway], 0.0005, 48, 90, 500, MAX_R, A, 50,
  );
  assert.ok(reason === null, `expected turn card from curvy ramp; got reason=${reason}`);
  assert.ok(card !== null, 'expected non-null turn card');
});

test('firstTurnAhead: non-ramp motorway in same direction group must not evict matched ramp (roads_37)', () => {
  // Reproduces roads_37: car is on a ramp (oneway+ramp, _distToCar=5) approaching a left turn
  // at r≈20m. A non-ramp motorway feature shares the same approximate net bearing as the
  // matched ramp and joins its direction group during grouping.
  // Before fix: the rampBetter rule evicted the matched ramp as group representative,
  // replacing it with the 3-pt straight motorway. The ramp filter then considered the car
  // NOT on a ramp (because the group representative was non-ramp), removed the curvy
  // continuation ramp, and returned reason='straight'.
  // After fix: the matched segment is never evicted from its group representative position.
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_37.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, 200, 0, 30);
  const result = firstTurnAhead(segments, heading, lookahead, 200, aThreshold);
  assert.ok(result !== null, 'expected firstTurnAhead to return a result');
  const { card, reason } = result;
  assert.ok(reason === null, `expected turn card to be shown; got reason=${reason}`);
  assert.ok(card !== null, 'expected non-null turn card');
  assert.equal(card.minSpeed, 35, `expected minSpeed=35, got ${card.minSpeed}`);
  assert.equal(card.direction, 'left');
});

test('firstTurnAhead: short matched ramp (<30m) must still anchor the direction group (roads_39)', () => {
  // Reproduces roads_39: car is near the end of a ramp (only 2 pts = ~25m remaining).
  // Because 25m < SEGMENT_MIN_LENGTH (30m), the matched segment could not create a direction
  // group, so hasMatched was never set. The ramp filter then saw no matched ramp, treated the
  // car as not-on-a-ramp, removed all ramp groups, and the perpendicular non-ramp motorway
  // (bearing ~36°, roughly perpendicular to heading 338°) won.
  // Fix: the matched segment always creates a direction group regardless of length.
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_39.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = (150 / 3.6) ** 2 / aThreshold;
  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, 30);
  const result = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
  assert.ok(result !== null);
  const { pts, reason } = result;
  // The selected road must be the ramp (~338°), not the perpendicular motorway (~36°).
  // Verify by checking that mainRoadPts heads roughly NNW, not NNE.
  assert.ok(pts && pts.length >= 2, 'expected at least 2 pts');
  const selectedBearing = bearingTo(pts[0][1], pts[0][0], pts[pts.length - 1][1], pts[pts.length - 1][0]);
  // The correct ramp heads ~320–340°; the wrong motorway would head ~30–40°.
  const diffFromHeading = Math.min(Math.abs(selectedBearing - heading), 360 - Math.abs(selectedBearing - heading));
  assert.ok(diffFromHeading < 30, `selected road bearing ${selectedBearing.toFixed(0)}° should be near heading ${heading.toFixed(0)}°, diff=${diffFromHeading.toFixed(0)}°`);
});

test('firstTurnAhead: bridge ramp on parallel structure is not a junction — right turn card shown (roads_43)', () => {
  // Reproduces roads_43: car exits a ramp onto a motorway merge zone, heading ~35° (NNE).
  // A bridge ramp going ~320° (NNW) sits ~21 m away on a parallel structure — not topologically
  // connected (no shared OSM node). With JUNCTION_THRESH=5 m it is never discovered by BFS,
  // so only the forward continuation exists and a right turn card is produced.
  // (At 25 m the parallel ramp was spuriously connected, creating a second direction group
  // and incorrectly suppressing the card with reason='junction'.)
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_43.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = (150 / 3.6) ** 2 / aThreshold;
  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, 30);
  const result = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
  assert.ok(result !== null);
  assert.equal(result.reason, null, `expected turn card (no junction), got reason=${result.reason}`);
  assert.equal(result.card?.direction, 'right', `expected right turn, got ${result.card?.direction}`);
  assert.equal(result.card?.minSpeed, 58, `expected minSpeed=58, got ${result.card?.minSpeed}`);
});

test('matchRoad: oneway feature is always walked forward — no contra-flow turn card (roads_51)', () => {
  // Reproduces roads_51: car heading 135° (SE) on a oneway=1 ramp whose coordinate
  // order goes NNW (332°). matchRoad used to set forward=false because 135° is closer
  // to the contra-flow bearing, causing segmentsAhead to walk the ramp backward and
  // firstTurnAhead to emit a turn card for an illegal direction.
  // Fix: oneway features always use forward=true; firstTurnAhead's heading filter
  // then suppresses the segment because NNW is >90° from the car's SE heading.
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_51.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = (150 / 3.6) ** 2 / aThreshold;
  const match = matchRoad(fixture.features, lon, lat, heading);
  assert.equal(match.feature.properties.oneway, 1, 'matched feature should be oneway');
  assert.equal(match.forward, true, 'oneway feature must always be walked forward');
  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, 30);
  const result = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
  assert.ok(result.card === null, `expected no turn card for contra-flow position, got direction=${result.card?.direction}`);
});

test('matchRoad + firstTurnAhead: junction at feature boundary — currentRoadPts spans car (roads_52)', () => {
  // Reproduces roads_52: car on a 2-node secondary road at the last node (feature
  // boundary). BFS yields pts.length<2 for the matched feature, so no segment with
  // isMatched=true is pushed. firstTurnAhead sees multiple direction groups from the
  // continuation features and returns reason='junction'.
  // renderDashboard falls back to match.coords.slice(segIdx-1) as currentRoadPts.
  // This test verifies the two invariants that make the fallback correct:
  //   1. reason is 'junction'
  //   2. match.coords.slice(segIdx-1) produces a path that brackets the car
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_52.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = (150 / 3.6) ** 2 / aThreshold;

  const match = matchRoad(fixture.features, lon, lat, heading);
  assert.ok(match, 'should match a road');
  assert.equal(match.forward, true);

  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, 30);
  const result = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
  assert.equal(result.reason, 'junction', `expected junction, got ${result.reason}`);

  // currentRoadPts = match.coords.slice(segIdx - 1) for forward travel
  const currentRoadPts = match.coords.slice(Math.max(0, match.segIdx - 1));
  assert.ok(currentRoadPts.length >= 2, 'currentRoadPts must have at least 2 points');

  // Car must sit between currentRoadPts[0] and currentRoadPts[1]
  const dA  = haversine(lat, lon, currentRoadPts[0][1], currentRoadPts[0][0]);
  const dB  = haversine(lat, lon, currentRoadPts[1][1], currentRoadPts[1][0]);
  const dAB = haversine(currentRoadPts[0][1], currentRoadPts[0][0], currentRoadPts[1][1], currentRoadPts[1][0]);
  assert.ok(Math.abs(dA + dB - dAB) < 5, `car not between currentRoadPts[0..1]: dA=${Math.round(dA)} dB=${Math.round(dB)} dAB=${Math.round(dAB)}`);
});

test('matchRoad: contra-flow oneway — no match within matchMaxDist (roads_54)', () => {
  // Reproduces roads_54: car heading 128° (SE) on a motorway interchange where the
  // nearest feature (6 m) is a oneway ramp with coordinate-order bearing 318° (NW).
  // Before the fix, matchRoad matched it and forced forward=true, causing BFS to start
  // from the NW endpoint and pick up ~8 spurious south-going junction segments.
  // After the fix, contra-flow oneway features are skipped in matchRoad; the next
  // closest road is a track 48 m away — beyond matchMaxDist=30 — so segmentsAhead
  // returns empty and firstTurnAhead reports 'no match'.
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_54.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = (150 / 3.6) ** 2 / aThreshold;

  const match = matchRoad(fixture.features, lon, lat, heading);
  assert.ok(!match || match.dist > 30, `expected no oneway match within 30 m, got dist=${match?.dist}`);

  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, 30);
  assert.equal(segments.length, 0, `expected no segments, got ${segments.length}`);

  const result = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
  assert.equal(result.reason, 'no match');
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
