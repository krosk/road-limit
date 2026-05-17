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

### First approach (rejected)

Show a badge on every road feature within 500m in the forward half-plane.
Problem: fired badges on roads 300m to the side that happened to be in the
forward hemisphere but were clearly not on the driver's path.

## Decision

**Map badges for all branches; bottom alert only on single-road stretches.**

The `segmentsAhead` algorithm (`lib/road.js`):

1. **Match** the current road using `matchRoad` (nearest road segment within 50m).
2. **Walk** the matched road forward up to `CFG.lookahead` (500m), collecting nodes.
3. **Branch**: for every other visible road feature, find its closest node to
   any point on the walked path. If within 25m (junction threshold), add it
   as a branch segment, walking away from the junction up to the remaining distance.

The bottom alert (`#turn-warning`) fires only when `isSingleRoadAhead` is true
— i.e., no junction branches were found. At junctions, the map badges carry
the information instead.

### Speed limit gaps

OSM `maxspeed` tags are absent on many minor roads. When missing, the badge
shows the cornering-speed estimate from geometry (`corneringSpeed(radius, aThreshold)`).
When no turn is detected either, no badge is shown for that segment.

## Consequences

- Badges appear only on roads actually connected to the driver's current road.
- At junctions the driver sees what each branch allows, without a forced prediction.
- The 25m junction threshold works for normal road intersections; very wide
  roads or complex interchanges may miss branches. Tunable if needed.
- Tile boundary clipping can split one road into two features. The proximity
  check handles this transparently (the split feature's start node is within
  25m of the main road's last node).
