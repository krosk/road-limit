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
  geo.test.js           40 unit tests total across the three lib files
  road.test.js
  motion.test.js
e2e/
  dashboard.spec.js     Playwright: mocks GPS + queryRenderedFeatures
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
- **segmentsAhead algorithm**: match current road first, walk it forward,
  then branch only at features whose nodes touch the walked path (≤25m).

## Configuration

All tunable constants are in `CFG` at the top of `index.html`:

| Key | Default | Meaning |
|-----|---------|---------|
| `lateralGLimit` | 0.30 g | harsh cornering threshold |
| `longGLimit` | 0.40 g | harsh braking/acceleration threshold |
| `aThreshold` | 0.30 × 9.81 m/s² | lateral acceleration for turn speed formula |
| `lookahead` | 500 m | how far ahead to scan for turns/junctions |
| `turnAngleMin` | 15° | minimum heading change to count as a turn |
| `urgentDist` | 200 m | turn warning becomes urgent below this distance |
| `roadMatchMaxDist` | 30 m | max distance to count as "on a road" |

`aThreshold` should be tuned once the insurer's exact threshold is known.

## Test hooks (for Playwright)

`index.html` exposes `window.__setMockFeatures(features)` and reads
`window.__mockFeatures` on startup, so Playwright can inject fake road
geometry without a live MapLibre instance.

## Known limitations

- OSM speed limits are sparse on minor roads; badges show cornering speed
  estimate (from geometry) when `maxspeed` tag is absent.
- GPS heading unreliable below ~5 km/h; last known heading is frozen.
- `queryRenderedFeatures` returns clipped geometries at tile boundaries;
  a road crossing a tile edge may appear as two separate features.
- Turn speed formula assumes flat road; no grade correction.
- Insurer threshold (0.3g default) is a guess until confirmed.
