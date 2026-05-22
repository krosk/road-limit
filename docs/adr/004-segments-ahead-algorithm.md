# ADR 004 — Segments-ahead algorithm and junction handling

## Status
Accepted (updated to reflect current implementation)

## Context

### Turn speed formula

The maximum safe speed through a turn of radius r given lateral acceleration
limit a is:

```
v_max = sqrt(a × r)   (r in metres, a in m/s², result in m/s → convert to km/h)
```

`r` is computed as the circumradius of the triangle formed by three consecutive
road nodes around the turn (Heron's formula). `a` defaults to 0.5g = 4.905 m/s²
— the presumed insurer threshold, tunable via `CFG.aThreshold`.

### Junction problem

At a junction, multiple roads branch ahead. Naively picking "the next turn"
would fire false warnings for branches the driver won't take.

### Approach 1 (rejected): forward half-plane scan

Show a badge on every road feature within 500 m in the forward half-plane.
Problem: fired badges on roads 300 m to the side that happened to be in the
forward hemisphere but were clearly not on the driver's path.

### Approach 2 (rejected): one-level junction detection

Match the current road, walk it forward, scan all other features for nodes
within 25 m of the walked path. One level deep: junctions off junctions were
invisible.

## Decision

**BFS over the connected road graph. `firstTurnAhead` selects the single most
likely road ahead and returns a turn card; map badges cover all branches.**

---

### `matchRoad` (`lib/road.js`)

Finds the nearest road to the car by perpendicular distance to each segment.
Returns `{feature, coords, segIdx, forward, dist, snapPt}`:

- `segIdx` — index of the first coordinate *ahead* of the car along the matched
  feature (the next OSM node in the direction of travel).
- `forward` — true when the car travels in coordinate order.
- `snapPt` — the last OSM node the car has *already passed* on this feature
  (`coords[segIdx-1]` when forward, `coords[segIdx+1]` when backward). Combined
  with `coords[segIdx]` this gives a geometrically valid two-node segment the
  car is currently on.
- **Contra-flow oneway skip**: if a feature has `oneway===1` and the car's
  heading is more than 90° from the feature's forward bearing, `matchRoad`
  skips that feature entirely. Matching a contra-flow oneway forces `forward=true`
  (you cannot legally go the other way), which places the BFS start at the wrong
  end of the road and produces forward segments pointing in the wrong direction.

---

### `segmentsAhead` (`lib/road.js`)

```js
segmentsAhead(features, lon, lat, heading, maxDist, maxRadius, lookBehind, matchMaxDist)
```

Called with `lookBehind = 0` and `matchMaxDist = CFG.roadMatchMaxDist` (default 30 m).

1. **Match** the current road with `matchRoad`. Abort if `dist > matchMaxDist`.

2. **BFS forward**: starting from `match.segIdx` in `match.forward` direction,
   explore the road graph up to `maxDist` metres ahead:
   - Dequeue `{feature, startIdx, forward, distFromCar}`.
   - Walk from `startIdx` in the given direction up to the remaining budget
     (`maxDist − distFromCar`), collecting coordinate points.
   - **Oneway queuing**: when discovering connecting features at junction nodes,
     features with `oneway===1` are only queued in the forward (coordinate-order)
     direction. The backward queue entry is skipped — it represents contra-flow
     travel, and on a divided highway the opposite carriageway (oneway in the
     reverse direction) shares junction nodes; its wrong-way backward walk
     would otherwise pass the heading filter and create a spurious second
     direction group.
   - Mark each feature visited (by object identity) to prevent cycles.
   - Charge cumulative distance at the junction point, so `maxDist` is spent
     as road distance from the car, not branch distance.

3. **Heading filter**: after collecting all segments, discard any whose net
   bearing (first → last coordinate) differs from the car's heading by more
   than 90°. This removes the backward BFS branch — the road the driver just
   came from — which BFS always generates by exploring both directions at
   every junction node.

**`JUNCTION_THRESH = 5 m`**: BFS connects two features as a junction only when
an endpoint of one lies within 5 m of an endpoint of the other. OSM roads that
share a node are topologically adjacent; tile-boundary splitting can separate
the same physical node by a few metres, so 5 m accommodates that. At 25 m,
parallel non-topological structures in dense interchanges (e.g. a bridge ramp
21 m away, a parallel motorway carriageway 15 m away) were spuriously connected,
creating false second direction groups and suppressing turn cards (regressions:
roads_43, roads_55).

---

### `firstTurnAhead` (`lib/road.js`)

Takes the BFS segment list and returns the single most likely road ahead plus
a turn card, or a suppression reason.

```js
firstTurnAhead(segments, heading, lookahead, maxTurnRadius, aThreshold)
→ { pts, card, reason, junctionGroups } | null
```

**Direction grouping** (30° tolerance): forward segments are grouped by net
bearing. Groups within 30° of each other represent the same physical road split
across OSM features (tile edges, layer duplicates) and are merged into one
direction group. A representative segment is chosen per group — matched segment
takes priority, then longest by pts count, with road class breaking ties (main
road beats minor road).

**`refHeading`**: the filter uses `refHeading` instead of the raw `heading`.
When `heading` is null (app just started, speed below `minSpeedForHeading`,
compass unavailable), `refHeading` falls back to the initial bearing of
`forward[0]` — the matched segment's own travel direction. Without this,
`heading===null` skips the filter; on a divided highway the opposite
carriageway's contra-flow BFS walk passes unfiltered and creates a spurious
second direction group.

**Minor-class filter**: direction groups whose `roadClass` is in `MINOR_CLASSES`
(`minor`, `service`, `track`, `path`, `footway`, `cycleway`, `steps`,
`bridleway`) are discarded when at least one group is on a proper driveable
road. Residential side streets, service spurs, and footpaths that happen to
branch off a motorway are not genuine turn options and must not suppress the
card.

**Ramp filter**: if two direction groups both contain ramp segments but one
also contains a non-ramp segment, the ramp-only group is discarded. Motorway
on-ramps frequently peel off beside the main carriageway; treating them as a
genuine second direction suppresses the card for the straight road.

**Junction suppression**: after applying both filters, `dirGroups.length !== 1`
means genuinely distinct driveable directions exist → `reason = 'junction'`,
no card shown. `dirGroups.length === 1` → proceed to turn detection on the
representative segment.

**Series merge**: a single logical road is often split across multiple OSM
features (tile boundaries, named segments). If the representative segment ends
within 5 m of the start of another forward segment whose bearing is within 45°
of the representative's bearing, they are concatenated. This gives turn
detection a continuous geometry rather than a stub.

**Turn detection on merged path**: `detectAllTurns` computes the circumradius
for every consecutive triplet of points. A `nodeMinR` pass propagates each
triplet's radius to all three of its nodes so that a node flanked by two tight
triplets is flagged even if its own triplet has a large radius. The tightest
turn within lookahead is returned as the card.

---

### Matched-segment overlay (`renderDashboard` in `index.html`)

`renderDashboard` computes `matchedSegPts = [match.snapPt, match.coords[match.segIdx]]`
— the two OSM nodes bounding the car's current position — and passes it to
`junctionBranchGeoJSON` as a separate, always-valid blue segment rendered via
the `junction-branches` MapLibre source.

This is geometrically guaranteed to be correct (two adjacent nodes on the
matched feature). `snapPt` must never be prepended to `mainRoadPts` from
`firstTurnAhead`: when the minor-class or ramp filter removes the matched
road from the direction groups, `mainRoadPts` comes from a different branch,
making `mainRoadPts[0]` and `snapPt` belong to unrelated features — prepending
draws a false chord across the map (regression: roads_55).

---

### `normaliseFeatures` (`lib/road.js`)

Pure function, applied to the raw `queryRenderedFeatures` output before any
lib function sees the data:

1. Expands `MultiLineString` geometries into individual `LineString` features
   (tile-boundary clipping produces MultiLineString for roads that cross a tile).
2. Deduplicates by `${first_coord};${last_coord}` key — the same physical road
   is returned once per tile layer; deduplication keeps only the first.
3. Strips MapLibre internal fields (`_vectorTileFeature` etc.) to keep
   fixtures small (~60× size reduction).

### `roadLayers` construction

On map load, `roadLayers` is built from all `line`-type style layers whose
`source-layer` is not in a known non-road set (`waterway`, `water`, `water_name`,
`boundary`, `landcover`, `landuse`, `contour`). This catches roads in any
source-layer name the tile schema uses.

## Consequences

- All roads reachable from the car within `CFG.lookahead` (default 120 m) are
  overlaid; no forced prediction about which branch the driver will take.
- The turn card fires only when there is genuinely one driveable direction ahead.
  Junction suppression is conservative: if in doubt, no card is shown.
- `JUNCTION_THRESH = 5 m` means BFS will miss a connecting road if its endpoint
  is more than 5 m from the junction node. In practice this only occurs at
  heavily fragmented interchanges where OSM data itself is imprecise.
- BFS complexity is O(features × endpoints) per render frame. Acceptable for
  the ~50–200 features typical in a 120 m viewport at zoom 16.
- `queryRenderedFeatures` returns 0 features during active tile loading. A
  `map.on('idle')` handler re-triggers `renderDashboard` once tiles settle.
- The first coordinate of every BFS segment (`pts[0]`) can never receive a
  turn badge — it is an endpoint, not an interior curve node. DBG mode marks
  it with a cyan ▶ square.
