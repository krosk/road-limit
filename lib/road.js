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
 * Returns {feature, coords, segIdx, forward, dist, snapPt} or null.
 * segIdx: the node index from which to start lookahead (adjusted for heading).
 * forward: whether to walk up (true) or down (false) the coords array.
 * snapPt: the road node immediately behind the car in travel direction.
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
        // snapPt: node just behind the car — coords[i] forward, coords[i+1] backward
        const segIdx = forward ? i + 1 : i;
        const snapPt = forward ? coords[i] : coords[i + 1];
        best = { feature, coords, segIdx, forward, dist: d, snapPt };
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
  const all = detectAllTurns(pts, maxRadius);
  return all.length > 0 ? all[0] : null;
}

/**
 * Detect all significant curves in a sequence of geo points.
 * Same algorithm as detectTurn but collects every curve, skipping 3 nodes
 * after each hit to avoid counting the same physical bend multiple times.
 * Returns [{distance, angle, radius}, ...] (may be empty).
 */
export function detectAllTurns(pts, maxRadius = 2000) {
  if (pts.length < 3) return [];

  const cumdist = [0];
  for (let i = 1; i < pts.length; i++) {
    cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
  }

  // For each interior node compute the minimum circumradius of all triplets
  // that include it (up to 3). This flags nodes that sit between two tight
  // triplets even if their own triplet has a large radius.
  const nodeMinR = new Array(pts.length).fill(Infinity);
  for (let i = 1; i < pts.length - 1; i++) {
    const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
    if (r < nodeMinR[i - 1]) nodeMinR[i - 1] = r;
    if (r < nodeMinR[i])     nodeMinR[i]     = r;
    if (r < nodeMinR[i + 1]) nodeMinR[i + 1] = r;
  }

  const turns = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (nodeMinR[i] <= maxRadius) {
      const b1 = bearingTo(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
      const b2 = bearingTo(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);
      turns.push({ distance: cumdist[i], angle: angleDiff(b1, b2), radius: nodeMinR[i] });
    }
  }
  return turns;
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
      results.push({ pts: behindPts, speedLimit: null, turn: null, midpoint, isBehind: true });
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

    // Cumulative distances along pts — used to place the junction in the distance budget
    const cumdist = [0];
    for (let i = 1; i < pts.length; i++) {
      cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
    }

    // Find connecting features whose nodes touch this walked segment.
    // Run even when pts.length < 2 so that BFS propagates across feature
    // boundaries when the car sits exactly at a feature endpoint (e.g. a
    // short bridge tile boundary with only 2 coords where the car lands
    // on the endpoint and collectAhead yields just 1 point).
    if (pts.length >= 1) {
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

        // Walk both directions from the junction node — driver may turn either way.
        // One-way roads (oneway===1) must only be walked in coordinate order; the
        // reverse direction is contra-flow and the heading filter will correctly
        // reject the forward walk if it points back toward the car.
        const isOneway = other.properties?.oneway === 1;
        if (bestNodeIdx < otherCoords.length - 1) {
          queue.push({ feature: other, startIdx: bestNodeIdx, forward: true, distFromCar: junctionDistFromCar });
        }
        if (bestNodeIdx > 0 && !isOneway) {
          queue.push({ feature: other, startIdx: bestNodeIdx, forward: false, distFromCar: junctionDistFromCar });
        }
      }
    }

    if (pts.length < 2) continue;

    // Drop segments going backward relative to heading from the visual overlay.
    // BFS always branches both ways at junction nodes; the branch toward where
    // the driver came from starts in the opposite direction.
    // Use initial bearing (pts[0]→pts[1]) rather than net bearing so a road that
    // starts in the right direction but curves away within the lookahead is kept.
    // Junction discovery above runs regardless so connected roads are still queued.
    if (heading !== null && heading !== undefined) {
      const initB = bearingTo(pts[0][1], pts[0][0], pts[1][1], pts[1][0]);
      if (angleDiff(heading, initB) > 90) continue;
    }

    const speedLimit = parseSpeed(feature.properties?.maxspeed);
    const roadClass = feature.properties?.class ?? null;
    const isRamp = feature.properties?.ramp === 1;
    const isMatched = feature === match.feature;
    const turns = detectAllTurns(pts, maxRadius);
    const turn = turns[0] ?? null;
    const midpoint = pts[Math.floor(pts.length / 2)];
    const carPos = isMatched ? { carLon: lon, carLat: lat } : {};
    results.push({ pts, speedLimit, roadClass, isRamp, isMatched, turn, turns, midpoint, ...carPos });
  }

  return results;
}

/**
 * Returns true if exactly one segment is ahead (not a junction).
 * The lookBehind segment (isBehind: true) is excluded from the count.
 */
export function isSingleRoadAhead(segments) {
  return segments.filter(s => !s.isBehind).length === 1;
}

/**
 * Find the first significant turn arc ahead of the current position.
 * Returns { pts, card, reason } where:
 *   pts    — selected segment coordinates (null when no single direction resolved)
 *   card   — { distanceToStart, arcLength, minRadius, minSpeed, direction } or null
 *   reason — null (card shown) | 'no match' | 'junction' | 'straight'
 */
export function firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold) {
  const forward = segments.filter(s => !s.isBehind);
  if (forward.length === 0) return { pts: null, card: null, reason: 'no match' };

  // Group segments by net bearing (pts[0] → pts[last]).
  // Rules:
  // 1. Discard segments whose net bearing is >90° from heading — BFS always
  //    branches in both directions at junction nodes, so the "backward" branch
  //    (road the driver came from) always appears and must be ignored.
  // 2. Segments shorter than SEGMENT_MIN_LENGTH m cannot CREATE a new direction
  //    group. They may only JOIN an existing group within a wider 45° tolerance.
  //    This prevents a tiny feature-boundary stub (e.g. the last 24 m of a
  //    feature before BFS continues onto the next feature) from being counted as
  //    a separate road direction.
  // 3. Remaining groups within 30° of each other are the same road split across
  //    OSM features (tile boundaries, overlapping geometries).
  // 4. After grouping, discard groups on minor non-driveable ways (track/path/…)
  //    when at least one group is on a proper road — these are field tracks or
  //    footpaths that drivers do not turn onto intentionally.
  // Only suppress the turn card if genuinely distinct directions exist.
  const SEGMENT_MIN_LENGTH = 30; // metres
  const MINOR_CLASSES = new Set(['minor', 'service', 'track', 'path', 'footway', 'cycleway', 'steps', 'bridleway']);
  const netBearing = seg =>
    seg.pts.length >= 2
      ? bearingTo(seg.pts[0][1], seg.pts[0][0], seg.pts[seg.pts.length - 1][1], seg.pts[seg.pts.length - 1][0])
      : null;
  const initBearing = seg =>
    seg.pts.length >= 2
      ? bearingTo(seg.pts[0][1], seg.pts[0][0], seg.pts[1][1], seg.pts[1][0])
      : null;

  // When heading is unknown, derive a reference direction from the matched segment
  // (forward[0]) so the opposite motorway carriageway — queued in its own forward
  // (contra-flow) direction by BFS — is still filtered as backward.
  const refHeading = (heading !== null && heading !== undefined)
    ? heading
    : (forward[0] && initBearing(forward[0])) ?? null;

  let dirGroups = [];
  for (const seg of forward) {
    const b = netBearing(seg);
    if (b === null) continue;
    if (refHeading !== null && angleDiff(refHeading, initBearing(seg)) > 90) continue;
    let segLen = 0;
    for (let i = 1; i < seg.pts.length; i++) {
      segLen += haversine(seg.pts[i - 1][1], seg.pts[i - 1][0], seg.pts[i][1], seg.pts[i][0]);
    }
    const joinThreshold = segLen > SEGMENT_MIN_LENGTH ? 30 : 45;
    const group = dirGroups.find(g => angleDiff(b, g.bearing) < joinThreshold);
    if (group) {
      const newIsMinor   = MINOR_CLASSES.has(seg.roadClass);
      const existIsMinor = MINOR_CLASSES.has(group.seg.roadClass);
      const classBetter  = existIsMinor && !newIsMinor;
      const classSame    = newIsMinor === existIsMinor;
      const rampBetter   = classSame && group.seg.isRamp && !seg.isRamp;
      const rampSame     = group.seg.isRamp === seg.isRamp;
      // Prefer main road over minor, non-ramp over ramp; among same tier, longer wins.
      // Never evict the matched segment — it represents the road the car is actually on.
      if (!group.seg.isMatched && (classBetter || rampBetter || (classSame && rampSame && seg.pts.length > group.seg.pts.length))) {
        group.seg = seg; group.bearing = b;
      }
      if (seg.isMatched) group.hasMatched = true;
    } else if (segLen > SEGMENT_MIN_LENGTH || seg.isMatched) {
      dirGroups.push({ bearing: b, seg, hasMatched: !!seg.isMatched });
    }
  }
  if (dirGroups.length > 1) {
    const hasMainRoad = dirGroups.some(g => !MINOR_CLASSES.has(g.seg.roadClass));
    if (hasMainRoad) dirGroups = dirGroups.filter(g => !MINOR_CLASSES.has(g.seg.roadClass));
  }
  if (dirGroups.length > 1) {
    // Ramp filter: when car is on a ramp, non-ramp parallel carriageways are not forward
    // options (they are adjacent lanes going the same way, not a turn choice).
    // When car is on a main road, ramp spurs are not forward options.
    const matchedIsRamp = dirGroups.some(g => g.hasMatched && g.seg.isRamp);
    if (matchedIsRamp) {
      const hasRamp = dirGroups.some(g => g.seg.isRamp);
      if (hasRamp) dirGroups = dirGroups.filter(g => g.seg.isRamp);
    } else {
      const hasNonRamp = dirGroups.some(g => !g.seg.isRamp);
      if (hasNonRamp) dirGroups = dirGroups.filter(g => !g.seg.isRamp);
    }
  }
  // Series merge: if exactly one other group's segment starts at the matched group's end,
  // they are the same road in sequence (e.g. a curvy ramp split across features), not a fork.
  // A true junction has multiple groups all starting from the same fork node.
  if (dirGroups.length > 1) {
    const matchedGroup = dirGroups.find(g => g.hasMatched);
    if (matchedGroup) {
      const end = matchedGroup.seg.pts[matchedGroup.seg.pts.length - 1];
      const matchedNetBearing = netBearing(matchedGroup.seg);
      const continuations = dirGroups.filter(g => {
        if (g === matchedGroup) return false;
        const dist = haversine(end[1], end[0], g.seg.pts[0][1], g.seg.pts[0][0]);
        if (dist >= 25) return false;
        // Exact endpoint match (same OSM node, road split across features): merge freely.
        // For non-adjacent continuations require bearing alignment — a segment starting nearby
        // but heading a very different direction is a diverging road, not a continuation.
        if (dist < 2) return true;
        return matchedNetBearing === null || angleDiff(matchedNetBearing, netBearing(g.seg)) < 45;
      });
      if (continuations.length === 1) {
        const cont = continuations[0].seg;
        matchedGroup.seg = { ...cont, pts: [...matchedGroup.seg.pts, ...cont.pts.slice(1)] };
        dirGroups = dirGroups.filter(g => g !== continuations[0]);
      }
    }
  }
  if (dirGroups.length !== 1) return {
    pts: null, card: null, reason: 'junction',
    junctionGroups: dirGroups.map(g => ({ pts: g.seg.pts, isMatched: g.hasMatched })),
  };

  const selectedSeg = dirGroups[0].seg;
  const pts = selectedSeg.pts;
  if (pts.length < 3) return { pts, card: null, reason: 'straight' };
  // Car position stored on the matched segment by segmentsAhead; fall back to pts[0]
  const carLat = selectedSeg.carLat ?? pts[0][1];
  const carLon = selectedSeg.carLon ?? pts[0][0];

  const cumdist = [0];
  for (let i = 1; i < pts.length; i++) {
    cumdist.push(cumdist[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
  }

  const nodeMinR = new Array(pts.length).fill(Infinity);
  for (let i = 1; i < pts.length - 1; i++) {
    const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
    if (r < nodeMinR[i - 1]) nodeMinR[i - 1] = r;
    if (r < nodeMinR[i])     nodeMinR[i]     = r;
    if (r < nodeMinR[i + 1]) nodeMinR[i + 1] = r;
  }

  // Skip pts[0] (matched node, never a turn trigger) — same convention as detectAllTurns
  let firstTightIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    if (nodeMinR[i] <= maxTurnRadius) { firstTightIdx = i; break; }
  }
  if (firstTightIdx === -1 || cumdist[firstTightIdx] > lookahead) return { pts, card: null, reason: 'straight' };

  // Arc: contiguous tight nodes forward from firstTightIdx
  let arcStartIdx = firstTightIdx;
  let arcEndIdx = firstTightIdx;
  while (arcEndIdx < pts.length - 1 && nodeMinR[arcEndIdx + 1] <= maxTurnRadius) arcEndIdx++;

  let minRadius = Infinity;
  for (let i = arcStartIdx; i <= arcEndIdx; i++) {
    if (nodeMinR[i] < minRadius) minRadius = nodeMinR[i];
  }

  const enterBearing = arcStartIdx > 0
    ? bearingTo(pts[arcStartIdx - 1][1], pts[arcStartIdx - 1][0], pts[arcStartIdx][1], pts[arcStartIdx][0])
    : bearingTo(pts[0][1], pts[0][0], pts[1][1], pts[1][0]);
  const exitBearing = arcEndIdx < pts.length - 1
    ? bearingTo(pts[arcEndIdx][1], pts[arcEndIdx][0], pts[arcEndIdx + 1][1], pts[arcEndIdx + 1][0])
    : bearingTo(pts[arcEndIdx - 1][1], pts[arcEndIdx - 1][0], pts[arcEndIdx][1], pts[arcEndIdx][0]);

  const signedDiff = ((exitBearing - enterBearing + 540) % 360) - 180;

  return {
    pts,
    card: {
      distanceToStart: cumdist[arcStartIdx] + haversine(carLat, carLon, pts[0][1], pts[0][0]),
      arcLength: cumdist[arcEndIdx] - cumdist[arcStartIdx],
      minRadius,
      minSpeed: corneringSpeed(minRadius, aThreshold),
      direction: signedDiff >= 0 ? 'right' : 'left',
    },
    reason: null,
  };
}

/**
 * Normalise a raw queryRenderedFeatures result to LineString-only features.
 * MapLibre clips roads at tile boundaries and returns the clipped pieces as
 * MultiLineString. This expands each MultiLineString into individual LineString
 * features (sharing the same properties) so lib code never sees MultiLineString.
 */
export function normaliseFeatures(raw) {
  const seen = new Set();
  const out = [];
  for (const feat of raw) {
    const type = feat.geometry?.type;
    if (type === 'LineString') {
      const coords = feat.geometry.coordinates;
      const key = `${coords[0]};${coords[coords.length - 1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'Feature', geometry: feat.geometry, properties: feat.properties ?? {} });
    } else if (type === 'MultiLineString') {
      for (const coords of feat.geometry.coordinates) {
        const key = `${coords[0]};${coords[coords.length - 1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties ?? {} });
      }
    }
  }
  return out;
}
