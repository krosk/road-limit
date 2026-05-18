# Road Limit — Agent Context

Live driving dashboard for cross-checking insurer telematics penalties.
Tracks speed, G-force, and upcoming turn constraints, and compares them
against road speed limits from OpenStreetMap.

## Deployment

The app is a static site with no build step. Pushing to `main` on GitHub
automatically publishes it via GitHub Pages.

## Git workflow

Commit and push directly to `main` — no feature branches. All commits in
the repository history follow this convention.

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
  display.js            pure display computation (computeTurnCard,
                          segmentLineColor, segmentsGeoJSON, statusText,
                          barState, badgeItems, debugTripletFeatures)
test/
  geo.test.js           unit tests for lib/geo.js
  road.test.js          unit tests for lib/road.js
  motion.test.js        unit tests for lib/motion.js
  state.test.js         unit tests for lib/state.js
  display.test.js       unit tests for lib/display.js
                        133 unit tests total across all lib files
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
| `setStatus` | writes status line to DOM (no-op while `statusPinnedUntil` is in the future) |
| `pinStatus` | writes status line and blocks `setStatus` for N ms (prevents GPS render loop from overwriting transient messages) |
| `setBar` | updates G-bar DOM using `barState` |

## External API dependencies

| Dependency | Used for | Called in |
|-----------|---------|-----------|
| **MapLibre GL JS** (CDN `<script>`) | map rendering, tile fetch, feature query, markers, overlay sources | `initMap`, `getRoadFeatures`, `updateCarPosition`, `updateBadges`, `updateSegmentOverlay`, `updateDebugTriplets` |
| **OpenFreeMap CDN** | vector tile style (`liberty`) | `initMap` |
| **Geolocation API** | GPS position | `initGPS` → `onPos` |
| **Device Sensors API** | accelerometer (`devicemotion`), orientation (`deviceorientation`), absolute compass (`deviceorientationabsolute`) | `initMotion` |
| **Fetch API** | `HEAD index.html` for deployed timestamp; GitHub API (`/repos/krosk/road-limit/commits/main`) for commit SHA | startup |

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
- **Turn summary card**: replaces the old corner badge. `firstTurnAhead` in
  `lib/road.js` runs `segmentsAhead` with the standard lookahead, returns null
  for junctions (multiple forward segments) or no turn within lookahead.
  `computeTurnCard` in `lib/display.js` formats it for display. Card shows
  direction arrow (← / →), min cornering speed circle, distance and ETA to arc
  start. Junction suppression: if BFS finds >1 forward segment, no card shown.
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
  for roads that cross tile boundaries, and also returns the same physical
  road multiple times (once per tile layer). `normaliseFeatures` in
  `lib/road.js` (1) expands MultiLineString into individual LineStrings,
  (2) deduplicates by `${first_coord};${last_coord}` key, and (3) strips
  MapLibre internal fields (`_vectorTileFeature` etc.) to keep fixtures
  small (~60× size reduction). Pure function, unit-tested independently.
- **Junction suppression in `firstTurnAhead`**: after BFS, forward segments
  are grouped by initial bearing (30° tolerance). Groups within 30° of each
  other are the same physical road split across OSM features (tile edges,
  layer duplicates). Only `dirGroups.length !== 1` — genuinely distinct
  directions — suppresses the turn card. This prevents spurious "junction"
  detection on straight roads where `queryRenderedFeatures` returns two
  overlapping features for the same road.

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
- **Top-right overlay**: turn summary card — direction arrow (← / →), min
  cornering speed circle, distance and ETA to arc start. Red when over limit.
  Hidden when no turn within lookahead or when approaching a junction.
- **Bottom panel** (collapsible via `⌄` chevron):
  - G-force bars (lateral / longitudinal) — always visible
  - Threshold slider (lateral G limit)
  - GPS/SET toggle + position inputs (Lon, Lat, Hdg°) + Apply
  - Dist m (road match threshold) + lookahead distance + DBG toggle + CPY button
  - Status line + deployed timestamp
- **Map overlays**: colored road segments ahead (green/orange/red by cornering
  speed vs current speed); plain-text speed badges at each curve node.

## Capturing real-world road fixtures

The **CPY** button downloads a `roads.json` file containing both diagnostic
metadata and the current road topology.

### CPY download format

```json
{
  "meta": {
    "commit": "abc1234",
    "timestamp": "2026-05-18T10:00:00.000Z",
    "position": { "lon": 2.348, "lat": 48.853, "heading": 90, "accuracy": 5 },
    "speed": 50,
    "map": { "zoom": 16, "pitch": 60, "bearing": 90 },
    "cfg": { "lookahead": 120, "roadMatchMaxDist": 30, "aThreshold": 2.943 },
    "match": { "dist": 8, "road": "Rue de Rivoli", "class": "primary" },
    "segments": { "forward": 1, "behind": 0 },
    "turnReason": null,
    "turnCard": { ... }
  },
  "features": [ /* GeoJSON LineString features as returned by normaliseFeatures */ ]
}
```

`loadFixture` in `dashboard.spec.js` and `mockFeatures` both accept either
format: a bare array of features, or `{ meta, features }`.

Workflow for adding a fixture-based test for a real location:
1. Open the app, switch to **SET** mode, drag the map to the target location.
2. Wait for the status line to show a road count (tiles loaded).
3. Press **CPY** — browser downloads `roads.json`.
4. Rename and move to `e2e/fixtures/<name>.json`.
5. Write a test in `e2e/dashboard.spec.js` using `loadFixture('<name>')`.
6. Provide the fixture JSON and expected behaviour to an agent to generate
   the test, or write it directly using the existing fixture tests as a model.

The `features` array plugs directly into `segmentsAhead` for unit tests, or
into `mockFeatures` for e2e tests.

**CPY feedback:**
- **✓** — downloaded successfully
- **—** — no features loaded yet

### LDR — load a fixture at runtime

The **LDR** button next to CPY opens a file picker. Loading a `roads.json`
file (CPY format) restores the full app state for before/after comparison:
- Injects features via `window.__mockFeatures` (bypasses `queryRenderedFeatures`)
- Switches to SET mode and applies `meta.position` (lon, lat, heading)
- Restores `meta.map` (zoom, pitch, bearing) via `map.jumpTo`
- Restores `meta.cfg` (lookahead, roadMatchMaxDist) including UI inputs
- Calls `renderDashboard()` immediately
- Shows `Loaded N features @ <commit>` in the status line for 4 s

**LDR feedback:**
- **✓** — loaded successfully (status line shows feature count + commit)
- **✗** — file parse error (status line shows error message for 5 s)

The file input is always reset after load, so the same file can be reloaded
repeatedly (useful for before/after comparison after a code change).

## Test hooks (for Playwright and manual debugging)

`index.html` exposes:
- `window.__setMockFeatures(features)` / `window.__mockFeatures` — inject
  fake GeoJSON LineString features, bypassing `queryRenderedFeatures`.
- `window.__lastFeatures` — always holds the last result from
  `queryRenderedFeatures` (after normalisation). Downloaded by the **CPY**
  button.
- `window.__lastDiag` — snapshot of diagnostic state written at the end of
  every `renderDashboard()` call. Shape matches the `meta` field in the CPY
  download. Useful in DevTools to understand why a turn card is/isn't shown:
  check `__lastDiag.turnReason`, `__lastDiag.segments`, `__lastDiag.match`.

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
  `queryRenderedFeatures` also returns the same road multiple times (once
  per tile layer); `normaliseFeatures` deduplicates by first+last coordinate.
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
