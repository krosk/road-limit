const G = 9.81;

/**
 * Returns the accelerationIncludingGravity reading at rest in device frame.
 * Derived from R_world_to_device = R_x(beta) * R_y(gamma) applied to (0,0,G) world reaction.
 *
 * gx =  G * sin(gamma)
 * gy = -G * cos(gamma) * sin(beta)
 * gz =  G * cos(gamma) * cos(beta)   ← POSITIVE
 *
 * Verification:
 *   beta=0,  gamma=0 → gz=+9.81 (flat phone on table, z pointing up, gravity reaction up) ✓
 *   beta=90, gamma=0 → gy=-9.81 (upright portrait, gravity pulls screen side down) ✓
 */
export function gravityInDeviceFrame(betaDeg, gammaDeg) {
  const beta = betaDeg * Math.PI / 180;
  const gamma = gammaDeg * Math.PI / 180;
  return {
    x:  G * Math.sin(gamma),
    y: -G * Math.cos(gamma) * Math.sin(beta),
    z:  G * Math.cos(gamma) * Math.cos(beta),
  };
}

/**
 * Subtracts gravity from the measured accelerationIncludingGravity.
 * Returns {x, y, z} pure motion acceleration in device frame.
 */
export function removeGravity(ax, ay, az, betaDeg, gammaDeg) {
  const g = gravityInDeviceFrame(betaDeg, gammaDeg);
  return {
    x: ax - g.x,
    y: ay - g.y,
    z: az - g.z,
  };
}

/**
 * Rotates device-frame acceleration to world frame (east, north, up).
 * Uses R_device_to_world = R_y(-gamma) * R_x(-beta).
 *
 * east  =  cos(gamma)*ax  - sin(gamma)*sin(beta)*ay + sin(gamma)*cos(beta)*az
 * north =                   cos(beta)*ay             + sin(beta)*az
 * up    = -sin(gamma)*ax  - cos(gamma)*sin(beta)*ay + cos(gamma)*cos(beta)*az
 *
 * Verification:
 *   phoneToWorldFrame(0, 0, -2, 90, 0) → {east:0, north:-2, up:0}
 *   (upright portrait, deceleration -2 m/s² along north) ✓
 *   phoneToWorldFrame(2, 0, 0, 0, 0) → {east:2, north:0, up:0}
 *   (flat phone, eastward acceleration) ✓
 */
export function phoneToWorldFrame(ax, ay, az, betaDeg, gammaDeg) {
  const beta = betaDeg * Math.PI / 180;
  const gamma = gammaDeg * Math.PI / 180;
  const sinB = Math.sin(beta);
  const cosB = Math.cos(beta);
  const sinG = Math.sin(gamma);
  const cosG = Math.cos(gamma);

  return {
    east:  cosG * ax - sinG * sinB * ay + sinG * cosB * az,
    north:              cosB * ay        +       sinB * az,
    up:   -sinG * ax - cosG * sinB * ay + cosG * cosB * az,
  };
}

/**
 * Rotates world frame (east, north) to car frame using GPS heading.
 * Car forward = direction of travel, car lateral = perpendicular right.
 *
 * forward = east*sin(h) + north*cos(h)
 * lateral = east*cos(h) - north*sin(h)
 *
 * Returns {forward, lateral}.
 */
export function worldToCarFrame(east, north, headingDeg) {
  const h = headingDeg * Math.PI / 180;
  return {
    forward: east * Math.sin(h) + north * Math.cos(h),
    lateral: east * Math.cos(h) - north * Math.sin(h),
  };
}

/**
 * Exponential moving average.
 * alpha*newValue + (1-alpha)*current
 */
export function applyEMA(current, newValue, alpha) {
  return alpha * newValue + (1 - alpha) * current;
}
