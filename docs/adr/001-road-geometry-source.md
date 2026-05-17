# ADR 001 — Road geometry source: MapLibre GL over Overpass API

## Status
Accepted

## Context

The app needs road geometry ahead of the car (node coordinates) to detect
upcoming turns and compute safe cornering speeds. Three options were evaluated:

**Overpass API** — query OpenStreetMap directly via HTTP on each GPS update.
Free, no key, full OSM data including `maxspeed` tags.
Rate-limited (slot-based fair use); at highway speeds (130 km/h) a 150m
re-query interval means one request every ~4 seconds — borderline aggressive
for a public API. Slow responses while approaching a turn are hazardous.

**Commercial APIs (HERE, TomTom)** — accurate speed limits for France/Spain,
free tiers (250k/month, 2500/day). API keys embedded in client-side JS are
visible in the public repo. Adds a dependency on a paid service.

**MapLibre GL + vector tiles** — road geometry is baked into tiles fetched
once and cached by the browser. `queryRenderedFeatures` returns road
coordinates with zero network latency. No rate limits. Tiles available
offline once an area has been visited.

## Decision

Use MapLibre GL as both the map display and the geometry source.
Tile source: OpenFreeMap (see ADR 002).

Road geometry is queried via:
```js
map.queryRenderedFeatures({ layers: roadLayers })
```
where `roadLayers` is derived from the loaded style at startup:
```js
map.getStyle().layers
  .filter(l => l['source-layer'] === 'transportation' && l.type === 'line')
  .map(l => l.id)
```

## Consequences

- No Overpass or other API calls while driving.
- Tiles cache locally; previously visited areas work with poor connectivity.
- Speed limit data (`maxspeed` tag) is present in OSM tiles where tagged;
  absent on many minor roads — handled by showing cornering-speed estimate
  instead (see ADR 004).
- `queryRenderedFeatures` returns only what is currently rendered on screen.
  The map must be zoomed and positioned to show the lookahead area (500m).
  At zoom 15 the viewport covers ~1–2 km, which is sufficient.
- Geometries are clipped at tile boundaries — a road crossing a tile edge
  appears as two separate features. The junction-detection algorithm
  (ADR 004) handles this via proximity matching rather than node ID lookup.
