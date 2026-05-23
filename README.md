# Road Limit

A live driving dashboard that warns you about upcoming turns and compares your speed against road speed limits from OpenStreetMap. The primary purpose is to cross-check whether your driving would trigger penalties under insurer telematics scoring — lateral G-force, hard braking, and cornering speed.

The app runs entirely in the browser with no backend: road geometry comes from vector tiles cached locally by MapLibre, GPS from the Geolocation API, and G-force from the device accelerometer.

---

## Using the app

Open the deployed URL in a mobile browser, allow location and motion sensor access, and start driving. The dashboard updates in real time.

**Speed card (top-left):** current GPS speed.

**Turn card (expands right from speed card):** appears when a single driveable road is ahead and a curve is within lookahead. Shows an SVG trace of the road shape, the safe cornering speed for the tightest arc ahead, the distance to it, and an ETA in seconds. The speed turns red when you are over the limit. Hidden at junctions — the algorithm only warns when it is confident which road you are on.

**G-force bars (bottom panel):** lateral and longitudinal acceleration relative to the insurer threshold (default 0.5 g).

**SET mode:** switch from GPS to manual positioning. Drag the map to set location and infer heading. Useful for testing specific road geometries without driving.

**CPY button:** downloads a `roads.json` snapshot of the current road topology and diagnostic metadata. Use it to capture a real-world scenario and turn it into a regression test.

---

## Development

No build step. Edit files and reload.

```bash
npm run test:unit   # pure function tests (~0.5 s)
npm run test:e2e    # Playwright UI tests with mocked GPS and road data
npm test            # both
```

Tests must pass before every push. Pushing to `main` deploys automatically via GitHub Pages.

All logic lives in `lib/`. `index.html` contains only browser API wiring. See `CLAUDE.md` for the full module map, architecture constraints, and agent-facing contracts.

To diagnose a captured fixture — segments, coordinates, lengths, distances from car, and overlay colours:

```bash
node scripts/analyse-fixture.js e2e/fixtures/roads_57.json
```

---

## Key concepts

**Lookahead (default 500 m):** how far ahead BFS explores the road graph to find turns.

**Turn card suppression:** at a junction with more than one genuinely distinct driveable direction, no turn card is shown. A false alarm is worse than silence.

**Cornering speed formula:** `v = sqrt(aThreshold × r)` where `r` is the circumradius of three consecutive OSM nodes and `aThreshold` defaults to 0.5 g (4.905 m/s²).

**Fixture workflow:** capture a scenario with CPY, save to `e2e/fixtures/`, write a test in `e2e/dashboard.spec.js` or `test/road.test.js`. Every real-world bug fix must include a fixture-based regression test.

---

## Architecture decisions

`docs/adr/` contains the rationale for non-obvious design choices: the BFS road-matching algorithm, junction suppression, the turn card layout, accelerometer calibration, and more.
