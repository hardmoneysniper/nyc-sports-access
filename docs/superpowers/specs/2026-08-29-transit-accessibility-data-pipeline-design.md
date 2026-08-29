# Phase 1 Design: Transit-Accessibility Data Pipeline

Status: Approved (design), pending implementation plan
Scope: Data preparation only. Dashboard design/functionality is a separate, later phase requiring explicit sign-off before starting.

## Purpose

Produce a clean, joined dataset that, for each NTA (2020 boundaries), reports:
- Percentages of underrepresented populations, computed as separate selectable categories (mirroring how facility types are structured — see below), plus a detailed national-origin breakdown
- The population-weighted-average public-transit-only travel time/distance from that NTA's residents to the nearest athletic facility, computed per facility sport-type category and per time-of-week window (and derivable for any combination of facility types)

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

### Selectable demographic categories (mirrors the athletic-facility-type selection pattern)

Each category below is computed as its own independent percentage column at the NTA level, so a later multi-select can combine any subset the same way facility types do. Feasibility was verified against live 2020–2024 ACS 5-year tract data and checked against NYC Dept. of City Planning's own 20%-margin-of-error "gray-out" reliability threshold:

| Category | Source | Tract/NTA reliability |
|---|---|---|
| Non-white % | `B03002` — 100% − (non-Hispanic-White-alone share) | Safe |
| Immigrant / foreign-born % | `B05002`/`C05002` (nativity+citizenship), `B05005` (recent arrival <5yrs), `C05006` (world region of birth) | Safe |
| Asian % | `B02001_005` / `B03002` Asian alone | Safe |
| Hispanic or Latino % | `B03002_012` | Safe |
| Black or African American % | `B02001_003` / `B03002` Black alone | Safe |
| Two or more races % | `B02001_008` | Usually safe; borderline in low-diversity tracts, resolved by NTA-level count aggregation |

**Excluded from selectable categories:** American Indian & Alaska Native alone, and Native Hawaiian & Other Pacific Islander alone. Both fail NYC Planning's own reliability threshold even at borough-wide scale (Manhattan-wide AIAN: 8,665 ± 1,978 MOE; NHPI: 1,036 ± 435 MOE, CV ~26%), and individual tract/NTA estimates are frequently smaller than their own margin of error — not a trustworthy metric to expose.

### Detailed national origin (additional data, not part of the category multi-select)

- `B05006` — place of birth, ~150 specific countries (e.g. Venezuelan, Guatemalan, Mexican, Ecuadorian). Tract-level estimates are individually noisy (high MOE for small-sending-country cells in a single tract), so **raw counts are summed across all tracts in an NTA first**, and percentages are computed only at the NTA level. Retained alongside the 6 categories above as supplementary data reflecting the article's specific-nationality framing.

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
  - GTFS feeds: NYCT subway + all MTA bus company feeds + NYC Ferry. LIRR, Metro-North, and Staten Island Railway are explicitly excluded. Verified current bulk-download sources (no API key required for static feeds; a key is only needed for real-time GTFS-RT, which isn't used here):
    - Subway: `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip`
    - Bus, per company: `http://web.mta.info/developers/data/nyct/bus/google_transit_{manhattan,brooklyn,bronx,queens,staten_island}.zip`
    - MTA Bus Company: `http://web.mta.info/developers/data/busco/google_transit.zip`
    - NYC Ferry: `http://nycferry.connexionz.net/rtt/public/resource/gtfs.zip`
- Departure time / time-of-week windows: travel time is computed separately for **6 windows**, taking the median travel time across departures within each window, per tract→facility-type pair. This produces 6 parallel time values per (tract, facility-type-category) combination rather than a single number:
  - Weekday morning: 7:00–9:00am
  - Weekday noon: 11:00am–1:00pm
  - Weekday evening: 5:00–7:00pm
  - Weekend morning: 9:00–11:00am
  - Weekend noon: 11:00am–1:00pm
  - Weekend evening: 5:00–7:00pm
  - A representative non-holiday weekday and weekend day are chosen from within the GTFS feeds' calendar validity window during implementation.
- Origin point per tract: Shapely "point on surface" (guaranteed to fall inside the polygon), not a naive arithmetic centroid, to avoid landing outside concave/oddly-shaped tracts.
- Intra-tract walking offset: take the tract's axis-aligned bounding box (4 corners), compute the distance from each corner to the origin point, average the 4 distances, halve the result, and convert to time at 3.0 mph (4.8 km/h). This flat offset is added to every OD travel time computed from that tract, approximating the extra walk for a resident who isn't standing exactly at the origin point.
- Last-mile handling: r5py's normal walk-access/walk-egress behavior (walk to nearest usable stop, ride transit, walk from egress stop to the facility) is used as-is — no separate "no path found" fallback branch. The walk-access/egress radius is set generously so that transit-poor pockets still resolve to a (long) walk-plus-transit time rather than a null, consistent with "ride transit as far as it goes, walk the rest on both ends."

## 5. Output Deliverable

Two tables produced by this pipeline:

- **Tract-level table**: `GEOID`, `NTA2020`, per-sport-type-category × per-time-window nearest-facility travel time and distance, raw demographic counts (foreign-born, recent-arrival, world-region-of-birth, detailed country-of-birth, race/ethnicity categories).
- **NTA-level table**: joined to the NTA polygon geometry; demographic percentages (6 selectable categories + detailed national-origin breakdown) computed from summed tract counts; per-sport-type-category × per-time-window travel time computed as the population-weighted average of the (offset-adjusted) tract-level travel times within that NTA.

The NTA-level table/GeoJSON is the artifact the (separate, future) dashboard phase will consume. No dashboard schema, UI, or interaction design is decided in this phase.

## Action Items / External Dependencies

- Census API key — obtained, stored in local `.env` (gitignored), not committed to the repo.
- Download OSM extract (Geofabrik, NY metro, clip to 5 boroughs).
- Download current MTA/NYC Ferry static GTFS feeds from the verified URLs listed above and confirm representative non-holiday weekday and weekend dates within their calendar validity window for the 5 travel-time windows.
