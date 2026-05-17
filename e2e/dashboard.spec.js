import { test, expect } from '@playwright/test';

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

test('turn warning hidden with no road features', async ({ page }) => {
  await mockFeatures(page, []);
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('#turn-warning')).not.toBeVisible();
});

test('turn warning shown for single road with 90° turn', async ({ page }) => {
  const features = [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.348, 48.853],
        [2.350, 48.853],
        [2.350, 48.855],
      ],
    },
    properties: {},
  }];
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await expect(page.locator('#turn-warning')).toBeVisible({ timeout: 3000 });
});

test('turn warning suppressed at junction', async ({ page }) => {
  // Two LineStrings near current position → junction → suppress warning
  const features = [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [2.348, 48.853],
          [2.350, 48.853],
          [2.350, 48.855],
        ],
      },
      properties: {},
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [2.348, 48.853],
          [2.348, 48.855],
          [2.348, 48.857],
        ],
      },
      properties: {},
    },
  ];
  await mockFeatures(page, features);
  await mockGPS(page, { latitude: 48.853, longitude: 2.348, speed: 10, heading: 90, accuracy: 10 });
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(2000);
  await expect(page.locator('#turn-warning')).not.toBeVisible();
});
