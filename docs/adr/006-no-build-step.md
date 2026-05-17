# ADR 006 — No build step: plain ES modules

## Status
Accepted

## Context

The app is a personal tool deployed on GitHub Pages. Options:

**Bundler (Vite, esbuild, etc.)** — tree-shaking, minification, TypeScript
support. Requires a CI pipeline to build before deploy, `node_modules`,
and a `dist/` output directory. GitHub Pages would need to serve from `dist/`
or use a GitHub Actions workflow.

**Plain ES modules** — `<script type="module">`, `import` statements resolved
by the browser directly. No build step. GitHub Pages serves `index.html`
from the repo root. Works immediately after push.

## Decision

Plain ES modules. No bundler, no `node_modules` at runtime.

`lib/geo.js`, `lib/road.js`, `lib/motion.js` are native ES modules imported
by `index.html` and by the Node.js unit tests (via `"type": "module"` in
`package.json`).

MapLibre GL is loaded from CDN (`cdn.jsdelivr.net`). This is the only
runtime external dependency.

## Consequences

- Zero build configuration. Push → GitHub Pages serves immediately.
- `node_modules` only contains `@playwright/test` (dev dependency, not served).
- ES module imports require HTTPS or localhost — satisfied by GitHub Pages
  and by the `npx serve` dev server used in Playwright config.
- No TypeScript, no minification. Acceptable for a personal tool of this size.
- Adding a bundler later is straightforward; the lib/ module structure is
  already compatible.
