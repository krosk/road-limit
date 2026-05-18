import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a JSON fixture from e2e/fixtures/<name>.json
// Real-data fixtures can be captured from the running app:
//   1. Open the app, click SET, drag map to target location
//   2. In DevTools console: copy(JSON.stringify(window.__lastFeatures))
//   3. Paste into e2e/fixtures/<name>.json
//   4. Write a test using loadFixture('<name>')
function loadFixture(name) {
  const p = join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Helper: inject fake GPS before page load
async function mockGPS(page, coords) {
  await page.addInitScript((c) => {
    navigator.geolocation.watchPosition = (success) => {
      setTimeout(() => success({ coords: c, timestamp: Date.now() }), 50);
      return 1;
    };
  }, coords);
}

// Helper: inject mock road features
async function mockFeatures(page, features) {
  await page.addInitScript((f) => { window.__mockFeatures = f; }, features);
}

test('start screen visible on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#start-screen')).toBeVisible();
});

test('map visible after start', async ({ page }) => {
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 0, heading: null, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#start-screen')).toBeHidden();
  await expect(page.locator('#map')).toBeVisible();
});

test('speed display shows GPS speed', async ({ page }) => {
  // speed=25 m/s → 90 km/h
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 25, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#speed-value')).toHaveText('90', { timeout: 5000 });
});

test('turn card hidden with no road features', async ({ page }) => {
  await mockFeatures(page, []);
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('#turn-card')).not.toBeVisible();
});

test('turn card shown for single road with 90° turn', async ({ page }) => {
  // Nodes spaced ~73 m apart (lon) and ~44 m (lat) so the 90° turn falls within 120 m lookahead.
  const features = [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.345, 48.853],
        [2.347, 48.853],
        [2.348, 48.853],
        [2.348, 48.8534],
      ],
    },
    properties: {},
  }];
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.346, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#turn-card')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#turn-card-speed')).toHaveText(/\d+/);
  await expect(page.locator('#turn-card-arrow')).toHaveText(/[←→]/);
});

test('turn card hidden at junction — branch road within lookahead suppresses card', async ({ page }) => {
  // Road 1 has a 90° bend within 120 m lookahead.
  // Road 2 branches at 73 m with its second node ~89 m away (within budget) → junction detected.
  const features = [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [2.345, 48.853],
          [2.347, 48.853],
          [2.348, 48.853],
          [2.348, 48.8534],
        ],
      },
      properties: {},
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [2.347, 48.853],
          [2.347, 48.8538],  // ~89 m north, fits within 120 m budget
        ],
      },
      properties: {},
    },
  ];
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.346, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('#turn-card')).not.toBeVisible();
});

// ── fixture-based tests ───────────────────────────────────────────────────────

test('fixture: straight-road — road matched, no turn card', async ({ page }) => {
  const features = loadFixture('straight-road-synthetic');
  // Car at west end of the straight road, heading east (90°)
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.346, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  // Straight road → no turn detected → turn card must not appear
  await page.waitForTimeout(1500);
  await expect(page.locator('#turn-card')).not.toBeVisible();
  // Road is matched → status shows road count, not "no road"
  await expect(page.locator('#status-msg')).toContainText('roads', { timeout: 3000 });
});

test('fixture: junction-synthetic — straight roads at junction, no turn card', async ({ page }) => {
  const features = loadFixture('junction-synthetic');
  // Car on the E-W road, heading east — BFS finds both straight branches
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(1500);
  // Straight roads → no tight turn → turn card stays hidden
  await expect(page.locator('#turn-card')).not.toBeVisible();
  // Status shows at least 2 features
  await expect(page.locator('#status-msg')).toContainText('roads', { timeout: 3000 });
});
