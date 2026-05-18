import { corneringSpeed } from './road.js';
import { circumradius } from './geo.js';

/**
 * Nearest upcoming turn for the corner badge.
 * Returns {limit, distance, isOver} or null when nothing is ahead.
 */
export function computeCornerBadge(segments, speedKmh, aThreshold) {
  let nearestTurn = null;
  let nearestLimit = null;
  for (const seg of segments) {
    if (seg.isBehind) continue;
    for (const turn of (seg.turns ?? [])) {
      if (nearestTurn === null || turn.distance < nearestTurn.distance) {
        nearestTurn = turn;
        nearestLimit = corneringSpeed(turn.radius, aThreshold);
      }
    }
  }
  if (nearestTurn === null || nearestLimit === null) return null;
  return { limit: nearestLimit, distance: nearestTurn.distance, isOver: speedKmh > nearestLimit };
}

/**
 * Overlay color for a road segment based on its tightest cornering limit.
 * '#888' gray = no turns; '#3a9' green = safe; '#f90' orange = within 10 km/h; '#e33' red = over.
 */
export function segmentLineColor(seg, speedKmh, aThreshold) {
  const limits = (seg.turns ?? [])
    .map(t => corneringSpeed(t.radius, aThreshold))
    .filter(l => l !== null);
  const minLimit = limits.length > 0 ? Math.min(...limits) : null;
  if (minLimit === null)         return '#888';
  if (speedKmh > minLimit)      return '#e33';
  if (speedKmh > minLimit - 10) return '#f90';
  return '#3a9';
}

/**
 * GeoJSON FeatureCollection for the MapLibre segment overlay.
 */
export function segmentsGeoJSON(segments, speedKmh, aThreshold) {
  return {
    type: 'FeatureCollection',
    features: segments.map(seg => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: seg.pts },
      properties: { color: segmentLineColor(seg, speedKmh, aThreshold) },
    })),
  };
}

/**
 * Status line string.
 */
export function statusText(features, segments, match, accuracy) {
  const distStr = match ? `${Math.round(match.dist)} m to road` : 'no road';
  const aheadCount  = segments.filter(s => !s.isBehind).length;
  const behindCount = segments.filter(s =>  s.isBehind).length;
  return `±${Math.round(accuracy ?? 0)} m · ${features.length} roads · ${aheadCount}↑ ${behindCount}↓ edges · ${distStr}`;
}

/**
 * G-bar display state: {pct, className, text}.
 */
export function barState(value, limit) {
  const pct = Math.min(100, (value / (limit * 2)) * 100);
  const className = value > limit ? 'over' : value > limit * 0.7 ? 'warn' : '';
  return { pct, className, text: value.toFixed(2) + 'g' };
}

/**
 * On-map speed badge data. Returns [{pts, turnDistance, limit, isOver}, …].
 * The caller uses pts + turnDistance to place the badge via ptAtDistance.
 */
export function badgeItems(segments, speedKmh, aThreshold) {
  const items = [];
  for (const seg of segments) {
    if (seg.isBehind) continue;
    for (const turn of (seg.turns ?? [])) {
      const limit = corneringSpeed(turn.radius, aThreshold);
      if (limit === null) continue;
      items.push({ pts: seg.pts, turnDistance: turn.distance, limit, isOver: speedKmh > limit });
    }
  }
  return items;
}

/**
 * GeoJSON features for the debug triplet overlay (yellow = tight, gray = loose).
 */
export function debugTripletFeatures(segments, maxTurnRadius) {
  const features = [];
  for (const seg of segments) {
    if (seg.isBehind) continue;
    const pts = seg.pts;
    for (let i = 1; i < pts.length - 1; i++) {
      const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [pts[i - 1], pts[i], pts[i + 1]] },
        properties: { color: r <= maxTurnRadius ? '#ff0' : '#555' },
      });
    }
  }
  return features;
}
