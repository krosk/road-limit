#!/usr/bin/env node
// Analyse a roads.json fixture: lists BFS segments, coordinates, lengths,
// distance from car, and overlay colours for both RD-off and RD-on modes.
// Usage: node scripts/analyse-fixture.js <path-to-roads.json>

import { readFileSync } from 'node:fs';
import { matchRoad, segmentsAhead, firstTurnAhead } from '../lib/road.js';
import { computeTurnCard, segmentLineColor, overlayGeoJSON, junctionBranchGeoJSON } from '../lib/display.js';
import { haversine } from '../lib/geo.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/analyse-fixture.js <path-to-roads.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, 'utf8'));
const { meta, features } = Array.isArray(raw) ? { meta: null, features: raw } : raw;

const lon      = meta?.position?.lon     ?? 0;
const lat      = meta?.position?.lat     ?? 0;
const heading  = meta?.position?.heading ?? null;
const speedKmh = meta?.speed             ?? 0;
const lookahead       = meta?.cfg?.lookahead       ?? 500;
const roadMatchMaxDist = meta?.cfg?.roadMatchMaxDist ?? 30;
const aThreshold      = meta?.cfg?.aThreshold      ?? 4.905;
const maxTurnRadius   = (150 / 3.6) ** 2 / aThreshold;

function ptsLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    d += haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
  return d;
}

function distFromCar(pt) {
  return haversine(lat, lon, pt[1], pt[0]);
}

const COLOR_LABEL = {
  '#888': 'gray   — no turn card',
  '#3a9': 'green  — safe',
  '#f90': 'orange — within 10 km/h of limit',
  '#e33': 'red    — over limit',
  '#48f': 'blue   — matched segment',
};
const label = c => COLOR_LABEL[c] ?? c;
const m = n => Math.round(n);

// ── Run the pipeline ──────────────────────────────────────────────────────────
const match    = matchRoad(features, lon, lat, heading);
const segments = segmentsAhead(features, lon, lat, heading, lookahead, maxTurnRadius, 0, roadMatchMaxDist);
const { pts: mainRoadPts, card: turnData, reason: turnReason } =
  firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold);
const card = computeTurnCard(turnData, speedKmh);

const matchedSegPts = match
  ? [match.snapPt, match.coords[match.segIdx]]
  : null;

// ── Header ────────────────────────────────────────────────────────────────────
console.log(`\n=== ${file} ===`);
if (meta) {
  console.log(`Car      lon=${lon.toFixed(6)}  lat=${lat.toFixed(6)}  heading=${heading ?? 'null'}°  speed=${speedKmh} km/h`);
  console.log(`Config   lookahead=${lookahead} m  roadMatchMaxDist=${roadMatchMaxDist} m  aThreshold=${aThreshold} m/s²  maxTurnRadius=${m(maxTurnRadius)} m`);
  console.log(`Match    ${match ? `${m(match.dist)} m to ${match.feature?.properties?.class ?? 'road'}` : 'NO MATCH'}`);
  console.log(`Turn     reason=${turnReason ?? 'null (card shown)'}  card=${card ? `${card.direction} ${card.minSpeed} km/h @ ${card.distanceToStart} m (ETA ${card.timeToStart ?? '–'} s)` : 'null'}`);
}

// ── Matched segment (always blue) ─────────────────────────────────────────────
console.log(`\n── MATCHED SEGMENT (always shown, #48f blue) ────────────────────────────`);
if (matchedSegPts) {
  const len = m(ptsLength(matchedSegPts));
  console.log(`   [0] ${matchedSegPts[0][0].toFixed(6)}, ${matchedSegPts[0][1].toFixed(6)}  ← snapPt (last passed node)`);
  console.log(`   [1] ${matchedSegPts[1][0].toFixed(6)}, ${matchedSegPts[1][1].toFixed(6)}  ← first node ahead`);
  console.log(`   length: ${len} m`);
} else {
  console.log(`   (none — no road match)`);
}

// ── Forward segments ──────────────────────────────────────────────────────────
const forward = segments.filter(s => !s.isBehind);
const behind  = segments.filter(s =>  s.isBehind);

console.log(`\n── FORWARD SEGMENTS (${forward.length}) ─────────────────────────────────────────────`);
forward.forEach((seg, i) => {
  const len   = m(ptsLength(seg.pts));
  const dist  = m(distFromCar(seg.pts[0]));
  const color = segmentLineColor(seg, speedKmh, aThreshold);
  const tags  = [
    seg.isMatched ? 'MATCHED' : null,
    seg.isRamp    ? 'ramp'    : null,
    seg.roadClass,
  ].filter(Boolean).join(', ');

  console.log(`\n   Segment ${i}  [${tags}]`);
  console.log(`   pts: ${seg.pts.length}  length: ${len} m  dist from car to first pt: ${dist} m`);
  console.log(`   color (RD on): ${color}  ${label(color)}`);
  seg.pts.forEach((pt, j) => {
    const d = m(distFromCar(pt));
    console.log(`      [${j}] ${pt[0].toFixed(6)}, ${pt[1].toFixed(6)}  (${d} m from car)`);
  });
});

if (behind.length > 0) {
  console.log(`\n── BEHIND SEGMENTS (${behind.length}) ──────────────────────────────────────────────`);
  behind.forEach((seg, i) => {
    console.log(`   Segment ${i}: ${seg.pts.length} pts  ${m(ptsLength(seg.pts))} m`);
  });
}

// ── Overlay summary ───────────────────────────────────────────────────────────
console.log(`\n── OVERLAY SUMMARY ──────────────────────────────────────────────────────`);

console.log(`\n   RD off (default) — main road only:`);
const rdOff = overlayGeoJSON(segments, mainRoadPts, false, card, speedKmh, aThreshold);
if (rdOff.features.length === 0) {
  console.log(`   (none)`);
} else {
  rdOff.features.forEach(f => {
    const len = m(ptsLength(f.geometry.coordinates));
    const c   = f.properties.color;
    console.log(`   ${c}  ${label(c)}  ${len} m  (${f.geometry.coordinates.length} pts)`);
  });
}
if (matchedSegPts) {
  const len = m(ptsLength(matchedSegPts));
  console.log(`   #48f  ${label('#48f')}  ${len} m  (always)`);
}

console.log(`\n   RD on — all BFS branches:`);
const rdOn = overlayGeoJSON(segments, mainRoadPts, true, card, speedKmh, aThreshold);
if (rdOn.features.length === 0) {
  console.log(`   (none)`);
} else {
  rdOn.features.forEach(f => {
    const len = m(ptsLength(f.geometry.coordinates));
    const c   = f.properties.color;
    console.log(`   ${c}  ${label(c)}  ${len} m  (${f.geometry.coordinates.length} pts)`);
  });
}
if (matchedSegPts) {
  const len = m(ptsLength(matchedSegPts));
  console.log(`   #48f  ${label('#48f')}  ${len} m  (always)`);
}

console.log('');
