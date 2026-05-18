import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTurnCard,
  segmentLineColor,
  segmentsGeoJSON,
  statusText,
  barState,
  badgeItems,
  debugTripletFeatures,
} from '../lib/display.js';

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
