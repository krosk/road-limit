import { corneringSpeed, detectAllTurns } from './road.js';
import { circumradius } from './geo.js';

/**
 * Format firstTurnAhead data for the turn summary card.
 * Returns {direction, minSpeed, distanceToStart, timeToStart, isOver} or null.
 * timeToStart is null when speedKmh is 0.
 */
export function computeTurnCard(turnData, speedKmh) {
  if (turnData === null) return null;
  const { distanceToStart, minSpeed, direction } = turnData;
  if (minSpeed === null) return null;
  const timeToStart = speedKmh > 0
    ? Math.round(distanceToStart / (speedKmh / 3.6))
    : null;
  return {
    direction,
    minSpeed,
    distanceToStart: Math.round(distanceToStart),
    timeToStart,
    isOver: speedKmh > minSpeed,
  };
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
 * GeoJSON FeatureCollection for the map segment overlay.
 * overlayAll=false (default): single segment for the main road path (from firstTurnAhead),
 *   colored by the turn card state (gray/green/orange/red).
 * overlayAll=true: all BFS segments colored per-segment by cornering speed.
 */
export function overlayGeoJSON(segments, mainRoadPts, overlayAll, card, speedKmh, aThreshold) {
  if (overlayAll) {
    return segmentsGeoJSON(segments, speedKmh, aThreshold);
  }
  if (!mainRoadPts || mainRoadPts.length < 2) return { type: 'FeatureCollection', features: [] };
  const color = !card ? '#888'
    : card.isOver ? '#e33'
    : card.minSpeed - speedKmh < 10 ? '#f90'
    : '#3a9';
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: mainRoadPts }, properties: { color } }],
  };
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
 * turnReason: 'no match' | 'junction' | 'straight' | null (when card is shown).
 */
export function statusText(features, segments, match, accuracy, turnReason = null) {
  const distStr = match ? `${Math.round(match.dist)} m to road` : 'no road';
  const aheadCount  = segments.filter(s => !s.isBehind).length;
  const behindCount = segments.filter(s =>  s.isBehind).length;
  let text = `±${Math.round(accuracy ?? 0)} m · ${features.length} roads · ${aheadCount}↑ ${behindCount}↓ edges · ${distStr}`;
  if (turnReason !== null) text += ` · turn: ${turnReason}`;
  return text;
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
 * Badge items respecting the overlay mode.
 * overlayAll=false: badges only for turns on the main road path (mainRoadPts).
 * overlayAll=true:  badges for all forward BFS segments.
 */
export function overlayBadgeItems(segments, mainRoadPts, overlayAll, speedKmh, aThreshold, maxTurnRadius) {
  if (overlayAll) return badgeItems(segments, speedKmh, aThreshold);
  if (!mainRoadPts || mainRoadPts.length < 2) return [];
  const turns = detectAllTurns(mainRoadPts, maxTurnRadius);
  return badgeItems([{ pts: mainRoadPts, turns, isBehind: false }], speedKmh, aThreshold);
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
 * Generate an SVG that traces the actual road geometry for the turn card icon.
 * pts: [[lon, lat], ...] — the BFS segment ahead of the car.
 * Projects to local metres, rotates so the initial direction points up,
 * then scales/centres to fit the w×h viewport.
 * Returns an SVG string using currentColor for stroke.
 */
export function turnPathSVG(pts, w = 52, h = 52) {
  if (!pts || pts.length < 2) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  }

  const M = 111320;
  const cosLat = Math.cos(pts[0][1] * Math.PI / 180);

  // Project to local metres relative to pts[0], y pointing up (north)
  let local = pts.map(([lon, lat]) => [
    (lon - pts[0][0]) * cosLat * M,
    (lat - pts[0][1]) * M,
  ]);

  // Rotate so pts[0]→pts[1] direction points up (positive y in maths)
  const dx0 = local[1][0];
  const dy0 = local[1][1];
  const len0 = Math.hypot(dx0, dy0);
  if (len0 > 0) {
    const nx = dx0 / len0;
    const ny = dy0 / len0;
    local = local.map(([x, y]) => [ny * x - nx * y, nx * x + ny * y]);
  }

  // Flip y for SVG (y increases downward): road now extends toward negative y
  local = local.map(([x, y]) => [x, -y]);

  // Scale to fit the full bounding box, including any curl-back below pts[0].
  // maxYDown > 0 when the path curves back past the start (e.g. tight hairpin).
  const pad = 5;
  const maxXDev = Math.max(...local.map(p => Math.abs(p[0]))) || 1;
  const maxYDown = Math.max(0, ...local.map(p => p[1]));
  const maxYExt  = Math.max(...local.map(p => -p[1])) || 1;
  const scale = Math.min(
    (w / 2 - pad) / maxXDev,
    (h - 2 * pad) / (maxYExt + maxYDown),
  );

  const offX = w / 2;
  const offY = h - pad - maxYDown * scale;

  const scaled = local.map(([x, y]) => [x * scale + offX, y * scale + offY]);

  const svgPts = scaled
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  // Arrowhead triangle at the last point, pointing in direction of travel
  const [lx, ly] = scaled[scaled.length - 1];
  const [px, py] = scaled[scaled.length - 2];
  const adx = lx - px, ady = ly - py;
  const alen = Math.hypot(adx, ady);
  let arrow = '';
  if (alen > 0) {
    const anx = adx / alen, any = ady / alen;
    const aLen = 7, aW = 4;
    // Base of the arrow coincides with the polyline endpoint; tip extends forward.
    const arrowPts = [
      `${(lx + anx * aLen).toFixed(1)},${(ly + any * aLen).toFixed(1)}`,
      `${(lx - any * aW).toFixed(1)},${(ly + anx * aW).toFixed(1)}`,
      `${(lx + any * aW).toFixed(1)},${(ly - anx * aW).toFixed(1)}`,
    ].join(' ');
    arrow = `<polygon points="${arrowPts}" fill="currentColor"/>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${svgPts}" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${arrow}</svg>`;
}

/**
 * GeoJSON FeatureCollection for the matched-segment and junction-branch overlay.
 * matchedSegPts: [snapPt, coords[segIdx]] — the 2-node segment the car is on.
 *   Always drawn in blue, independent of firstTurnAhead's selection.
 * junctionGroups: [{pts, isMatched}] from firstTurnAhead when reason='junction'.
 *   Non-matched branches drawn in magenta; the matched entry is replaced by matchedSegPts.
 */
export function junctionBranchGeoJSON(junctionGroups, matchedSegPts) {
  const features = [];
  if (matchedSegPts && matchedSegPts.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: matchedSegPts },
      properties: { color: '#48f', isMatched: 1 },
    });
  }
  if (junctionGroups) {
    for (const { pts, isMatched } of junctionGroups) {
      if (isMatched) continue; // replaced by matchedSegPts above
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts },
        properties: { color: '#f48', isMatched: 0 },
      });
    }
  }
  return {
    type: 'FeatureCollection',
    features,
  };
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
