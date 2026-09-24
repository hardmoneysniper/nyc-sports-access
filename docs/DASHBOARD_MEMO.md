# Dashboard Requirements Memo

Status: requirements notes only — **no dashboard implementation has started**.
Recorded ahead of the dashboard phase so requirements gathered during data
prep aren't lost by the time that phase starts. Everything in this file is a
requirement to design against later, not a decision already made about UI,
framework, or interaction details.

Original phase-1 data-prep scope explicitly excluded dashboard design (see
[the design spec](superpowers/specs/2026-08-29-transit-accessibility-data-pipeline-design.md)).
This memo doesn't change that — it's a running list of functionality the
project owner has since said the dashboard will need.

## 1. NTA click → tract-level route display (2026-09-14)

**Requirement:** the user can click an NTA on the map to select it. On
selection, the dashboard shows the routing from every census tract inside
that NTA to its nearest sport facility — either for one selected sport type,
or "any" sport type.

**Data dependency, two stages:**
1. `run_evening_windows.py` computes, per tract/sport-type/window, which
   facility is nearest (`nearest_facility_id`) and the straight-line desire
   line to it (`pipeline/routes.py`) — written to
   `data/processed/evening_routes.geojson`.
2. `run_detailed_routes.py` (added 2026-09-14, per project owner instruction
   that straight lines aren't sufficient) consumes stage 1's output and
   computes the **real transit-path geometry** to each already-known nearest
   facility — actual streets walked, actual subway/bus legs ridden, via
   r5py's `DetailedItineraries` API (`pipeline/detailed_routes.py`) — written
   to `data/processed/evening_routes_detailed.geojson`, one row per route
   *segment* (a trip can have several: walk to stop, ride a line, walk to
   destination), tagged with `transport_mode`, `route_id`, `agency_id`,
   `distance`, `travel_time`, `wait_time`, etc. per segment. Neither script
   has been run yet (stage 2 depends on stage 1's output existing first).

**Cost note:** stage 2 is meaningfully more expensive than stage 1 per sport
type — it runs one full point-to-point trip search per tract rather than one
batched sweep per sport type (see `pipeline/detailed_routes.py`'s module
docstring). There's no empirical timing for it yet; a small-scope test run
(one sport type) before committing to all 24 is advisable.

**Rendering the segments:** since a route can have multiple segments with
different transport modes, the dashboard should style each segment
independently (e.g. dashed for walk legs, solid colored by `route_id` for
transit legs) rather than treating a route as one uniform line.

**Open question — "any" sport type:** the pipeline computes nearest-facility
time/route **per sport type** (24 independent categories); there's no
precomputed "nearest facility regardless of type." An "any" selection would
need to be resolved as either (a) client-side: take the min-travel-time route
across all 24 sport types' precomputed routes per tract, or (b) a new
pipeline output: an actual all-facility-types-pooled nearest-facility
computation. (a) is free (no new compute, just a client-side min() over
already-produced data); (b) requires rerunning r5py with every active
facility as a single destination pool per tract. Needs a decision before
implementation, not resolved here.

**Which windows this applies to:** as of 2026-09-14, only the 2 evening
windows (`weekday_evening`, `weekend_evening`) will have route-line geometry
once `run_evening_windows.py` is run — the original 4 windows
(`weekday_morning`/`weekday_noon`/`weekend_morning`/`weekend_noon`) only have
scalar nearest-facility *times* checkpointed (`nearest_facility_id` was never
captured for those runs). Producing route lines for those 4 would mean
rerunning r5py for them, not a free reshape of existing output.

## 2. Youth/adult facility selector (2026-09-14)

**Requirement:** an independent youth/adult selector alongside the sport-type
selector. Already reflected in `pipeline/config.py`'s `SPORT_TYPE_GROUPS`:
baseball and football are split into age-specific groups
(`baseball_adult`/`baseball_youth`, `football_adult`/`football_youth`, with
flag football counted under both football groups since it's played by both
ages); every other sport type — including softball, which has the same
adult/youth column split as baseball but wasn't called out for
separation — is shown regardless of which age is selected.

No data-output work is needed for this beyond what `SPORT_TYPE_GROUPS`
already encodes; it's purely a dashboard-side filter-group decision.

## 3. Plot/map view toggle with synchronized dual-map pan/zoom (2026-09-15)

**Requirement:** the dashboard needs a view switcher between a scatter plot
and a map view, for comparing two NTA-level metrics (e.g. % foreign-born vs.
% of population within 15 min of nearest soccer field — see
`make_scatter.py` / `make_maps.py` for the reference implementation of this
specific pair, though the dashboard version should presumably generalize to
whichever two metrics are selected, not just this one hardcoded pair).

- **Plot view:** one scatter plot, x-axis = metric 1, y-axis = metric 2, one
  point per NTA.
- **Map view:** two choropleth maps side by side — **left map = metric 1
  (the x-axis metric), right map = metric 2 (the y-axis metric)**.
- **Linked pan/zoom in map view:** dragging or zooming either map applies
  the same transform to the other map, so they always stay in the same
  spatial frame for visual comparison.

**Data dependency:** `pipeline/nta_accessibility_data.py`'s
`load_nta_with_accessibility()` is the reference computation for the
foreign-born/soccer-access pair specifically (shared by both
`make_maps.py` and `make_scatter.py` so they can't drift apart) — generalizing
it to arbitrary metric pairs, if the dashboard needs that, is a separate
decision not resolved here.

**Not resolved here:** which mapping/charting library supports linked
map instances out of the box (vs. needing custom viewport-sync code) is an
implementation choice for the dashboard phase, not decided by this memo.
