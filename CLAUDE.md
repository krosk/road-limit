# Road Limit — Agent Context

Live driving dashboard for cross-checking insurer telematics penalties.
Tracks speed, G-force, and upcoming turn constraints against OSM road data.

## Git workflow

Commit and push directly to `main` — no feature branches. Pushing to `main` deploys automatically via GitHub Pages.

## Commands

```bash
npm run test:unit       # node:test — pure function tests, no browser needed
npm run test:e2e        # Playwright — UI tests with mocked GPS and road data
npm test                # both
```

Tests must pass before every push. The unit tests run in well under 1s.

Every fix that follows a fixture-based bug report must include a regression test in `test/road.test.js` that would have caught the bug before the fix.

## Structure

```
index.html              entry point — browser API wiring only, no logic
lib/
  config.js             DEFAULT_CFG constants (imported by index.html)
  geo.js                pure geo math (haversine, bearing, circumradius,
                          ptAtDistance, bearingAtDistance, destPoint, …)
  road.js               road matching, BFS, turn detection,
                          normaliseFeatures, corneringSpeed, …
  motion.js             accelerometer calibration (Option C rotation matrix)
  state.js              pure state update functions (applyGPS, smoothCompass,
                          applyMotion, createState)
  display.js            pure display computation (computeTurnCard,
                          segmentLineColor, segmentsGeoJSON, statusText,
                          barState, badgeItems, debugTripletFeatures,
                          turnPathSVG, junctionBranchGeoJSON)
test/
  geo.test.js           unit tests for lib/geo.js
  road.test.js          unit tests for lib/road.js
  motion.test.js        unit tests for lib/motion.js
  state.test.js         unit tests for lib/state.js
  display.test.js       unit tests for lib/display.js
e2e/
  dashboard.spec.js     Playwright: mocks GPS + road features
  fixtures/             JSON road-feature fixtures for replay testing
scripts/
  analyse-fixture.js    CLI: analyse a roads.json fixture — segments, coords,
                          lengths, dist from car, overlay colours
docs/adr/               architecture decision records
mindmap.html            interactive function map (open in browser)
```

## Module boundaries

All logic lives in `lib/`. `index.html` contains only browser API wiring, DOM reads/writes, and event handlers that call lib functions.

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
| `getRoadFeatures` | always calls `queryRenderedFeatures` to update raw diagnostic globals; returns mock features when set (Playwright only), otherwise returns `normaliseFeatures(raw)` |
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
| `pinStatus` | writes status line and blocks `setStatus` for N ms |
| `setBar` | updates G-bar DOM using `barState` |

## External API dependencies

| Dependency | Used for | Called in |
|-----------|---------|-----------|
| **MapLibre GL JS** (CDN `<script>`) | map rendering, tile fetch, feature query, markers, overlay sources | `initMap`, `getRoadFeatures`, `updateCarPosition`, `updateBadges`, `updateSegmentOverlay`, `updateDebugTriplets` |
| **OpenFreeMap CDN** | vector tile style (`liberty`) | `initMap` |
| **Geolocation API** | GPS position | `initGPS` → `onPos` |
| **Device Sensors API** | accelerometer (`devicemotion`), orientation (`deviceorientation`), absolute compass (`deviceorientationabsolute`) | `initMotion` |
| **Fetch API** | `HEAD index.html` for deployed timestamp; GitHub API for commit SHA | startup |

### queryRenderedFeatures constraints

- Returns only features drawn in the current WebGL viewport. Road data is viewport-bound.
- Returns `[]` while tiles are still loading. The `idle` event triggers a re-render once tiles settle.
- No server-side or headless equivalent. Fixture capture requires a live browser session.
- Overlays do not update during map drag (only on `idle`) to avoid flicker from sparse mid-pan results.

## Constraints

- `matchRoad` skips any feature with `oneway===1` when the car's heading is contra-flow (angleDiff > 90° from feature bearing). Violation causes BFS to start at the wrong endpoint and produce downstream segments that pass the heading filter. Regression: roads_54.
- Never prepend `snapPt` to `mainRoadPts`. `firstTurnAhead` may select a different branch; `mainRoadPts[0]` and `snapPt` would then belong to unrelated features and draw a false chord across the map. Regression: roads_55.
- `JUNCTION_THRESH` in `segmentsAhead` is 5 m. Do not raise it. At 25 m, parallel non-topological structures (bridge ramps, divided carriageways) were spuriously connected, creating false direction groups. Regressions: roads_43, roads_55.
- BFS queues `oneway===1` features in the forward (coordinate-order) direction only. The backward entry is skipped — it represents contra-flow travel and would otherwise create a spurious second direction group on divided highways.
- `firstTurnAhead` uses `refHeading` for the direction filter, not raw `heading`. When `heading` is null, `refHeading` falls back to the initial bearing of the matched segment.
- `firstTurnAhead` computes `minRadius` across all nodes within lookahead, not just the first contiguous arc. Later tighter arcs must be reflected in `minSpeed`.
- `matchedSegPts = [match.snapPt, match.coords[match.segIdx]]` is the independent blue overlay for the matched segment. Pass it to `junctionBranchGeoJSON` separately. Never merge it into `mainRoadPts`.
- `normaliseFeatures` expands `MultiLineString` to individual `LineString` features, deduplicates by `${first_coord};${last_coord}` key, and strips MapLibre internal fields. Apply to all `queryRenderedFeatures` output before any lib function sees it.
- `lateralGLimit` and `aThreshold` are kept in sync at the same g value. Change both together.
- The first node of each BFS segment (`pts[0]`) is an endpoint and never receives a turn badge. `detectAllTurns` and `firstTurnAhead` both skip index 0.

## Configuration

All tunable constants are defined in `lib/config.js` as `DEFAULT_CFG` and spread into a mutable local `CFG` at the top of `index.html`:

| Key | Default | Meaning |
|-----|---------|---------|
| `lateralGLimit` | 0.50 g | harsh cornering threshold |
| `longGLimit` | 0.40 g | harsh braking/acceleration threshold |
| `aThreshold` | 0.50 × 9.81 m/s² | lateral acceleration for turn speed formula |
| `lookahead` | 500 m | road scan distance ahead of the car |
| `roadMatchMaxDist` | 30 m | max distance from car to nearest road to start BFS |

`roadMatchMaxDist` and `lookahead` are also exposed as number inputs in the bottom panel for live tuning without reloading.

## UI layout

Two responsive layouts driven by `@media (max-aspect-ratio: 1/1)` (portrait) and `@media (min-aspect-ratio: 1/1)` (landscape).

**Portrait:** `#left-panel` is `position: absolute; inset: 0`. `#card-row` (flex row) contains `#speed-overlay` and `#turn-col` at top-left. `#bottom-panel` is `position: absolute; bottom: 0`.

**Landscape:** `body` is a flex row. `#left-panel` is a 220 px flex column (speed top, controls middle, turn card bottom). `#map` takes the remaining width. A `ResizeObserver` on `#map` calls `map.resize()` on container changes.

**Turn card toggle:** `#turn-col` is `display: none` by default. JS sets `display: flex` when a card is active and adds `.turn-active` to `#left-panel` (removes bottom-right border-radius from `#speed-overlay`).

## Capturing real-world road fixtures

The **CPY** button downloads a `roads.json` file containing diagnostic metadata and the current road topology.

### CPY download format

```json
{
  "meta": {
    "commit": "abc1234",
    "timestamp": "2026-05-18T10:00:00.000Z",
    "position": { "lon": 2.348, "lat": 48.853, "heading": 90, "accuracy": 5 },
    "speed": 50,
    "map": { "zoom": 16, "pitch": 60, "bearing": 90 },
    "cfg": { "lookahead": 500, "roadMatchMaxDist": 30, "aThreshold": 4.905 },
    "match": { "dist": 8, "road": "Rue de Rivoli", "class": "primary" },
    "segments": { "forward": 1, "behind": 0 },
    "forwardClasses": [6, 3],     // pts.length of each forward BFS segment (NOT road class)
    "turnReason": null,           // "no match" | "junction" | "straight" | null
    "turnCard": { ... },
    "rawCount": 42,               // raw queryRenderedFeatures count (before normalisation)
    "layersQueried": 18,          // number of road layer IDs passed to queryRenderedFeatures
    "rawMinDist": 5,              // metres from car to nearest raw feature coordinate
    "rawLayerSummary": { "road_primary": 5, "road_primary_casing": 5, "road_secondary": 120 }
                                  // per-layer minimum distance to car (metres)
  },
  "features": [ /* GeoJSON LineString features from normaliseFeatures,
                   each annotated with _distToCar (metres) */ ]
}
```

Key diagnostic fields: `rawCount` (features before deduplication), `rawMinDist` (distance to nearest raw coordinate — large value means off-road or tile gap).

`loadFixture` in `dashboard.spec.js` accepts either a bare feature array or `{ meta, features }`. The `features` array also plugs directly into `segmentsAhead` for unit tests.

Workflow for adding a fixture-based regression test:
1. Switch to **SET** mode, drag the map to the target location.
2. Wait for the status line to show a road count (tiles loaded).
3. Press **CPY** — browser downloads `roads.json`.
4. Rename and move to `e2e/fixtures/<name>.json`.
5. Write a test in `test/road.test.js` (unit) or `e2e/dashboard.spec.js` (e2e).

**CPY feedback:** ✓ downloaded / — no features loaded yet.

### LDR — load a fixture at runtime

The **LDR** button opens a file picker. Loading a `roads.json` file restores map state for before/after comparison:
- Switches to SET mode and applies `meta.position` (lon, lat, heading)
- Restores `meta.map` (zoom, pitch, bearing) via `map.jumpTo`
- Restores `meta.cfg` (lookahead, roadMatchMaxDist) including UI inputs
- Road features come from live map tiles (`idle` event), not from the file

`window.__setMockFeatures` is reserved for Playwright only. LDR does not use it.

**LDR feedback:** ✓ loaded / ✗ parse error (status line shows message for 5 s).

## Test hooks

`index.html` exposes:
- `window.__setMockFeatures(features)` / `window.__mockFeatures` — inject GeoJSON features for Playwright. `getRoadFeatures()` returns these; `queryRenderedFeatures` still runs to update diagnostics.
- `window.__lastFeatures` — last normalised feature array from `queryRenderedFeatures`.
- `window.__lastRawCount` / `window.__lastLayersQueried` / `window.__lastRawMinDist` / `window.__lastRawLayerSummary` — raw diagnostic globals, updated on every `getRoadFeatures()` call.
- `window.__lastDiag` — full diagnostic snapshot after every `renderDashboard()`. Key fields:
  - `turnReason` — `"no match"` / `"junction"` / `"straight"` / `null` (card shown)
  - `segments.forward` — number of forward BFS segments
  - `forwardClasses` — `pts.length` of each forward segment
  - `match.dist` — metres to nearest road; if > `roadMatchMaxDist`, no BFS
  - `rawMinDist` — metres to nearest raw tile coordinate

## Debug mode (DBG)

Toggle in the bottom panel. When active:
- Each evaluated triplet is drawn as a dashed polyline: **yellow** = tight (badge generated), **gray** = loose.
- Speed badges are shifted 40 m to the right; a colored line connects node to badge (green = under limit, red = over).
- A **cyan ▶ square** marks `pts[0]` of each forward BFS segment.

## Manual position mode (SET)

Toggle in the bottom panel. In SET mode:
- Lon, Lat, Hdg° inputs are editable.
- Dragging the map updates position live and infers heading from drag direction (2 m threshold).
- **Apply** jumps the car dot and redraws the overlay.
- GPS updates are ignored until toggled back to GPS mode.

## Known limitations

- OSM speed limits are sparse on minor roads; badges show cornering speed from geometry when `maxspeed` tag is absent.
- GPS heading unreliable below ~5 km/h; `deviceorientationabsolute` takes over (2 Hz, circular EMA, +180° mount correction). The 180° offset is specific to the current phone mount.
- `deviceorientationabsolute` not available on iOS; `webkitCompassHeading` from `deviceorientation` is the equivalent but currently unused.
- `queryRenderedFeatures` returns clipped geometries at tile boundaries as `MultiLineString` — handled by `normaliseFeatures`.
- Turn speed formula assumes flat road; no grade correction.
- Insurer threshold (0.5 g default) is a working assumption until confirmed.
