# Road Limit — Agent Context

Live driving dashboard for cross-checking insurer telematics penalties.
Tracks speed, G-force, and upcoming turn constraints, and compares them
against road speed limits from OpenStreetMap.

## Deployment

The app is a static site with no build step. Pushing to `main` on GitHub
automatically publishes it via GitHub Pages.

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
  geo.test.js           47 unit tests total across the three lib files
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
- **Junction handling**: badges on all branches ahead; single-road turn
  warning removed in favour of the persistent corner badge (top-right).
- **segmentsAhead algorithm**: BFS over the connected road graph up to
  `CFG.lookahead` metres ahead only (lookBehind = 0). Starts from the
  matched road, explores both directions at every junction node, tracks
  cumulative distance budget.
- **Turn detection (`detectAllTurns`)**: computes circumradius for every
  consecutive triplet of points. Uses a `nodeMinR` pass to propagate each
  triplet's radius to all three of its nodes, so a node flanked by two tight
  triplets is flagged even if its own triplet has a large radius. The first
  collected node (`pts[0]`) is always an endpoint and can never receive a badge.
- **Map heading**: above `CFG.minSpeedForHeading` (5 km/h) the map rotates
  to match GPS heading. Below that, `deviceorientationabsolute` alpha is
  smoothed with a circular EMA (α = 0.1), corrected by +180° for the current
  phone mount, and applied via `updateCarPosition` at 2 Hz — identical code
  path to a GPS heading update, so `S.heading` and `S.lastHeading` are both
  updated and the road overlay follows the compass.
- **SET mode drag heading**: dragging the map in SET mode computes bearing
  from consecutive center positions (2 m threshold) and sets `S.heading`
  automatically.

## Configuration

All tunable constants are in `CFG` at the top of `index.html`:

| Key | Default | Meaning |
|-----|---------|---------|
| `lateralGLimit` | 0.30 g | harsh cornering threshold |
| `longGLimit` | 0.40 g | harsh braking/acceleration threshold |
| `aThreshold` | 0.30 × 9.81 m/s² | lateral acceleration for turn speed formula |
| `lookahead` | 120 m | road scan distance ahead of the car |
| `roadMatchMaxDist` | 30 m | max distance from car to nearest road to start BFS |

`aThreshold` should be tuned once the insurer's exact threshold is known.

Both `roadMatchMaxDist` and `lookahead` are also exposed as number inputs in
the bottom panel for live tuning without reloading.

## UI layout

- **Top-left overlay**: speed (km/h), road name, map bearing + raw abs compass
  (`↑ X°  ·  Y°` where X = screen-top direction, Y = raw device compass).
- **Top-right overlay**: large corner badge — cornering speed limit of the
  nearest upcoming turn, with distance. Red background when over the limit.
- **Bottom panel** (collapsible via `⌄` chevron):
  - G-force bars (lateral / longitudinal) — always visible
  - Threshold slider (lateral G limit)
  - GPS/SET toggle + position inputs (Lon, Lat, Hdg°) + Apply
  - Dist m (road match threshold) + lookahead distance + DBG toggle
  - Status line + deployed timestamp
- **Map overlays**: colored road segments ahead (green/orange/red by cornering
  speed vs current speed); plain-text speed badges at each curve node.

## Test hooks (for Playwright and manual debugging)

`index.html` exposes:
- `window.__setMockFeatures(features)` / `window.__mockFeatures` — inject
  fake GeoJSON LineString features, bypassing `queryRenderedFeatures`.
- `window.__lastFeatures` — always holds the last result from
  `queryRenderedFeatures` (after MultiLineString normalisation). Copy from
  DevTools console to build test fixtures for a specific location.

## Debug mode (DBG)

The bottom panel has a **DBG** toggle. When active:
- Each evaluated triplet (pts[i-1], pts[i], pts[i+1]) is drawn as a dashed
  polyline: **yellow** = tight circumradius (badge generated), **gray** = loose.
- Speed badges are shifted 40 m to the right of the road; a colored line
  connects the original node to its badge (green = under limit, red = over).
- A **cyan ▶ square** marks `pts[0]` of each forward BFS segment — the start
  node that can never receive a badge.

## Manual position mode

The bottom panel has a GPS/SET toggle. In **SET** mode:
- The three inputs (Lon, Lat, Hdg°) become editable.
- Dragging the map updates the position live and infers heading from drag
  direction (bearing between consecutive center positions, 2 m threshold).
- Pressing **Apply** jumps the car dot and redraws the overlay.
- GPS updates are ignored until toggled back to **GPS**.

In **GPS** mode the fields are read-only and show the live GPS position.

## Known limitations

- OSM speed limits are sparse on minor roads; badges show cornering speed
  estimate (from geometry) when `maxspeed` tag is absent.
- GPS heading unreliable below ~5 km/h; `deviceorientationabsolute` takes
  over (2 Hz, circular EMA, +180° mount correction). The 180° offset is
  specific to the current phone mount — adjust if mount orientation changes.
- `deviceorientationabsolute` not available on iOS; `webkitCompassHeading`
  from `deviceorientation` would be the equivalent but is currently unused.
- `queryRenderedFeatures` returns clipped geometries at tile boundaries;
  roads crossing a tile edge arrive as MultiLineString — normalised to
  individual LineStrings in `getRoadFeatures` before any lib code sees them.
- `queryRenderedFeatures` returns 0 features while tiles are still loading
  (e.g. immediately after a drag in SET mode). The `idle` event triggers a
  re-render once tiles settle.
- Overlays do not update during map drag (only on `idle`) to avoid flicker
  from sparse `queryRenderedFeatures` results mid-pan.
- The first collected node of each BFS segment (`pts[0]`) is excluded from
  turn detection; no badge appears there even if the geometry is curved.
  In DBG mode a cyan ▶ marker identifies this node.
- Turn speed formula assumes flat road; no grade correction.
- Insurer threshold (0.3g default) is a guess until confirmed.
