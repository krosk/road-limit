/**
 * config.js — Default configuration constants.
 *
 * Defines DEFAULT_CFG, which index.html spreads into a mutable local CFG at
 * startup. Changing a value here changes the startup default; the live CFG is
 * independent of this module after the page loads.
 *
 * Owns: DEFAULT_CFG export only.
 * lateralGLimit and aThreshold must stay in sync (same g value); they represent
 * the same physical threshold from two different directions (display vs formula).
 */
export const DEFAULT_CFG = {
  lateralGLimit:      0.50,
  longGLimit:         0.40,
  aThreshold:         0.50 * 9.81,
  lookahead:          500,
  smoothAlpha:        0.15,
  urgentDist:         200,
  minSpeedForHeading: 5 / 3.6,
  roadMatchMaxDist:   30,
};
