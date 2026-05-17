# Road Limit — Agent Context

Live driving dashboard for cross-checking insurer telematics penalties.
Tracks speed, G-force, and upcoming turn constraints, and compares them
against road speed limits from OpenStreetMap.

## Commands

```bash
npm run test:unit       # node:test — pure function tests, no browser needed
npm run test:e2e        # Playwright — UI tests with mocked GPS and road data
npm test                # both
```

Tests must pass before every push. The unit tests run in under 1s.

## Structure

```
index.html              entry point, thin glue between browser APIs and lib/
lib/
  geo.js                pure geo math (haversine, bearing, circumradius, …)
  road.js               road matching, lookahead, turn detection, badge logic
  motion.js             accelerometer calibration (Option C rotation matrix)
test/
  geo.test.js           45 unit tests total across the three lib files
  road.test.js
  motion.test.js
e2e/
  dashboard.spec.js     Playwright: mocks GPS + queryRenderedFeatures
  fixtures/             JSON road-feature fixtures for replay testing
docs/adr/               architecture decision records
```

## Key design decisions (see docs/adr/ for full rationale)

- **Road geometry**: MapLibre GL `queryRenderedFeatures` on loaded tiles —
  no external API calls while driving, tiles cache locally.
- **Tile source**: OpenFreeMap (free, no API key, OSM data).
- **Accelerometer calibration**: Option C — continuous transform using
  `deviceorientation` (β/γ) + GPS heading. No manual calibration step,
  self-corrects if phone shifts.
- **Junction handling**: badges on all branches ahead; bottom alert only
  fires on single-road stretches with no junction within lookahead.
- **segmentsAhead algorithm**: BFS over the connected road graph up to
  `CFG.lookahead` metres. Starts from the matched road, explores both
  directions at every junction node, tracks cumulative distance budget.
  Also walks `CFG.lookahead` metres behind the car for overlay context.

## Configuration

All tunable constants are in `CFG` at the top of `index.html`:

| Key | Default | Meaning |
|-----|---------|---------|
| `lateralGLimit` | 0.30 g | harsh cornering threshold |
| `longGLimit` | 0.40 g | harsh braking/acceleration threshold |
| `aThreshold` | 0.30 × 9.81 m/s² | lateral acceleration for turn speed formula |
| `lookahead` | 500 m | scan distance ahead and behind the car |
| `urgentDist` | 200 m | turn warning becomes urgent below this distance |
| `roadMatchMaxDist` | 100 m | max distance from car to nearest road to start BFS |

`aThreshold` should be tuned once the insurer's exact threshold is known.

## Test hooks (for Playwright and manual debugging)

`index.html` exposes:
- `window.__setMockFeatures(features)` / `window.__mockFeatures` — inject
  fake GeoJSON LineString features, bypassing `queryRenderedFeatures`.
- `window.__lastFeatures` — always holds the last result from
  `queryRenderedFeatures` (after MultiLineString normalisation). Copy from
  DevTools console to build test fixtures for a specific location.

## Manual position mode

The bottom panel has a GPS/SET toggle. In **SET** mode:
- The three inputs (Lon, Lat, Hdg°) become editable.
- Dragging the map updates the position live.
- Pressing **Apply** jumps the car dot and redraws the overlay.
- GPS updates are ignored until toggled back to **GPS**.

In **GPS** mode the fields are read-only and show the live GPS position.

## Known limitations

- OSM speed limits are sparse on minor roads; badges show cornering speed
  estimate (from geometry) when `maxspeed` tag is absent.
- GPS heading unreliable below ~5 km/h; last known heading is frozen.
- `queryRenderedFeatures` returns clipped geometries at tile boundaries;
  roads crossing a tile edge arrive as MultiLineString — normalised to
  individual LineStrings in `getRoadFeatures` before any lib code sees them.
- Turn speed formula assumes flat road; no grade correction.
- Insurer threshold (0.3g default) is a guess until confirmed.
- `queryRenderedFeatures` returns 0 features while tiles are still loading
  (e.g. immediately after a drag in SET mode). The `idle` event triggers a
  re-render once tiles settle.
