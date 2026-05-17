# ADR 004 — Segments-ahead algorithm and junction handling

## Status
Accepted

## Context

### Turn speed formula

The maximum safe speed through a turn of radius r given lateral acceleration
limit a is:

```
v_max = sqrt(a × r) km/h  (with r in metres, a in m/s²)
```

`r` is computed as the circumradius of the triangle formed by three
consecutive road nodes around the turn (Heron's formula). `a` defaults to
0.3g = 2.943 m/s² — the presumed insurer threshold, tunable via `CFG.aThreshold`.

### Junction problem

At a junction, multiple roads branch ahead. Naively picking "the next turn"
would fire false warnings for branches the driver won't take.

### Approach 1 (rejected): forward half-plane scan

Show a badge on every road feature within 500m in the forward half-plane.
Problem: fired badges on roads 300m to the side that happened to be in the
forward hemisphere but were clearly not on the driver's path.

### Approach 2 (superseded): one-level junction detection

Match the current road, walk it forward, then scan all other features for
nodes within 25m of the walked path. One level deep: junctions off junctions
were invisible.

## Decision

**BFS over the connected road graph; badges for all reachable branches;
bottom alert only on single-road stretches.**

### `segmentsAhead` algorithm (`lib/road.js`)

Signature:
```js
segmentsAhead(features, lon, lat, heading, maxDist, maxRadius, lookBehind, matchMaxDist)
```

1. **Match** the current road with `matchRoad` (nearest road segment).
   Abort if `dist > matchMaxDist` (`CFG.roadMatchMaxDist`, default 100 m).

2. **Look behind**: walk `lookBehind` metres backward along the matched road
   (same starting node as the forward walk so the overlays share an endpoint).
   Used to render the grey overlay behind the car for context.

3. **BFS forward**: starting from the matched road, explore the road graph:
   - Dequeue `{feature, startIdx, forward, distFromCar}`.
   - Walk from `startIdx` in `forward` direction up to remaining distance
     (`maxDist − distFromCar`). Add the resulting segment to results.
   - For every other unvisited feature, find its node closest to any point
     in the just-walked segment (junction threshold: 25 m).
   - If within threshold and within budget: mark visited, enqueue **both**
     directions from the junction node (driver may turn either way), carrying
     the cumulative distance to the junction as `distFromCar`.
   - Stop when queue is empty or all remaining distances ≤ 0.

Key properties:
- Features are visited at most once (visited Set keyed by feature object).
- Both directions are explored at each junction, so dead-end roads and
  bidirectional streets are all covered.
- The cumulative distance budget is charged at the junction point, not the
  start of the branch, so 500 m is spent as road distance from the car.

### Road feature normalisation (`getRoadFeatures`)

`queryRenderedFeatures` returns `MultiLineString` for roads that cross tile
boundaries. These are expanded into individual `LineString` features before
being passed to any lib function, so `matchRoad` and `segmentsAhead` only
see `LineString` geometries.

### Display

The bottom alert (`#turn-warning`) fires only when `isSingleRoadAhead` is
true — i.e., exactly one segment is ahead (no BFS branches found). At
junctions the map badges carry the information instead.

### `roadLayers` construction

On map load, `roadLayers` is built from all `line`-type style layers whose
`source-layer` is not in a known non-road set (waterway, water, boundary,
landcover, landuse, contour). This catches roads in any source-layer name
the tile schema uses (OpenFreeMap uses `transportation`).

## Consequences

- All roads reachable from the car's current position within 500 m are
  overlaid, regardless of how many junction hops away they are.
- At junctions the driver sees what each branch allows; no forced prediction.
- The 25 m junction threshold works for normal intersections; very wide roads
  or complex interchanges may miss branches. Tunable if needed.
- BFS complexity is O(features² × nodes) per render frame. Acceptable for
  the ~50–200 features typical in a 500 m viewport at zoom 16.
- `queryRenderedFeatures` returns 0 features during active tile loading (e.g.
  after a large pan). A `map.on('idle')` handler re-triggers `renderDashboard`
  once tiles settle.
