# Phase 1 Design: Transit-Accessibility Data Pipeline

Status: Approved (design), pending implementation plan
Scope: Data preparation only. Dashboard design/functionality is a separate, later phase requiring explicit sign-off before starting.

## Purpose

Produce a clean, joined dataset that, for each NTA (2020 boundaries), reports:
- Percentages of underrepresented populations (foreign-born/immigrant status, race/ethnicity, national origin)
- The population-weighted-average public-transit-only travel time/distance from that NTA's residents to the nearest athletic facility, computed per facility sport-type category (and derivable for any combination of types)

This is a data sequel to a May 2024 NYT photo-essay ("On Queens Soccer Fields, Immigrants Find Each Other and a Sense of Home") about Latin American immigrant soccer leagues at Flushing Meadows Corona Park — the article is framing/inspiration, not a data or methodology source.

Census tract is the calculation unit only; NTA is the only display unit. No dashboard design work happens in this phase.

## Source Data (as provided)

| Dataset | Path | Rows | CRS | Key fields |
|---|---|---|---|---|
| NTA boundaries | `data/nynta2020_26c/nynta2020_26c/nynta2020.shp` | 262 | EPSG:2263 | `NTA2020`, `NTAName`, `BoroCode` |
| Census tract boundaries | `data/nyct2020_26c/nyct2020.shp` | 2,325 | EPSG:2263 | `GEOID`, `NTA2020` (pre-joined by NYC DCP), `BoroCT2020` |
| Athletic facilities | `data/Athletic Facilities_20260829/geo_export_*.shp` | 6,951 | EPSG:4326 | ~25 boolean sport columns, `primary_sp`, `featuresta` (status) |

No demographic data exists locally — it is pulled from the Census API (see below). No PDF/article dataset is used beyond framing.

## 1. Geography & Joins

- Census tracts already carry an `NTA2020` attribute assigned by NYC DCP — aggregation from tract → NTA is a plain attribute join, no spatial join required.
- Tract `GEOID` is the standard 11-digit Census GEOID (state 36 + county FIPS + 6-digit tract code) and matches the Census API's tract identifiers directly.
- All three source shapefiles must be reprojected to a common CRS for geometric operations (tract/NTA are EPSG:2263 NY State Plane ft; facilities are EPSG:4326). Facilities reprojected to EPSG:2263 for distance/geometry work; both reprojected to EPSG:4326 for r5py (which expects WGS84 lat/lon).

## 2. Demographic Data

Source: ACS 2020–2024 5-year estimates (latest vintage, released Jan 2026), pulled at **census tract** level via the Census API (`api.census.gov`), NYC = 5 counties (Bronx 005, Kings 047, New York 061, Queens 081, Richmond 085), state 36. Requires a free Census API key.

Categories and tables:

- **Foreign-born / immigrant status**
  - `B05002` / `C05002` — nativity and citizenship status
  - `B05005` — year of entry (recent arrival, <5 years)
  - `C05006` — place of birth by broad world region (reliable at tract level)
- **Detailed national origin**
  - `B05006` — place of birth, ~150 specific countries. Tract-level estimates are individually noisy (high MOE for small-sending-country cells in a single tract), so **raw counts are summed across all tracts in an NTA first**, and percentages are computed only at the NTA level.
- **Race/ethnicity**
  - `B03002` — Hispanic/Latino origin by race
  - Displayed metric: a single combined "underrepresented by race/ethnicity" % = 100% − (non-Hispanic-White-alone share)

**Aggregation rule (applies to every demographic percentage):** raw counts are summed across the tracts belonging to an NTA, and percentages are computed from those summed counts at the NTA level — never by averaging tract-level percentages. This is both the statistically correct way to combine ACS tract estimates and the way NYC DCP's own reports (e.g. "Newest New Yorkers") handle small-geography noise.

Out of scope for this phase (not requested): language/LEP tables, income/poverty tables.

## 3. Athletic Facilities

- Filter to `featuresta == 'Active'` only; exclude Removed / Inactive / Closed Temporarily / Archived.
- No single clean "facility type" field exists. Each of the ~25 boolean sport columns (`basketball`, `tennis`, `handball`, `cricket`, `pickleball`, `bocce`, `hockey`, `lacrosse`, `rugby`, `volleyball`, baseball/softball variants, football variants, etc.) is treated as its own facility-type category — a facility can belong to multiple categories simultaneously.
- For each census tract, the pipeline computes the nearest-facility travel time **separately per sport-type category** (Active facilities only). This is sufficient to answer any future "nearest facility matching any of N selected types" query as `min()` across the relevant precomputed category values — no need to recompute per combination.

## 4. Travel-Time Computation (r5py)

- Engine: `r5py` (Conveyal R5), chosen over OpenTripPlanner for its native many-to-many travel-time-matrix computation, which fits this batch accessibility-analysis use case directly.
- Network inputs:
  - OSM extract: NY metro extract (Geofabrik), clipped to the 5 boroughs
  - GTFS feeds: NYCT subway + all MTA bus company feeds + NYC Ferry. LIRR, Metro-North, and Staten Island Railway are explicitly excluded.
- Departure time: weekday, AM window (7:00–9:00am), median travel time taken across departures within that window per tract→facility-type pair.
- Origin point per tract: Shapely "point on surface" (guaranteed to fall inside the polygon), not a naive arithmetic centroid, to avoid landing outside concave/oddly-shaped tracts.
- Intra-tract walking offset: take the tract's axis-aligned bounding box (4 corners), compute the distance from each corner to the origin point, average the 4 distances, halve the result, and convert to time at 3.0 mph (4.8 km/h). This flat offset is added to every OD travel time computed from that tract, approximating the extra walk for a resident who isn't standing exactly at the origin point.
- Last-mile handling: r5py's normal walk-access/walk-egress behavior (walk to nearest usable stop, ride transit, walk from egress stop to the facility) is used as-is — no separate "no path found" fallback branch. The walk-access/egress radius is set generously so that transit-poor pockets still resolve to a (long) walk-plus-transit time rather than a null, consistent with "ride transit as far as it goes, walk the rest on both ends."

## 5. Output Deliverable

Two tables produced by this pipeline:

- **Tract-level table**: `GEOID`, `NTA2020`, per-sport-type-category nearest-facility travel time and distance, raw demographic counts (foreign-born, recent-arrival, world-region-of-birth, country-of-birth, race/ethnicity).
- **NTA-level table**: joined to the NTA polygon geometry; demographic percentages computed from summed tract counts; per-sport-type-category travel time computed as the population-weighted average of the (offset-adjusted) tract-level travel times within that NTA.

The NTA-level table/GeoJSON is the artifact the (separate, future) dashboard phase will consume. No dashboard schema, UI, or interaction design is decided in this phase.

## Action Items / External Dependencies

- Obtain a free Census API key (`api.census.gov/data/key_signup.html`)
- Download OSM extract (Geofabrik, NY metro, clip to 5 boroughs)
- Download current MTA GTFS static feeds (subway, all bus companies, NYC Ferry) and confirm a representative non-holiday weekday within their calendar validity window for the AM travel-time computation
