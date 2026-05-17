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
 * Detect the first significant curve in a sequence of geo points.
 * Uses circumradius on every consecutive triplet — catches gentle highway
 * curves that span many nodes with small per-node angle changes.
 * pts: [[lon, lat], ...]
 * maxRadius: ignore curves with radius above this (metres). Default 2000m
 *   corresponds to ~160 km/h safe speed at 0.3g — above any road limit.
 * Returns {distance, angle, radius} or null.
 */
export function detectTurn(pts, maxRadius = 2000) {
  if (pts.length < 3) return null;

  const cumdist = [0];
  for (let i = 1; i < pts.length; i++) {
    cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
    if (r <= maxRadius) {
      const b1 = bearingTo(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
      const b2 = bearingTo(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);
      return { distance: cumdist[i], angle: angleDiff(b1, b2), radius: r };
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
 * Returns array of road segments ahead of current position.
 * Finds the current road, walks it forward, then branches at junctions.
 * Each entry: {pts, speedLimit, turn, midpoint}
 * midpoint: [lon, lat] at middle of pts array.
 */
export function segmentsAhead(features, lon, lat, heading, maxDist, maxRadius = 2000, lookBehind = 0, matchMaxDist = 50) {
  const results = [];

  // Match the road the car is currently on
  const match = matchRoad(features, lon, lat, heading);
  if (!match || match.dist > matchMaxDist) return results;

  // Walk the current road backward (behind the car).
  // Start from the same node as the forward walk so the overlays share an endpoint.
  if (lookBehind > 0) {
    const behindPts = collectAhead(match.coords, match.segIdx, !match.forward, lookBehind);
    if (behindPts.length >= 2) {
      const midpoint = behindPts[Math.floor(behindPts.length / 2)];
      results.push({ pts: behindPts, speedLimit: null, turn: null, midpoint });
    }
  }

  // BFS forward over the road network.
  // Each queue entry carries the cumulative road-distance from the car so the
  // 500 m budget is spent correctly across multi-hop junctions.
  const JUNCTION_THRESH = 25; // metres — node proximity to count as a junction
  const visited = new Set();
  const queue = [{ feature: match.feature, startIdx: match.segIdx, forward: match.forward, distFromCar: 0 }];
  visited.add(match.feature);

  while (queue.length > 0) {
    const { feature, startIdx, forward, distFromCar } = queue.shift();
    const coords = feature.geometry.coordinates;
    const remaining = maxDist - distFromCar;
    if (remaining <= 0) continue;

    const pts = collectAhead(coords, startIdx, forward, remaining);
    if (pts.length < 2) continue;

    const speedLimit = parseSpeed(feature.properties?.maxspeed);
    const turn = detectTurn(pts, maxRadius);
    const midpoint = pts[Math.floor(pts.length / 2)];
    results.push({ pts, speedLimit, turn, midpoint });

    // Cumulative distances along pts — used to place the junction in the distance budget
    const cumdist = [0];
    for (let i = 1; i < pts.length; i++) {
      cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
    }

    // Find connecting features whose nodes touch this walked segment
    for (const other of features) {
      if (visited.has(other)) continue;
      const geom = other.geometry;
      if (!geom || geom.type !== 'LineString') continue;
      const otherCoords = geom.coordinates;

      let bestNodeIdx = -1;
      let bestDist = Infinity;
      let junctionDistFromCar = Infinity;

      for (let ni = 0; ni < otherCoords.length; ni++) {
        for (let pi = 0; pi < pts.length; pi++) {
          const d = haversine(otherCoords[ni][1], otherCoords[ni][0], pts[pi][1], pts[pi][0]);
          if (d < bestDist) {
            bestDist = d;
            bestNodeIdx = ni;
            junctionDistFromCar = distFromCar + cumdist[pi];
          }
        }
      }

      if (bestDist > JUNCTION_THRESH || junctionDistFromCar >= maxDist) continue;

      visited.add(other);

      // Walk both directions from the junction node — driver may turn either way
      if (bestNodeIdx < otherCoords.length - 1) {
        queue.push({ feature: other, startIdx: bestNodeIdx, forward: true, distFromCar: junctionDistFromCar });
      }
      if (bestNodeIdx > 0) {
        queue.push({ feature: other, startIdx: bestNodeIdx, forward: false, distFromCar: junctionDistFromCar });
      }
    }
  }

  return results;
}

/**
 * Returns true if exactly one segment is ahead (not a junction).
 */
export function isSingleRoadAhead(segments) {
  return segments.length === 1;
}
