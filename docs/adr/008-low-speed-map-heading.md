# ADR 008 — Low-speed map heading: deviceorientationabsolute with circular EMA

## Status
Accepted

## Context

GPS course-over-ground (`heading` from `GeolocationCoordinates`) is only meaningful
above ~5 km/h. Below that speed the GPS receiver has no directional signal; the
heading value stalls at the last reliable reading or oscillates. When stationary or
nearly stopped, the map would freeze at the last heading, giving the driver no
orientation when pulling away from a stop.

The device has a magnetometer accessible through two browser events:

- `deviceorientation` — fires continuously; `alpha` is the compass bearing but
  defined relative to an arbitrary reference frame that varies by browser and
  platform. Not suitable as an absolute compass reading.
- `deviceorientationabsolute` — fires the same event structure but with `alpha`
  referenced to true magnetic north. Available on Android Chrome; not available
  on iOS (where `webkitCompassHeading` from `deviceorientation` is the
  equivalent, but it is currently unused).

### First attempt: `deviceorientation` alpha

An initial implementation used `deviceorientation` and read `alpha` directly as the
compass bearing. This was reverted: `alpha` on `deviceorientation` is browser-defined
and unpredictable across devices, and on some configurations it drifted continuously
even when the phone was stationary.

## Decision

**Use `deviceorientationabsolute` alpha, smoothed with a circular EMA and corrected
for mount orientation, applied at ≤ 2 Hz when GPS speed is below
`CFG.minSpeedForHeading`.**

### Smoothing

Raw magnetometer readings are noisy. A standard EMA would wrap incorrectly near 0°/360°
(e.g. averaging 350° and 10° as 180° instead of 0°). `smoothCompass` in `lib/state.js`
uses a circular EMA: it computes the shortest angular difference between the new reading
and the current smoothed value, then applies a fixed coefficient of 0.1. The coefficient
is hardcoded (not part of `CFG.smoothAlpha`, which is for accelerometer smoothing).

### Mount correction

The phone is mounted with its screen facing the driver at 180° from the direction of
travel. `deviceorientationabsolute` alpha reflects the physical orientation of the
device, so the corrected heading is `(smoothAbsHeading + 180) % 360`. This offset is
specific to the current mount; it must be adjusted if the mount orientation changes.

### Throttle

The `deviceorientationabsolute` event fires at high frequency. Map rotation on every
event causes visual churn. A 500 ms gate (`_lastCompassApply`) limits updates to
≤ 2 Hz — matching the GPS heading update rate at low speed.

### Fallback chain

1. GPS speed ≥ `CFG.minSpeedForHeading` (5 km/h): GPS course-over-ground used directly.
2. GPS speed < threshold: `deviceorientationabsolute` alpha (smoothed, corrected).
3. `deviceorientationabsolute` unavailable (iOS): heading stays at last GPS value.

Both paths write to `S.heading` through the same code path in `index.html`, so
`firstTurnAhead` and `matchRoad` always see a consistent heading value.

## Consequences

- Map rotation is usable at standstill and during slow manoeuvres.
- The +180° mount correction is a hardcoded constant, not configurable. If the phone
  is remounted at a different angle, the constant must be updated in `index.html`.
- iOS drivers get no compass fallback; the map freezes at the last GPS heading below
  5 km/h. `webkitCompassHeading` (available on iOS via `deviceorientation`) is the
  fix but is not yet implemented.
- Circular EMA with α = 0.1 introduces ~1–2 s lag on rapid turns. Acceptable for a
  stationary or slow-moving context; at driving speed the GPS heading takes over.
