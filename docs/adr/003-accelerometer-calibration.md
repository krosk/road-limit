# ADR 003 — Accelerometer calibration: continuous orientation transform

## Status
Accepted

## Context

The phone's accelerometer axes (X, Y, Z) don't automatically align with
the car's axes (forward, lateral, up). The mapping depends on how the phone
is mounted. Three options were considered:

**Option A — Manual preset**: user picks portrait/landscape/etc. from a
menu. Simple but fragile; easy to misconfigure, breaks if mount changes.

**Option B — Gravity-based auto-detect at startup**: sample accelerometer
at rest, identify the vertical axis from the ~1g component. Distinguishing
lateral from longitudinal still requires a separate manoeuvre or user input.
One-time calibration goes stale if the phone shifts.

**Option C — Continuous transform using DeviceOrientation + GPS heading**:
`deviceorientation` provides β (pitch) and γ (roll) continuously.
GPS provides heading continuously. On every sample:
1. Remove gravity using β and γ.
2. Rotate device frame → world frame (east/north/up) using β and γ.
3. Rotate world frame → car frame (forward/lateral) using GPS heading.

Self-corrects if the phone shifts in its mount. No calibration step.
Only fails if `deviceorientation` stops firing (rare, permissions issue on iOS).

## Decision

Implement Option C. See `lib/motion.js`.

### Key equations

Gravity in device frame (what `accelerationIncludingGravity` reads at rest):
```
gx =  G · sin(γ)
gy = -G · cos(γ) · sin(β)
gz =  G · cos(γ) · cos(β)
```
Verification: β=0, γ=0 (flat) → gz=+9.81 ✓; β=90, γ=0 (upright portrait) → gy=-9.81 ✓

Device → world rotation matrix (R_y(-γ) · R_x(-β)):
```
east  =  cos(γ)·ax − sin(γ)·sin(β)·ay + sin(γ)·cos(β)·az
north =              cos(β)·ay          +         sin(β)·az
up    = −sin(γ)·ax − cos(γ)·sin(β)·ay + cos(γ)·cos(β)·az
```

World → car frame (h = GPS heading in radians):
```
forward = east·sin(h) + north·cos(h)
lateral = east·cos(h) − north·sin(h)
```

### GPS heading freeze

GPS heading is unreliable below ~5 km/h (phone doesn't know which way the
car points when nearly stopped). The last known good heading is frozen and
reused until speed rises again.

## Consequences

- Works for any phone mounting orientation without user input.
- Requires both `devicemotion` and `deviceorientation` permissions (iOS 13+
  needs a user gesture, handled by the start screen button).
- If `deviceorientation` is unavailable, β and γ default to 0 — equivalent
  to assuming a flat phone, which degrades gracefully.
- All math is verified by unit tests in `test/motion.test.js`.
