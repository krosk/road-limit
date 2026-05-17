import { haversine, bearingTo, angleDiff, circumradius } from './geo.js';

/**
 * Parse a speed tag into km/h.
 * "50" → 50, "30 mph" → 48, null/undefined/"walk" → null
 */
export function parseSpeed(tag) {
  if (!tag) return null;
  const m = String(tag).match(/^(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return String(tag).toLowerCase().includes('mph') ? Math.round(v * 1.60934) : v;
}

/**
 * Distance in meters from point (posLon, posLat) to the nearest point
 * on the segment defined by c1=[lon,lat] and c2=[lon,lat].
 */
export function distToSegment(posLon, posLat, c1, c2) {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversine(posLat, posLon, c1[1], c1[0]);
  const t = Math.max(0, Math.min(1,
    ((posLon - c1[0]) * dx + (posLat - c1[1]) * dy) / lenSq
  ));
  const nearLat = c1[1] + t * dy;
  const nearLon = c1[0] + t * dx;
  return haversine(posLat, posLon, nearLat, nearLon);
}

/**
 * Match the nearest road segment to the current position.
 * features: GeoJSON LineString features
 * Returns {feature, coords, segIdx, forward, dist} or null.
 * segIdx: the node index from which to start lookahead (adjusted for heading).
 * forward: whether to walk up (true) or down (false) the coords array.
 */
export function matchRoad(features, lon, lat, heading) {
  let best = null;
  let bestDist = Infinity;

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || geom.type !== 'LineString') continue;
    const coords = geom.coordinates; // [[lon, lat], ...]
    for (let i = 0; i < coords.length - 1; i++) {
      const c1 = coords[i];
      const c2 = coords[i + 1];
      const d = distToSegment(lon, lat, c1, c2);
      if (d < bestDist) {
        bestDist = d;
        const segBear = bearingTo(c1[1], c1[0], c2[1], c2[0]);
        const forward = heading === null || heading === undefined
          ? true
          : angleDiff(heading, segBear) < 90;
        // segIdx: next node in direction of travel
        const segIdx = forward ? i + 1 : i;
        best = { feature, coords, segIdx, forward, dist: d };
      }
    }
  }

  return best;
}

/**
 * Walk from startIdx along coords in direction (forward=true → increasing index).
 * Stops when cumulative distance exceeds maxDist.
 * Returns subset of coords as [[lon,lat], ...].
 */
export function collectAhead(coords, startIdx, forward, maxDist) {
  const result = [];
  const step = forward ? 1 : -1;
  let dist = 0;
  let prevPt = null;

  for (let i = startIdx; i >= 0 && i < coords.length; i += step) {
    const pt = coords[i];
    if (prevPt !== null) {
      dist += haversine(prevPt[1], prevPt[0], pt[1], pt[0]);
      if (dist > maxDist) break;
    }
    result.push(pt);
    prevPt = pt;
  }

  return result;
}

/**
 * Detect the first significant turn in a sequence of geo points.
 * pts: [[lon, lat], ...]
 * Returns {distance, angle, radius} or null.
 * distance: meters from pts[0] to the turn node.
 * angle: heading change in degrees.
 * radius: circumradius in meters.
 */
export function detectTurn(pts, turnAngleMin = 15) {
  if (pts.length < 3) return null;

  // Build cumulative distances from pts[0]
  const cumdist = [0];
  for (let i = 1; i < pts.length; i++) {
    cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const b1 = bearingTo(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    const b2 = bearingTo(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);
    const angle = angleDiff(b1, b2);

    if (angle >= turnAngleMin) {
      const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
      return {
        distance: cumdist[i],
        angle,
        radius: r,
      };
    }
  }

  return null;
}

/**
 * Maximum safe cornering speed in km/h given radius and lateral acceleration threshold.
 * v = sqrt(a * r) * 3.6
 * Returns null for Infinity radius.
 */
export function corneringSpeed(radius, aThresholdMs2) {
  if (!isFinite(radius)) return null;
  return Math.round(Math.sqrt(aThresholdMs2 * radius) * 3.6);
}

/**
 * Returns array of road segments roughly ahead of current position.
 * Each entry: {pts, speedLimit, turn, midpoint}
 * midpoint: [lon, lat] at middle of pts array.
 */
export function segmentsAhead(features, lon, lat, heading, maxDist, turnAngleMin = 15) {
  const results = [];

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || geom.type !== 'LineString') continue;
    const coords = geom.coordinates; // [[lon, lat], ...]

    // Find closest node
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversine(lat, lon, coords[i][1], coords[i][0]);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    if (closestDist > maxDist) continue;

    const closestNode = coords[closestIdx];
    const bearingToNode = bearingTo(lat, lon, closestNode[1], closestNode[0]);

    // Directional filter: skip if heading is available and node is >90° off heading
    if (heading !== null && heading !== undefined) {
      if (angleDiff(heading, bearingToNode) > 90) continue;
    }

    // Determine direction along the road from the closest node
    // Forward if the next node in the array is roughly ahead
    let forward = true;
    if (closestIdx < coords.length - 1) {
      const nextBear = bearingTo(
        coords[closestIdx][1], coords[closestIdx][0],
        coords[closestIdx + 1][1], coords[closestIdx + 1][0]
      );
      if (heading !== null && heading !== undefined) {
        forward = angleDiff(heading, nextBear) < 90;
      }
    } else {
      forward = false;
    }

    const pts = collectAhead(coords, closestIdx, forward, maxDist);

    const speedLimit = parseSpeed(feature.properties && feature.properties.maxspeed);
    const turn = detectTurn(pts, turnAngleMin);

    const midIdx = Math.floor(pts.length / 2);
    const midpoint = pts[midIdx] || pts[0];

    results.push({ pts, speedLimit, turn, midpoint });
  }

  return results;
}

/**
 * Returns true if exactly one segment is ahead (not a junction).
 */
export function isSingleRoadAhead(segments) {
  return segments.length === 1;
}
