# ADR 009 — RD overlay toggle: default single-road, opt-in all-branches

## Status
Accepted

## Context

`segmentsAhead` runs a BFS over the full road graph and returns every reachable
segment within `CFG.lookahead`, including all branches at junctions. `firstTurnAhead`
then selects a single representative road and suppresses the turn card at genuine
junctions. The map overlay, however, can show either the full BFS result or only the
selected main road.

Two use cases pull in opposite directions:

- **Normal driving**: show only the road the algorithm has selected. The overlay should
  confirm which road BFS matched and where the turn card comes from. Showing all
  branches clutters the map and highlights roads the driver will not take.
- **Debugging / verification**: show all BFS branches to verify the algorithm sees the
  correct topology — useful when diagnosing a missed junction suppression or a wrong
  road match.

### Design iteration

The toggle was introduced as the **RD** button (road detail). The initial version
defaulted to showing all branches (`overlayAll = true`), with RD acting as a "reduce
detail" button. This was then inverted: the default became single-road (`overlayAll = false`),
with RD toggling into all-branches mode. The inversion reflected real use: in daily
driving the clutter of all branches is distracting, and the single-road view is the
useful default.

## Decision

**`overlayAll` defaults to `false`. The RD button toggles `overlayAll` to `true` to
show all BFS branches.**

- **RD off (default, `overlayAll = false`)**: the overlay draws only the main road
  selected by `firstTurnAhead` (`mainRoadPts`), plus the always-visible matched-segment
  blue overlay (`matchedSegPts`). Badges are also restricted to the main road.
- **RD on (`overlayAll = true`)**: the overlay draws all forward BFS segments with
  their individual colours (green / orange / red by cornering speed). All badges are
  shown. Button highlights in blue to signal the non-default state.

The display logic lives in `overlayGeoJSON` and `overlayBadgeItems` in `lib/display.js`,
both of which accept the `overlayAll` flag. `index.html` holds only the button handler
and the `overlayAll` variable.

## Consequences

- Default driving view is clean: one coloured road line confirms the matched road.
- Junction topology is one button-press away for on-road diagnosis without reloading.
- The RD button's blue highlight is the only indicator of the non-default state; there
  is no persistent label or tooltip explaining what the mode does.
- When `overlayAll = false` and `firstTurnAhead` returns no main road (junction
  suppression, no match), the overlay shows only the matched-segment blue line.
  This is the correct behaviour: no prediction is shown when the algorithm has none.
