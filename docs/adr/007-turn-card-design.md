# ADR 007 — Turn card design: single card replacing corner badge

## Status
Accepted

## Context

The original design showed a corner badge (top-right overlay) with a static
directional arrow (←/↑/→) and the minimum cornering speed for the nearest
turn. It answered "what is the tightest turn ahead?" but gave no sense of
how far away it was, how the road actually curved, or whether the driver was
already over the limit.

Several problems accumulated:
- A static arrow (left/right/straight) conveys no information about the
  shape of the curve — a gentle bend and a hairpin both showed the same icon.
- No distance or time-to-turn meant the driver had no warning horizon.
- The badge was always visible at junctions, firing for branches the driver
  would never take.
- The card and the speed overlay were two separate DOM elements with
  inconsistent styling and positioning.

## Decision

**Replace the corner badge with a single top-left card that expands rightward
when a turn is active. The card shows the actual road geometry as an SVG
polyline, the minimum cornering speed, the distance to the arc start, and
an ETA in seconds. The card is hidden at junctions and when no turn is within
lookahead.**

### Card content

| Field | Value | Condition |
|-------|-------|-----------|
| SVG road trace | Polyline of the BFS segment ahead, rotated so the car points up, with arrowhead | Always when card shown |
| Speed | `card.minSpeed` km/h, red when `speedKmh > minSpeed` | Always |
| Distance | `card.distanceToStart` m (distance to the start of the tightest arc) | Always |
| ETA | `card.timeToStart` s (distance ÷ current speed) | Hidden when speed = 0 |

### SVG road trace (`turnPathSVG` in `lib/display.js`)

The polyline is generated from the BFS segment points (`mainRoadPts`):
1. Project coordinates to local metres relative to `pts[0]` using a flat-earth
   approximation (`cosLat` correction on longitude).
2. Rotate so the `pts[0]→pts[1]` direction points upward (the car travels
   toward the top of the icon).
3. Flip the y-axis for SVG (y increases downward in SVG space).
4. Scale to fill the bounding box of the path including any curl-back below
   `pts[0]` (tight hairpins curve back past the start point).
5. Draw as a `<polyline>` with `currentColor` stroke (inherits white from the
   card) and an arrowhead triangle at the last point.

The result is a miniature road-shape icon unique to the geometry ahead — a
gentle curve shows a gentle arc, a hairpin shows a hairpin.

### When the card is shown vs. suppressed

| Condition | `reason` | Card |
|-----------|----------|------|
| Single driveable direction, turn within lookahead | `null` | Shown |
| Single driveable direction, no turn within lookahead | `'straight'` | Hidden |
| Multiple genuinely distinct driveable directions | `'junction'` | Hidden |
| No road match within `roadMatchMaxDist` | `'no match'` | Hidden |

Junction suppression is the key constraint: the card is only meaningful when
the algorithm is confident the driver has one road ahead. At a fork, showing
a card for the wrong branch would be actively misleading.

### Speed card layout

The speed card (`#speed-overlay`, top-left, always visible) uses a flex row:

```
[ ⛶ ]  [ speed col ]  [ turn col ]
[ ▼ ]
```

The turn column (`#turn-col`) is `display:none` by default and shown only
when a card is active. The card grows rightward from the speed value without
shifting the speed digits. Both columns share the same card background and
border-radius, so they appear as one unified panel.

## Consequences

- Drivers get a preview of the road shape, not just a direction symbol.
  A brief glance conveys whether the upcoming curve is gentle or sharp.
- The distance and ETA fields give a warning horizon proportional to speed.
  At 50 km/h and 100 m away the ETA is ~7 s; at 100 km/h it is ~4 s.
- Suppressing the card at junctions avoids false alarms at the cost of no
  warning at complex intersections. This is the correct trade-off: a false
  alarm trains the driver to ignore the card.
- `turnPathSVG` takes raw BFS segment points, which may extend well past the
  relevant turn. The scale-to-fit approach means a very long straight section
  before a distant curve will compress the curve to a small deflection at the
  top of the icon. Acceptable: the distance field carries the precision.
- `mainRoadPts` comes from `firstTurnAhead` and may belong to a different
  feature than the matched road (e.g. after a minor-class filter removes the
  matched road). The matched segment is always shown separately as a blue
  overlay (`matchedSegPts`), not prepended to `mainRoadPts`.
