# Methodology: NYC Athletic Facility Transit-Accessibility Dataset

This document describes the methodology actually implemented and run to produce
the datasets in `data/processed/`. It reflects the as-built pipeline (`pipeline/`),
not just the original design intent — see
[the original design spec](superpowers/specs/2026-08-29-transit-accessibility-data-pipeline-design.md)
for the initial rationale, where this document differs (soccer's derivation,
final window-weighting scheme) or adds detail (exact matching rules, formulas).

## 1. Purpose

For every NYC Neighborhood Tabulation Area (2020 boundaries, `NTA2020`), produce:

1. Demographic composition — percentages of underrepresented populations, each
   as an independently selectable category, plus a detailed country-of-birth
   breakdown.
2. Population-weighted average public-transit travel time from that NTA's
   residents to the nearest athletic facility, computed separately for each of
   24 sport-type categories, and separately for 4 time-of-week windows (plus a
   single combined value per sport type that blends the 4 windows).

Census tract is the unit of calculation; NTA is the unit of aggregation and
output. No dashboard/visualization work is in scope for this methodology —
it covers data preparation only.

## 2. Source Data

| Dataset | Path | Rows | Native CRS | Key fields |
|---|---|---|---|---|
| NTA boundaries | `data/nynta2020_26c/nynta2020_26c/nynta2020.shp` | 262 | EPSG:2263 | `NTA2020`, `NTAName`, `BoroCode` |
| Census tract boundaries | `data/nyct2020_26c/nyct2020.shp` | 2,325 | EPSG:2263 | `GEOID`, `NTA2020` (pre-joined by NYC DCP), `BoroCT2020` |
| Athletic facilities | `data/Athletic Facilities_20260829/geo_export_*.shp` | 6,951 | EPSG:4326 | ~25 boolean sport columns, `primary_sp`, `featuresta`, `regulation`, `nonregulat` |
| ACS demographics | Census API, `api.census.gov` | pulled live | — | Tables B02001, B03002, B05002, B05006 |

Both boundary shapefiles are reprojected to EPSG:2263 (`pipeline/geography.py`)
for all geometric operations (origin points, walking-offset distances), since
that's a feet-based CRS matching the source shapefiles' native units. Facility
and tract-origin geometries are separately reprojected to EPSG:4326 (WGS84)
immediately before being handed to r5py, which requires geographic coordinates.

## 3. Geography & Joins

- Tract → NTA is a plain attribute join on the tract shapefile's own pre-assigned
  `NTA2020` column (NYC DCP already performs this join upstream) — no spatial
  join is computed. `geography.validate_tract_nta_join` fails loudly if any
  tract has a missing `NTA2020` or references an NTA code absent from the NTA
  layer, rather than silently dropping or mis-joining rows.
- `GEOID` is the standard 11-digit Census tract identifier (2-digit state +
  3-digit county + 6-digit tract), matching the Census API's own tract IDs
  directly — no reformatting needed for the demographic join.

## 4. Demographic Data (`pipeline/census_client.py`, `pipeline/demographics.py`)

- Source: ACS 2020–2024 5-year estimates, pulled at **census-tract** granularity
  for the 5 NYC counties (Bronx 005, Kings 047, New York 061, Queens 081,
  Richmond 085; state FIPS 36), via `api.census.gov/data/2024/acs/acs5`.
- **Aggregation rule (applied uniformly):** raw ACS estimate *counts* are
  summed across every tract belonging to an NTA first, and the percentage is
  computed from those summed counts at the NTA level. Percentages are never
  averaged tract-to-tract — this is the statistically correct way to combine
  ACS estimates across small geographies and avoids a well-known variance trap
  where sparse tracts distort a simple average.
- **Variable selection is label-driven, not hardcoded variable-code-driven**:
  for each ACS group table, `_variable_for_label` fetches the table's own
  metadata and picks the variable whose *label text* matches a predicate
  (e.g. "ends with 'Two or More Races'"), raising if zero or more-than-one
  variable matches. This is deliberately fragile-by-design (fails loudly at
  fetch time) rather than trusting a variable code that Census could
  renumber between vintages.
  - Several predicates guard against known label traps in the live 2020–2024
    API response: trailing colons on parent rows, casing/hyphenation
    differences between tables (`B02001` uses Title Case, `B05002` hyphenates
    "Foreign-born"), and substring collisions between a parent label and its
    own nested child rows (e.g. `B05002`'s "Foreign-born:" row nests
    citizenship/region-of-birth children whose labels also contain "foreign
    born" as a substring). Each predicate matches only the exact final
    `"!!"`-delimited hierarchy segment, not a raw substring check.

### Selectable categories (independent percentages, each NTA-level)

| Category | Formula | Source table |
|---|---|---|
| `pct_non_white` | 100 × (1 − white-alone / total) | B03002 |
| `pct_hispanic_or_latino` | 100 × Hispanic-or-Latino / total | B03002 |
| `pct_black_or_african_american` | 100 × Black-alone / total | B02001 |
| `pct_asian` | 100 × Asian-alone / total | B02001 |
| `pct_two_or_more_races` | 100 × two-or-more-races / total | B02001 |
| `pct_immigrant` | 100 × foreign-born / total | B05002 |

Two categories from the original candidate list (American Indian & Alaska
Native alone; Native Hawaiian & Other Pacific Islander alone) were evaluated
and excluded: both fail NYC Planning's own 20%-margin-of-error reliability
threshold even at borough-wide scale, with individual tract/NTA estimates
frequently smaller than their own margin of error.

### Detailed national origin

- `B05006` (place of birth, ~150 country-level categories). Only **leaf**
  labels are kept — `_is_leaf_label` walks the table's `"!!"`-delimited label
  hierarchy and keeps a row only if no other row is nested underneath it
  (checked at a `"!!"` boundary, not as a raw string-prefix check, since e.g.
  "...Caribbean:!!Dominica" is a sibling of "...Caribbean:!!Dominican
  Republic", not its parent, despite the naive prefix match).
- Each leaf country label is slugified (lowercased, non-alphanumeric runs
  collapsed to `_`) into a column name `pct_foreign_born_{slug}`. A collision
  where two different countries would slugify to the same column name raises
  loudly rather than silently overwriting one column with the other.
- Per the aggregation rule above, country counts are summed across an NTA's
  tracts before the percentage is computed — country-level tract estimates
  are individually too noisy (high MOE for small-sending-country cells) to
  trust at tract granularity.

## 5. Athletic Facilities (`pipeline/facilities.py`)

- Filtered to `featuresta == "Active"` only (excludes Removed / Inactive /
  Closed Temporarily / Archived).
- No single "facility type" field exists in the source data. Each of 23 native
  boolean sport columns is treated as its own independent facility-type
  category — a facility can belong to multiple categories at once. (`accessible`
  and `wheelchair` are accessibility attributes, not sport types, and are
  excluded from the category list.)
- **Soccer (24th category) is synthesized, not native.** The shapefile has no
  boolean `soccer` column. Per project-owner domain knowledge, the
  `regulation`/`nonregulat` fields — nominally generic field-size flags — each
  specifically indicate a field capable of hosting soccer. The synthesized
  column is `soccer = regulation | nonregulat` (370 active facilities).
  Alternative derivations were tested and rejected: matching on `primary_sp`
  text or general system-text matching undercounts (298–316 facilities
  depending on exact method) relative to the domain-knowledge-driven flag
  union.
- Facility geometries are polygon/multipolygon (court/field footprints); r5py
  requires point geometry, so each facility's `representative_point()` — a
  point guaranteed to fall inside the polygon (not a naive centroid, which can
  land outside a concave shape) — is used as its destination point.
- Facility IDs for r5py come from each row's own DataFrame index (cast to
  string), not the shapefile's `gispropnum` column, since `gispropnum`
  identifies the parent park/property and is not unique per facility row —
  r5py requires unique destination IDs.

Final category list (23 native + 1 synthesized soccer):
`adult_base, adult_foot, adult_soft, basketball, bocce, cricket, flagfootba,
frisbee, handball, hockey, kickball, lacrosse, ll_baseb_1, ll_baseb_2,
ll_softbal, netball, pickleball, rugby, soccer, tennis, track_and_, t_ball,
volleyball, youth_foot`.

(`SPORT_TYPE_GROUPS` in `pipeline/config.py` additionally maps naming variants
to display categories for a future dashboard phase, including an independent
youth/adult selector: baseball and football are split into age-specific
groups (`baseball_adult`/`baseball_youth`, `football_adult`/`football_youth`),
with flag football counted under both football groups since it's played by
both age groups. Every other category — including softball, which has the
same adult/youth column split as baseball but wasn't split — is shown
regardless of which age is selected. None of this grouping is applied
anywhere in the data-preparation pipeline or outputs described here.)

## 6. Travel-Time Computation (`pipeline/travel_time.py`, `pipeline/offsets.py`)

- **Engine:** r5py (Conveyal R5), for its native many-to-many travel-time-matrix
  computation.
- **Network inputs:**
  - OSM extract: Geofabrik New York State extract (`new-york.osm.pbf`).
  - GTFS static feeds: NYCT subway, all 5 borough NYCT bus feeds, MTA Bus
    Company, and NYC Ferry. LIRR, Metro-North, and Staten Island Railway are
    explicitly excluded.
- **Transport modes:** `TRANSIT` + `WALK` only (r5py's normal walk-access /
  walk-egress behavior — walk to a usable stop, ride transit, walk from the
  egress stop to the facility — with no separate "no path found" fallback
  branch; a generous access/egress radius lets transit-poor areas resolve to a
  long walk-plus-transit time rather than a null).
- **Departure windows** (4 total; each computed as the median of departures
  within a 2-hour window, at the 50th percentile, on a fixed reference date):

  | Window | Reference date | Time range |
  |---|---|---|
  | `weekday_morning` | 2026-09-01 (Tue) | 7:00–9:00am |
  | `weekday_noon` | 2026-09-01 (Tue) | 11:00am–1:00pm |
  | `weekend_morning` | 2026-09-05 (Sat) | 9:00–11:00am |
  | `weekend_noon` | 2026-09-05 (Sat) | 11:00am–1:00pm |

  Reference dates were chosen to fall inside the intersection of every
  downloaded feed's `calendar.txt` validity window (bus feeds publish a much
  shorter rolling window than subway/ferry) and are validated automatically
  before each run (`network_acquisition.validate_reference_dates`), which
  fails loudly if any feed's calendar no longer covers them.

- **Tract origin point:** `representative_point()` of the tract polygon (point
  guaranteed inside the polygon), not a naive centroid.
- **Intra-tract walking offset:** computed once per tract, added to every OD
  travel time originating from that tract:
  1. Take the tract polygon's axis-aligned bounding-box corners (4 points).
  2. Compute the distance from each corner to the tract's origin point.
  3. Average the 4 distances, then halve the result.
  4. Convert that half-distance to time at a fixed walking speed of 3.0 mph.

  This approximates the extra walk a resident not standing exactly at the
  origin point would need, and is independent of r5py's own internal
  access/egress walk speed for the transit leg itself. The offset is computed
  in EPSG:2263 (feet) — the 5280 ft/mile conversion assumes a feet-based CRS,
  so this step only ever runs on projected geometry, never WGS84.
- **Nearest-facility reduction:** for each tract × sport-type × window, r5py
  produces a full tract→facility matrix; the pipeline takes the **minimum**
  travel time across all Active facilities of that sport type (after adding
  the tract's walking offset), i.e. nearest-facility travel time. A tract with
  zero reachable facilities of a given sport type in a given window produces
  no row for that combination (not a zero) — this is the raw "unreachable"
  signal that later stages must handle explicitly (see §7).

## 7. Aggregation to NTA Level (`pipeline/aggregate_travel_time.py`)

For each NTA × sport-type × window combination:

```
travel_time_minutes(NTA) = Σ(tract travel_time_minutes × tract population) / Σ(tract population)
```

- Population weights come from ACS table B02001's total population estimate
  (`_001E`), fetched at tract level.
- A tract with a known travel time but no population match raises loudly
  (named GEOIDs) rather than silently dropping that tract's contribution or
  collapsing a whole NTA's weighted sum to an indistinguishable 0/0 = NaN.
- Tracts with **no** travel time for a combination (unreachable, per §6) are
  dropped from that combination's weighted sum/population sum, so they don't
  pull the NTA average toward zero — they contribute no signal for that
  combination.
- The result is reindexed against the full expected NTA × sport-type × window
  combination set, so a combination where *every* tract in an NTA is
  unreachable still yields an explicit `NaN` row rather than silently
  vanishing (an absent row gives a downstream consumer no signal at all).

## 8. Combined Cross-Window Travel Time (`pipeline/build_output.py`)

For dashboard consumption, a single "typical" travel time per sport type
(collapsing the 4 window columns) is computed as a **weekday-frequency-weighted
average**, reflecting that weekday windows recur 5×/week and weekend windows
2×/week:

| Window | Weight |
|---|---|
| `weekday_morning` | 5 |
| `weekday_noon` | 5 |
| `weekend_morning` | 2 |
| `weekend_noon` | 2 |

```
travel_time_{sport} = (5·weekday_morning + 5·weekday_noon + 2·weekend_morning + 2·weekend_noon) / 14
```

If any one of the 4 window values is `NaN`, the combined value is `NaN` too —
never re-normalized over fewer inputs, so a partial result can't silently
change what's being measured.

## 9. Output Tables

| File | Grain | Contents |
|---|---|---|
| `data/processed/tract_output.csv` | 1 row / census tract (2,325) | `GEOID`, `NTA2020`, per-sport-type × per-window nearest-facility travel time (wide, 24×4 = 96 columns) |
| `data/processed/tract_output_combined_time.csv` | 1 row / tract | `GEOID`, `NTA2020`, one weekday-weighted combined travel time per sport type (24 columns) |
| `data/processed/nta_output.geojson` | 1 row / NTA (262) | NTA polygon geometry + demographic percentages (6 categories + country-of-birth breakdown) + per-sport-type × per-window travel time (wide) |
| `data/processed/nta_output_combined_time.csv` | 1 row / NTA (262) | `NTA2020`, `NTAName`, one weekday-weighted combined travel time per sport type (24 columns) |
| `data/processed/checkpoints/{sport_type}.csv` | 1 row / tract × window | Intermediate per-sport-type checkpoint (see §10); long-format `GEOID, sport_type, window_name, travel_time_minutes` |

`tract_output.csv` is anchored on the full tract→NTA join (not on whichever
tracts happen to have travel-time rows), so a tract unreachable across every
sport type/window still appears with explicit `NaN`s rather than being absent.

## 10. Pipeline Orchestration & Checkpointing

`run_pipeline_batched.py` is the production entry point:

1. **One-time setup** (`pipeline/pipeline_setup.py`): validate network inputs
   and reference dates are present/valid; load and join geography; compute
   tract origin points and walking offsets; fetch demographic data; load and
   filter facilities per sport type; build the r5py transport network.
2. **Per-sport-type travel-time computation** (`pipeline/batch_runner.py`):
   the full job (24 sport types × 4 windows × 2,325 tracts) runs one sport
   type at a time, writing an atomic checkpoint CSV to
   `data/processed/checkpoints/{sport_type}.csv` immediately after that sport
   type fully succeeds. Checkpoints are written to a temp file and
   `os.replace`d into place, so a process killed mid-write never leaves a
   checkpoint that looks falsely complete. A re-run skips any sport type that
   already has a checkpoint and resumes at the first one without one — this
   is what let the batch survive being interrupted without restarting from
   scratch.
3. **Aggregation and output**: checkpoints are concatenated, aggregated to
   NTA level (§7), and written out (§9); a separate post-processing script,
   `add_combined_travel_time.py`, derives the weekday-weighted combined
   columns (§8) from the already-written tract/NTA tables without
   recomputing anything upstream.

Network acquisition (`pipeline/network_acquisition.py`) downloads GTFS feeds
and the OSM extract atomically (temp file, validated, then renamed into
place) so a failed/partial download never masquerades as a complete input.

## 11. Known Limitations

- 48 of 262 NTAs have no reachable facility of *any* sport type within the
  computed network in at least one window, surfacing as explicit `NaN` in the
  combined-time output — these are predominantly low-transit-access or
  island geographies, not a data-quality gap in the pipeline itself.
- Soccer facility counts depend on a domain-knowledge-driven interpretation
  of `regulation`/`nonregulat` (§5); a different interpretation of those
  fields would change which facilities count as soccer-capable.
- Travel times reflect a single representative weekday and weekend date; they
  do not capture service disruptions, seasonal schedule changes, or dates
  outside the GTFS feeds' validity window at the time of the run.
- Demographic percentages are 2020–2024 ACS 5-year estimates (a 5-year
  rolling average), not a single-year snapshot.
