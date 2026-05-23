/**
 * geo.js — Pure geometry math, no dependencies.
 *
 * Provides the haversine distance, bearing, angular difference, circumradius,
 * and coordinate-walking utilities used throughout the lib layer. Every
 * calculation here operates on raw lat/lon pairs with no knowledge of roads,
 * tiles, or application state.
 *
 * Owns: haversine, bearingTo, angleDiff, circumradius, ptAtDistance,
 *   bearingAtDistance, destPoint.
 * Does not own: road matching, tile normalisation, display formatting.
 * All functions are pure — no side effects, no module state.
 * Coordinates follow GeoJSON convention: [lon, lat].
 * circumradius returns Infinity for collinear or near-coincident points.
 */
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

/**
 * Haversine distance between two lat/lon points in meters.
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing from point 1 to point 2, in degrees 0–360.
 */
export function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Absolute angular difference between two bearings, always 0–180.
 */
export function angleDiff(a, b) {
  const diff = Math.abs(((b - a + 540) % 360) - 180);
  return diff;
}

/**
 * Circumradius (in meters) of the triangle formed by three geo points.
 * p = [lon, lat]
 * Returns Infinity if points are collinear (degenerate triangle).
 */
export function circumradius(p1, p2, p3) {
  // p = [lon, lat]
  const a = haversine(p2[1], p2[0], p3[1], p3[0]);
  const b = haversine(p1[1], p1[0], p3[1], p3[0]);
  const c = haversine(p1[1], p1[0], p2[1], p2[0]);
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c);
  if (area2 <= 0) return Infinity;
  const area = Math.sqrt(area2);
  if (area < 0.5) return Infinity;
  return (a * b * c) / (4 * area);
}

/**
 * Interpolated [lon, lat] at cumulative distance d along polyline pts=[[lon,lat],…].
 * Returns the last point when d exceeds the polyline length.
 */
export function ptAtDistance(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    if (acc + seg >= d) {
      const t = seg > 0 ? (d - acc) / seg : 0;
      return [
        pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]),
        pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
      ];
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

/**
 * Road bearing (degrees) at cumulative distance d along polyline pts=[[lon,lat],…].
 */
export function bearingAtDistance(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    if (acc + seg >= d || i === pts.length - 1) {
      return bearingTo(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    }
    acc += seg;
  }
  return 0;
}

/**
 * Destination point given a start lat/lon, bearing (degrees), and distance (meters).
 * Returns [lat, lon].
 */
export function destPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6371000;
  const d = distanceM / R;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [toDeg(lat2), ((toDeg(lon2) + 540) % 360) - 180];
}
