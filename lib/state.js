import { bearingTo } from './geo.js';
import { removeGravity, phoneToWorldFrame, worldToCarFrame, applyEMA } from './motion.js';

export function createState() {
  return {
    lat: null, lon: null, speed: 0, heading: null, lastHeading: 0, accuracy: null,
    smoothLat: 0, smoothLong: 0, latG: 0, longG: 0,
    beta: 0, gamma: 0,
    smoothAbsHeading: null,
    prevLat: null, prevLon: null,
  };
}

/**
 * Pure GPS update. Returns new state.
 * Heading advances only above minSpeedForHeading (m/s).
 */
export function applyGPS(state, coords, minSpeedForHeading) {
  const { latitude: lat, longitude: lon, speed, heading, accuracy } = coords;
  const spd = speed ?? 0;

  const update = { lat, lon, speed: spd, accuracy, prevLat: lat, prevLon: lon };

  if (spd > minSpeedForHeading) {
    if (heading !== null && heading !== undefined) {
      update.heading = heading;
      update.lastHeading = heading;
    } else if (state.prevLat !== null && state.prevLon !== null) {
      const computed = bearingTo(state.prevLat, state.prevLon, lat, lon);
      update.heading = computed;
      update.lastHeading = computed;
    }
  }

  return { ...state, ...update };
}

/**
 * Circular EMA for compass heading (fixed α = 0.1).
 * Returns new smoothed heading in [0, 360).
 */
export function smoothCompass(current, alpha) {
  if (current === null) return alpha;
  let diff = alpha - current;
  if (diff > 180)  diff -= 360;
  if (diff < -180) diff += 360;
  return (current + 0.1 * diff + 360) % 360;
}

/**
 * Pure motion event update.
 * Returns new state or null when the event carries no usable data.
 */
export function applyMotion(state, event, smoothAlpha) {
  let ax, ay, az;
  if (event.acceleration &&
      event.acceleration.x !== null &&
      event.acceleration.y !== null) {
    ax = event.acceleration.x;
    ay = event.acceleration.y;
    az = event.acceleration.z;
  } else if (event.accelerationIncludingGravity &&
             event.accelerationIncludingGravity.x !== null) {
    const raw = removeGravity(
      event.accelerationIncludingGravity.x,
      event.accelerationIncludingGravity.y,
      event.accelerationIncludingGravity.z,
      state.beta, state.gamma,
    );
    ax = raw.x; ay = raw.y; az = raw.z;
  } else {
    return null;
  }

  const world = phoneToWorldFrame(ax, ay, az, state.beta, state.gamma);
  const car   = worldToCarFrame(world.east, world.north, state.lastHeading);
  const G = 9.81;
  const smoothLat  = applyEMA(state.smoothLat,  Math.abs(car.lateral)  / G, smoothAlpha);
  const smoothLong = applyEMA(state.smoothLong, Math.abs(car.forward)  / G, smoothAlpha);

  return { ...state, smoothLat, smoothLong, latG: smoothLat, longG: smoothLong };
}
