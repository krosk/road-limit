# ADR 005 — Testing strategy: two layers

## Status
Accepted

## Context

The app has three layers of logic with different testing needs:

1. **Pure math** — geo calculations, rotation matrices, turn detection.
   No browser, no hardware. Fully deterministic.

2. **UI integration** — GPS updates the speed display, road features produce
   badges, motion events move the G-bars. Requires DOM and browser APIs,
   but those can be mocked.

3. **Real hardware** — actual GPS accuracy, sensor axes, map rendering feel.
   Cannot be automated.

## Decision

### Layer 1 — `node:test` unit tests (`test/`)

Pure functions in `lib/` are tested with Node's built-in test runner.
No dependencies, runs in ~100ms, CI-friendly.

Each lib file has a corresponding test file. Tests cover:
- Correct values for known inputs (haversine Paris→Lyon, bearing due north, etc.)
- Edge cases (collinear circumradius → Infinity, heading=null, mph conversion)
- Math invariants (EMA convergence, gravity removal at rest → zero)

### Layer 2 — Playwright e2e tests (`e2e/`)

Playwright loads the actual `index.html` in a Chromium browser (Pixel 5
device profile) and mocks the two external dependencies:

**GPS mock** — `page.addInitScript` overrides `navigator.geolocation.watchPosition`
to fire a synthetic position immediately.

**Road features mock** — `index.html` reads `window.__mockFeatures` on startup
and exposes `window.__setMockFeatures()`. Playwright injects fake GeoJSON
LineString features before page load, bypassing `queryRenderedFeatures` entirely.

This covers the glue code in `index.html` (event → state → DOM update) without
needing real tiles, real GPS, or real sensors.

### Layer 3 — Manual on-device testing

Axis correctness (does lateral bar move when cornering, not when braking?),
GPS accuracy display, map rotation feel, badge readability in sunlight.
Document findings when running for the first time; update `CFG.aThreshold`
once the insurer's exact threshold is known.

## Consequences

- All logic changes must keep 40/40 unit tests passing before commit.
- Playwright requires `npx serve` to be available (via npx, no install).
- The mock-features hook (`window.__mockFeatures`) is a minor test seam in
  production code. It is a null check — zero cost when not set.
