import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeTurnCard,
  overlayBadgeItems,
  overlayGeoJSON,
  segmentLineColor,
  segmentsGeoJSON,
  statusText,
  barState,
  badgeItems,
  debugTripletFeatures,
  turnPathSVG,
  junctionBranchGeoJSON,
} from '../lib/display.js';
import { segmentsAhead, firstTurnAhead } from '../lib/road.js';

const A = 0.30 * 9.81; // default aThreshold

const pts = [[2, 48], [2.001, 48], [2.001, 48.001]];
const makeSeg = (turns = [], isBehind = false) => ({ pts, turns, isBehind });
const makeTurn = (distance, radius) => ({ distance, radius, angle: 45 });

// ── computeTurnCard ────────────────────────────────────────────────────────────

describe('computeTurnCard', () => {
  // corneringSpeed(100, 0.3*9.81) = Math.round(sqrt(2.943*100)*3.6) = 62 km/h
  const baseTurn = { distanceToStart: 80, arcLength: 40, minRadius: 100, minSpeed: 62, direction: 'right' };

  test('null input → null', () => {
    assert.equal(computeTurnCard(null, 50), null);
  });

  test('minSpeed null → null', () => {
    assert.equal(computeTurnCard({ ...baseTurn, minSpeed: null }, 50), null);
  });

  test('returns right direction', () => {
    assert.equal(computeTurnCard(baseTurn, 30).direction, 'right');
  });

  test('returns left direction', () => {
    assert.equal(computeTurnCard({ ...baseTurn, direction: 'left' }, 30).direction, 'left');
  });

  test('distanceToStart rounded', () => {
    assert.equal(computeTurnCard({ ...baseTurn, distanceToStart: 80.7 }, 30).distanceToStart, 81);
  });

  test('isOver true when speed > minSpeed', () => {
    assert.equal(computeTurnCard(baseTurn, 70).isOver, true);
  });

  test('isOver false when speed < minSpeed', () => {
    assert.equal(computeTurnCard(baseTurn, 50).isOver, false);
  });

  test('timeToStart calculated from speed — 80 m at 72 km/h → 4 s', () => {
    assert.equal(computeTurnCard(baseTurn, 72).timeToStart, 4);
  });

  test('timeToStart null when speed is 0', () => {
    assert.equal(computeTurnCard(baseTurn, 0).timeToStart, null);
  });

  test('minSpeed passed through', () => {
    assert.equal(computeTurnCard(baseTurn, 30).minSpeed, 62);
  });
});

// ── segmentLineColor ──────────────────────────────────────────────────────────

describe('segmentLineColor', () => {
  test('no turns → gray', () => {
    assert.equal(segmentLineColor(makeSeg([]), 50, A), '#888');
  });

  test('speed well under limit → green', () => {
    // corneringSpeed(5000, A) ≈ 434 km/h — way above any speed
    assert.equal(segmentLineColor(makeSeg([makeTurn(50, 5000)]), 50, A), '#3a9');
  });

  test('speed over limit → red', () => {
    // corneringSpeed(50, A) ≈ 44; speed 60 > 44
    assert.equal(segmentLineColor(makeSeg([makeTurn(50, 50)]), 60, A), '#e33');
  });

  test('speed within 10 km/h below limit → orange', () => {
    // corneringSpeed(50, A) ≈ 44; speed 40 — within 10 of 44
    assert.equal(segmentLineColor(makeSeg([makeTurn(50, 50)]), 40, A), '#f90');
  });

  test('uses most restrictive turn when multiple present', () => {
    // tight turn: limit ≈ 44; loose turn: limit ≈ 434
    const seg = makeSeg([makeTurn(50, 5000), makeTurn(100, 50)]);
    assert.equal(segmentLineColor(seg, 60, A), '#e33');
  });
});

// ── segmentsGeoJSON ───────────────────────────────────────────────────────────

describe('segmentsGeoJSON', () => {
  test('returns FeatureCollection', () => {
    const gj = segmentsGeoJSON([makeSeg([])], 50, A);
    assert.equal(gj.type, 'FeatureCollection');
  });

  test('one feature per segment', () => {
    const gj = segmentsGeoJSON([makeSeg([]), makeSeg([])], 50, A);
    assert.equal(gj.features.length, 2);
  });

  test('feature carries color property', () => {
    const gj = segmentsGeoJSON([makeSeg([])], 50, A);
    assert.ok(typeof gj.features[0].properties.color === 'string');
  });
});

// ── overlayGeoJSON ────────────────────────────────────────────────────────────

const mainPts = [[0, 48], [0.001, 48], [0.001, 48.001]];

describe('overlayGeoJSON', () => {
  test('overlayAll=false (default), no mainRoadPts → empty FeatureCollection', () => {
    const gj = overlayGeoJSON([], null, false, null, 30, A);
    assert.equal(gj.type, 'FeatureCollection');
    assert.equal(gj.features.length, 0);
  });

  test('overlayAll=false, mainRoadPts present → single feature with those coords', () => {
    const gj = overlayGeoJSON([], mainPts, false, null, 30, A);
    assert.equal(gj.features.length, 1);
    assert.deepEqual(gj.features[0].geometry.coordinates, mainPts);
  });

  test('overlayAll=false, no card → gray', () => {
    const gj = overlayGeoJSON([], mainPts, false, null, 30, A);
    assert.equal(gj.features[0].properties.color, '#888');
  });

  test('overlayAll=false, card.isOver → red', () => {
    const card = { minSpeed: 40, isOver: true };
    const gj = overlayGeoJSON([], mainPts, false, card, 50, A);
    assert.equal(gj.features[0].properties.color, '#e33');
  });

  test('overlayAll=false, within 10 km/h of limit → orange', () => {
    const card = { minSpeed: 40, isOver: false };
    const gj = overlayGeoJSON([], mainPts, false, card, 35, A);
    assert.equal(gj.features[0].properties.color, '#f90');
  });

  test('overlayAll=false, well under limit → green', () => {
    const card = { minSpeed: 40, isOver: false };
    const gj = overlayGeoJSON([], mainPts, false, card, 20, A);
    assert.equal(gj.features[0].properties.color, '#3a9');
  });

  test('overlayAll=true → delegates to segmentsGeoJSON (all segments)', () => {
    const segs = [makeSeg([]), makeSeg([])];
    const gj = overlayGeoJSON(segs, mainPts, true, null, 30, A);
    assert.equal(gj.features.length, 2);
  });

  test('overlayAll=true ignores mainRoadPts', () => {
    const segs = [makeSeg([])];
    const gj = overlayGeoJSON(segs, null, true, null, 30, A);
    assert.equal(gj.features.length, 1);
  });
});

// ── overlayBadgeItems ─────────────────────────────────────────────────────────

// Tight 90° turn: three pts forming a right-angle bend
const tightPts = [[0, 48], [0.002, 48], [0.002, 48.002]];
const MAX_R_BADGE = 2000;

describe('overlayBadgeItems', () => {
  test('overlayAll=false, no mainRoadPts → empty', () => {
    const items = overlayBadgeItems([], null, false, 30, A, MAX_R_BADGE);
    assert.deepEqual(items, []);
  });

  test('overlayAll=false, straight mainRoadPts → no badges', () => {
    const straight = [[0, 48], [0.001, 48], [0.002, 48]];
    const items = overlayBadgeItems([], straight, false, 30, A, MAX_R_BADGE);
    assert.equal(items.length, 0);
  });

  test('overlayAll=false, curvy mainRoadPts → badges on that path only', () => {
    const other = { pts: [[1, 48], [1.002, 48], [1.002, 48.002]], turns: [{ radius: 50, distance: 100, angle: 90 }], isBehind: false };
    const items = overlayBadgeItems([other], tightPts, false, 30, A, MAX_R_BADGE);
    // badges come from tightPts, not from other segment
    for (const item of items) {
      assert.deepEqual(item.pts, tightPts);
    }
  });

  test('overlayAll=true → badges from all segments', () => {
    const seg = { pts: tightPts, turns: [{ radius: 50, distance: 100, angle: 90 }], isBehind: false };
    const items = overlayBadgeItems([seg], null, true, 30, A, MAX_R_BADGE);
    assert.equal(items.length, 1);
  });

  test('overlayAll=true ignores mainRoadPts', () => {
    const seg = { pts: tightPts, turns: [{ radius: 50, distance: 100, angle: 90 }], isBehind: false };
    const items = overlayBadgeItems([seg], [[9, 48], [9.001, 48]], true, 30, A, MAX_R_BADGE);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].pts, tightPts);
  });
});

// ── statusText ────────────────────────────────────────────────────────────────

describe('statusText', () => {
  test('with match — includes road count and distance', () => {
    const text = statusText(
      [{}, {}],
      [makeSeg([]), { isBehind: true, pts, turns: [] }],
      { dist: 5 },
      15,
    );
    assert.ok(text.includes('2 roads'), text);
    assert.ok(text.includes('1↑'), text);
    assert.ok(text.includes('1↓'), text);
    assert.ok(text.includes('5 m to road'), text);
    assert.ok(text.includes('±15 m'), text);
  });

  test('without match — shows "no road"', () => {
    const text = statusText([], [], null, 20);
    assert.ok(text.includes('no road'), text);
  });

  test('null accuracy rounds to 0', () => {
    const text = statusText([], [], null, null);
    assert.ok(text.includes('±0 m'), text);
  });

  test('turnReason appended when provided', () => {
    const text = statusText([], [], null, 10, 'junction');
    assert.ok(text.includes('turn: junction'), text);
  });

  test('no turnReason suffix when null', () => {
    const text = statusText([], [], null, 10, null);
    assert.ok(!text.includes('turn:'), text);
  });
});

// ── barState ──────────────────────────────────────────────────────────────────

describe('barState', () => {
  test('value over limit → "over" class', () => {
    assert.equal(barState(0.5, 0.3).className, 'over');
  });

  test('value at 75% of limit → "warn" class', () => {
    assert.equal(barState(0.225, 0.3).className, 'warn');
  });

  test('value below 70% of limit → empty class', () => {
    assert.equal(barState(0.1, 0.3).className, '');
  });

  test('percentage capped at 100', () => {
    assert.equal(barState(2.0, 0.3).pct, 100);
  });

  test('percentage scales correctly at half limit', () => {
    // value = limit/2 = limit * 2 * 0.25 → pct = 25
    assert.equal(barState(0.15, 0.3).pct, 25);
  });

  test('text formats to two decimal places with g suffix', () => {
    assert.equal(barState(0.12345, 0.3).text, '0.12g');
  });
});

// ── badgeItems ────────────────────────────────────────────────────────────────

describe('badgeItems', () => {
  test('no segments → empty', () => {
    assert.deepEqual(badgeItems([], 50, A), []);
  });

  test('isBehind segment skipped', () => {
    assert.deepEqual(badgeItems([makeSeg([makeTurn(50, 100)], true)], 50, A), []);
  });

  test('returns one item per valid turn', () => {
    const items = badgeItems([makeSeg([makeTurn(50, 100), makeTurn(80, 200)])], 50, A);
    assert.equal(items.length, 2);
  });

  test('item carries limit and turnDistance', () => {
    const [item] = badgeItems([makeSeg([makeTurn(50, 100)])], 30, A);
    assert.equal(item.turnDistance, 50);
    assert.ok(item.limit > 0);
  });

  test('isOver set correctly', () => {
    // corneringSpeed(50, A) ≈ 44
    const [item] = badgeItems([makeSeg([makeTurn(50, 50)])], 60, A);
    assert.equal(item.isOver, true);
  });

  test('Infinity radius turn skipped', () => {
    assert.deepEqual(badgeItems([makeSeg([makeTurn(50, Infinity)])], 50, A), []);
  });

  test('item includes pts for caller to position badge', () => {
    const [item] = badgeItems([makeSeg([makeTurn(50, 100)])], 30, A);
    assert.deepEqual(item.pts, pts);
  });
});

// ── debugTripletFeatures ──────────────────────────────────────────────────────

describe('debugTripletFeatures', () => {
  test('empty for no segments', () => {
    assert.deepEqual(debugTripletFeatures([], 500), []);
  });

  test('isBehind segments skipped', () => {
    const seg = { pts: [[2,48],[2.001,48],[2.001,48.001]], turns: [], isBehind: true };
    assert.deepEqual(debugTripletFeatures([seg], 500), []);
  });

  test('generates one feature per interior triplet', () => {
    const seg = { pts: [[2,48],[2.001,48],[2.001,48.001],[2.002,48.001]], turns: [], isBehind: false };
    const features = debugTripletFeatures([seg], 500);
    assert.equal(features.length, 2); // pts.length - 2 = 4 - 2 = 2
  });

  test('feature geometry is LineString with 3 coordinates', () => {
    const seg = { pts: [[2,48],[2.001,48],[2.001,48.001]], turns: [], isBehind: false };
    const [f] = debugTripletFeatures([seg], 500);
    assert.equal(f.geometry.type, 'LineString');
    assert.equal(f.geometry.coordinates.length, 3);
  });

  test('tight triplet gets yellow color', () => {
    // 90° turn: circumradius ≈ 42m << maxTurnRadius 500m
    const seg = { pts: [[2,48],[2.001,48],[2.001,48.001]], turns: [], isBehind: false };
    const [f] = debugTripletFeatures([seg], 500);
    assert.equal(f.properties.color, '#ff0');
  });

  test('loose triplet gets gray color', () => {
    // Near-straight: circumradius → Infinity >> maxTurnRadius 1
    const seg = { pts: [[2,48],[2.001,48],[2.002,48]], turns: [], isBehind: false };
    const [f] = debugTripletFeatures([seg], 1);
    assert.equal(f.properties.color, '#555');
  });
});

// ── turnPathSVG ───────────────────────────────────────────────────────────────

describe('turnPathSVG', () => {
  // Straight road going north: [lon, lat] pairs with increasing lat
  const straight = [[2, 48], [2, 48.0005], [2, 48.001]];
  // Right-turning road: north then east
  const rightTurn = [[2, 48], [2, 48.0005], [2.0005, 48.0005]];
  // Left-turning road: north then west
  const leftTurn  = [[2, 48], [2, 48.0005], [1.9995, 48.0005]];

  test('returns SVG string', () => {
    const svg = turnPathSVG(straight);
    assert.ok(typeof svg === 'string');
    assert.ok(svg.startsWith('<svg'));
  });

  test('contains a polyline element', () => {
    assert.ok(turnPathSVG(straight).includes('<polyline'));
  });

  test('uses currentColor stroke', () => {
    assert.ok(turnPathSVG(straight).includes('stroke="currentColor"'));
  });

  test('fewer than 2 pts returns empty SVG', () => {
    const svg = turnPathSVG([[2, 48]]);
    assert.ok(svg.includes('<svg'));
    assert.ok(!svg.includes('<polyline'));
  });

  test('null pts returns empty SVG', () => {
    const svg = turnPathSVG(null);
    assert.ok(!svg.includes('<polyline'));
  });

  test('pts[1] is directly above pts[0] regardless of initial bearing', () => {
    // NE-going road: pts[0]→pts[1] is diagonal — rotation must align it straight up.
    // Before the fix, the wrong rotation formula produced (−x, tiny_y) instead of (0, L),
    // so the second SVG point was far to the left of the first, not above it.
    const neDiagonal = [[2, 48], [2.001, 48.001], [2.002, 48.001]];
    const svg = turnPathSVG(neDiagonal);
    const m = svg.match(/polyline[^>]*points="([^"]+)"/);
    const coords = m[1].trim().split(' ').map(s => s.split(',').map(Number));
    const [x0, y0] = coords[0];
    const [x1, y1] = coords[1];
    assert.ok(Math.abs(x1 - x0) < 1, `pts[1] x=${x1.toFixed(1)} should be directly above pts[0] x=${x0.toFixed(1)}`);
    assert.ok(y1 < y0, `pts[1] y=${y1.toFixed(1)} should be above pts[0] y=${y0.toFixed(1)}`);
  });

  test('pts[0] is placed at bottom-centre (w/2, h-pad)', () => {
    const w = 52, h = 52, pad = 5;
    const svg = turnPathSVG(straight, w, h);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    assert.ok(pointsMatch, 'polyline must have points attribute');
    const first = pointsMatch[1].trim().split(' ')[0];
    const [x, y] = first.split(',').map(Number);
    assert.ok(Math.abs(x - w / 2) < 1, `start x should be near w/2=${w/2}, got ${x}`);
    assert.ok(Math.abs(y - (h - pad)) < 1, `start y should be near h-pad=${h-pad}, got ${y}`);
  });

  test('right-turn road has last point to the right of pts[0]', () => {
    const svg = turnPathSVG(rightTurn);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    const coords = pointsMatch[1].trim().split(' ').map(s => s.split(',').map(Number));
    const startX = coords[0][0];
    const lastX  = coords[coords.length - 1][0];
    assert.ok(lastX > startX, `right turn: last x (${lastX}) should be > start x (${startX})`);
  });

  test('left-turn road has last point to the left of pts[0]', () => {
    const svg = turnPathSVG(leftTurn);
    const pointsMatch = svg.match(/points="([^"]+)"/);
    const coords = pointsMatch[1].trim().split(' ').map(s => s.split(',').map(Number));
    const startX = coords[0][0];
    const lastX  = coords[coords.length - 1][0];
    assert.ok(lastX < startX, `left turn: last x (${lastX}) should be < start x (${startX})`);
  });

  test('all points stay within SVG bounds', () => {
    const w = 52, h = 52;
    for (const ptSet of [straight, rightTurn, leftTurn]) {
      const svg = turnPathSVG(ptSet, w, h);
      const pointsMatch = svg.match(/points="([^"]+)"/);
      const coords = pointsMatch[1].trim().split(' ').map(s => s.split(',').map(Number));
      for (const [x, y] of coords) {
        assert.ok(x >= 0 && x <= w, `x=${x} out of [0,${w}]`);
        assert.ok(y >= 0 && y <= h, `y=${y} out of [0,${h}]`);
      }
    }
  });

  test('respects custom w and h', () => {
    const svg = turnPathSVG(straight, 80, 100);
    assert.ok(svg.includes('width="80"'));
    assert.ok(svg.includes('height="100"'));
    assert.ok(svg.includes('viewBox="0 0 80 100"'));
  });

  test('curl-back path (hairpin) stays entirely within SVG bounds', () => {
    // North → east → south path: last point is below the start, simulating a tight U-turn
    const hairpin = [[2, 48], [2, 48.001], [2.001, 48.001], [2.001, 48], [2.001, 47.999]];
    const w = 52, h = 52;
    const svg = turnPathSVG(hairpin, w, h);
    const polyMatch = svg.match(/polyline[^>]*points="([^"]+)"/);
    assert.ok(polyMatch, 'polyline must be present');
    const coords = polyMatch[1].trim().split(' ').map(s => s.split(',').map(Number));
    for (const [x, y] of coords) {
      assert.ok(x >= 0 && x <= w, `polyline x=${x.toFixed(1)} out of [0,${w}]`);
      assert.ok(y >= 0 && y <= h, `polyline y=${y.toFixed(1)} out of [0,${h}]`);
    }
  });

  test('contains an arrowhead polygon whose base coincides with the last polyline point', () => {
    const svg = turnPathSVG(rightTurn);
    assert.ok(svg.includes('<polygon'), 'arrowhead polygon must be present');
    const polyMatch  = svg.match(/polyline[^>]*points="([^"]+)"/);
    const arrowMatch = svg.match(/polygon[^>]*points="([^"]+)"/);
    assert.ok(polyMatch && arrowMatch);
    const lastPolyPt = polyMatch[1].trim().split(' ').at(-1).split(',').map(Number);
    // arrowPts order: tip, base-left, base-right — midpoint of base-left + base-right == last poly pt
    const [, bl, br] = arrowMatch[1].trim().split(' ').map(s => s.split(',').map(Number));
    const midX = (bl[0] + br[0]) / 2;
    const midY = (bl[1] + br[1]) / 2;
    assert.ok(Math.abs(midX - lastPolyPt[0]) < 0.1, `base midX ${midX.toFixed(1)} should equal ${lastPolyPt[0]}`);
    assert.ok(Math.abs(midY - lastPolyPt[1]) < 0.1, `base midY ${midY.toFixed(1)} should equal ${lastPolyPt[1]}`);
  });
});

// ── overlayBadgeItems fixture (roads_35) ──────────────────────────────────────

test('overlayBadgeItems: roads_35 fixture — RD off yields 11 badges, tightest is 35 km/h', () => {
  // roads_35: car on a motorway ramp (oneway+ramp, _distToCar=5) approaching a left turn.
  // Turn card: minSpeed=35, distanceToStart=69. With overlayAll=false the badges come
  // exclusively from detectAllTurns(mainRoadPts), which finds 11 tight nodes on the
  // merged 13-pt ramp path.
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/roads_35.json', import.meta.url)));
  const { lon, lat, heading } = fixture.meta.position;
  const { lookahead, aThreshold } = fixture.meta.cfg;
  const maxTurnRadius = 200;
  const matchMaxDist = 30;

  const segments = segmentsAhead(fixture.features, lon, lat, heading, lookahead, maxTurnRadius, 0, matchMaxDist);
  const { pts: mainRoadPts } = firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold)
    ?? { pts: null };

  const items = overlayBadgeItems(segments, mainRoadPts, false, 0, aThreshold, maxTurnRadius);
  assert.equal(items.length, 11, `expected 11 badges, got ${items.length}`);
  const minLimit = Math.min(...items.map(i => i.limit));
  assert.equal(minLimit, 35, `expected tightest badge at 35 km/h, got ${minLimit}`);
});

// ── junctionBranchGeoJSON ─────────────────────────────────────────────────────

describe('junctionBranchGeoJSON', () => {
  test('null groups, no matchedSegPts → empty FeatureCollection', () => {
    const result = junctionBranchGeoJSON(null);
    assert.equal(result.type, 'FeatureCollection');
    assert.equal(result.features.length, 0);
  });

  test('matchedSegPts always rendered blue regardless of junctionGroups', () => {
    const matchedSegPts = [[2, 48], [2.001, 48]];
    const result = junctionBranchGeoJSON(null, matchedSegPts);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].properties.color, '#48f');
    assert.equal(result.features[0].properties.isMatched, 1);
    assert.deepEqual(result.features[0].geometry.coordinates, matchedSegPts);
  });

  test('junction: matchedSegPts in blue, non-matched branch in magenta, matched group entry skipped', () => {
    const matchedSegPts = [[2, 48], [2.0005, 48]];
    const jg = [
      { pts: [[2, 48], [2.001, 48]], isMatched: true },
      { pts: [[2, 48], [2, 48.001]], isMatched: false },
    ];
    const result = junctionBranchGeoJSON(jg, matchedSegPts);
    assert.equal(result.features.length, 2);
    assert.equal(result.features[0].properties.color, '#48f');
    assert.deepEqual(result.features[0].geometry.coordinates, matchedSegPts);
    assert.equal(result.features[1].properties.color, '#f48');
    assert.equal(result.features[1].properties.isMatched, 0);
  });

  test('alternate branch coordinates passed through unchanged', () => {
    const pts1 = [[2, 48], [2.001, 48]];
    const jg = [{ pts: pts1, isMatched: false }];
    const result = junctionBranchGeoJSON(jg);
    assert.deepEqual(result.features[0].geometry.coordinates, pts1);
  });
});
