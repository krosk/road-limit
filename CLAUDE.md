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

Tests must pass before every push. The unit tests run in well under 1s.

## Structure

```
index.html              entry point — browser API wiring only, no logic
lib/
  config.js             DEFAULT_CFG constants (imported by index.html)
  geo.js                pure geo math (haversine, bearing, circumradius,
                          ptAtDistance, bearingAtDistance, destPoint, …)
  road.js               road matching, lookahead, turn detection,
                          normaliseFeatures, corneringSpeed, …
  motion.js             accelerometer calibration (Option C rotation matrix)
  state.js              pure state update functions (applyGPS, smoothCompass,
                          applyMotion, createState)
  display.js            pure display computation (computeCornerBadge,
                          segmentLineColor, segmentsGeoJSON, statusText,
                          barState, badgeItems, debugTripletFeatures)
test/
  geo.test.js           unit tests for lib/geo.js
  road.test.js          unit tests for lib/road.js
  motion.test.js        unit tests for lib/motion.js
  state.test.js         unit tests for lib/state.js
  display.test.js       unit tests for lib/display.js
                        123 unit tests total across all lib files
e2e/
  dashboard.spec.js     Playwright: mocks GPS + road features
  fixtures/             JSON road-feature fixtures for replay testing
docs/adr/               architecture decision records
mindmap.html            interactive function map (open in browser)
```

## Module architecture

All logic lives in `lib/`. `index.html` contains only:
- Browser API wiring (MapLibre, Geolocation, Device Sensors)
- DOM reads/writes
- Event handlers that call lib functions and apply results to the DOM

This means every decision — what the corner badge shows, what colour a
segment gets, what the status line says, how GPS updates state — is a pure
function in a lib module, unit-testable without a browser.

### lib boundaries

| Module | Depends on | Responsibility |
|--------|-----------|----------------|
| `geo.js` | nothing | distance, bearing, geometry math |
| `road.js` | `geo.js` | road matching, BFS, turn detection, tile normalisation |
| `motion.js` | nothing | accelerometer frame transforms, EMA |
| `config.js` | nothing | default CFG values |
| `state.js` | `geo.js`, `motion.js` | pure state update functions |
| `display.js` | `road.js`, `geo.js` | compute what to display from state |

### index.html inline functions (browser-coupled, not unit-tested)

| Function | What it does |
|----------|-------------|
| `getRoadFeatures` | calls `queryRenderedFeatures`, pipes through `normaliseFeatures` |
| `updateCarPosition` | moves MapLibre marker, calls `map.easeTo` |
| `updateBadges` | creates/removes MapLibre `Marker` elements using `badgeItems` |
| `updateSegmentOverlay` | calls `map.getSource().setData()` using `segmentsGeoJSON` |
| `updateDebugTriplets` | calls `map.getSource().setData()` using `debugTripletFeatures` |
| `renderDashboard` | orchestrates all of the above |
| `renderGMeters` | updates G-bar DOM using `barState` |
| `initMap` | MapLibre setup, sources, layers, drag handler |
| `initGPS` | `navigator.geolocation.watchPosition` |
| `initMotion` | `devicemotion` / `deviceorientation` / `deviceorientationabsolute` |
| `onPos` | GPS callback — calls `applyGPS`, then `renderDashboard` |
| `applyManualPos` | reads SET-mode inputs, mutates state |
| `setPosInputs` | writes position to DOM inputs |
| `setStatus` | writes status line to DOM |
| `setBar` | updates G-bar DOM using `barState` |

## External API dependencies

| Dependency | Used for | Called in |
|-----------|---------|-----------|
| **MapLibre GL JS** (CDN `<script>`) | map rendering, tile fetch, feature query, markers, overlay sources | `initMap`, `getRoadFeatures`, `updateCarPosition`, `updateBadges`, `updateSegmentOverlay`, `updateDebugTriplets` |
| **OpenFreeMap CDN** | vector tile style (`liberty`) | `initMap` |
| **Geolocation API** | GPS position | `initGPS` → `onPos` |
| **Device Sensors API** | accelerometer (`devicemotion`), orientation (`deviceorientation`), absolute compass (`deviceorientationabsolute`) | `initMotion` |
| **Fetch API** | `HEAD index.html` for deployed timestamp | startup |

### queryRenderedFeatures viewport constraint

`queryRenderedFeatures` only returns features currently drawn in the
WebGL canvas. Consequences:
- Road data is viewport-bound: features outside the visible area are not
  returned even if their tiles are loaded.
- At zoom 16 / pitch 60° the viewport extends well past the 120 m
  lookahead, so in practice the constraint is not hit.
- Tiles load asynchronously after a position change; `getRoadFeatures`
  returns `[]` until the `idle` event fires.
- There is no server-side or headless equivalent; a browser with a
  rendered MapLibre canvas is required to call `queryRenderedFeatures`.

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
- **normaliseFeatures**: `queryRenderedFeatures` returns `MultiLineString`
  for roads that cross tile boundaries. `normaliseFeatures` in `lib/road.js`
  expands these into individual `LineString` features before any lib code
  sees them. This is a pure function and is unit-tested independently.

## Configuration

All tunable constants are defined in `lib/config.js` as `DEFAULT_CFG` and
spread into a mutable local `CFG` at the top of `index.html`:

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
  - Dist m (road match threshold) + lookahead distance + DBG toggle + CPY button
  - Status line + deployed timestamp
- **Map overlays**: colored road segments ahead (green/orange/red by cornering
  speed vs current speed); plain-text speed badges at each curve node.

## Capturing real-world road fixtures

The **CPY** button in the bottom panel copies the current road topology to
the clipboard as JSON (`window.__lastFeatures` after normalisation).

Workflow for adding a fixture-based test for a real location:
1. Open the app, switch to **SET** mode, drag the map to the target location.
2. Wait for the status line to show a road count (tiles loaded).
3. Press **CPY** — button flashes ✓ on success.
4. Paste the JSON into `e2e/fixtures/<name>.json`.
5. Write a test in `e2e/dashboard.spec.js` using `loadFixture('<name>')`.
6. Provide the fixture JSON and expected behaviour to an agent to generate
   the test, or write it directly using the existing fixture tests as a model.

The fixture JSON is an array of GeoJSON `LineString` features in the same
shape returned by `normaliseFeatures`. It plugs directly into `segmentsAhead`
for unit tests, or into `mockFeatures` for e2e tests.

**CPY feedback:**
- **✓** — copied successfully
- **—** — no features loaded yet
- **✗** — clipboard API refused (requires HTTPS or localhost)

## Test hooks (for Playwright and manual debugging)

`index.html` exposes:
- `window.__setMockFeatures(features)` / `window.__mockFeatures` — inject
  fake GeoJSON LineString features, bypassing `queryRenderedFeatures`.
- `window.__lastFeatures` — always holds the last result from
  `queryRenderedFeatures` (after normalisation). Also accessible via the
  **CPY** button.

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
  individual LineStrings by `normaliseFeatures` in `lib/road.js`.
- `queryRenderedFeatures` returns 0 features while tiles are still loading
  (e.g. immediately after a drag in SET mode). The `idle` event triggers a
  re-render once tiles settle.
- `queryRenderedFeatures` is viewport-bound: no headless or server-side
  equivalent exists. Fixture capture requires a browser session.
- Overlays do not update during map drag (only on `idle`) to avoid flicker
  from sparse `queryRenderedFeatures` results mid-pan.
- The first collected node of each BFS segment (`pts[0]`) is excluded from
  turn detection; no badge appears there even if the geometry is curved.
  In DBG mode a cyan ▶ marker identifies this node.
- Turn speed formula assumes flat road; no grade correction.
- Insurer threshold (0.3g default) is a guess until confirmed.
