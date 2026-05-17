# ADR 002 — Tile source: OpenFreeMap

## Status
Accepted

## Context

MapLibre GL requires a vector tile source and a style URL. Options:

| Source | Cost | API key | Coverage |
|--------|------|---------|----------|
| OpenFreeMap | Free, unlimited | None | Global OSM |
| MapTiler | Free tier (100k tiles/mo) | Required | Global OSM |
| Stadia Maps | Free tier (limited) | Required | Global OSM |
| Self-hosted (Protomaps) | Hosting cost | None | Global OSM |

The app is deployed on GitHub Pages with no backend. Embedding an API key
in client-side JS of a public repo exposes it to anyone.

## Decision

Use OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`).

Free, no API key, OSM data, actively maintained. Style is based on
OpenMapTiles schema; transportation features are in `source-layer: transportation`.

## Consequences

- No credentials to manage or rotate.
- OpenFreeMap is a community service with no SLA; if it goes down, the map
  won't load. Acceptable for an experimental personal tool.
- If the project grows, switching to a self-hosted tile server or a paid
  provider requires changing only the style URL in `initMap()`.
