# Transit-Accessibility Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two output tables (tract-level and NTA-level) joining demographic percentages and public-transit-only travel time to the nearest athletic facility, per sport-type category and per time-of-week window, for every NYC census tract and NTA.

**Architecture:** A sequence of small Python modules under `pipeline/`, each owning one stage (geography loading, facility filtering, Census API pull, demographic aggregation, network acquisition, r5py travel-time computation, tract→NTA aggregation, output assembly), orchestrated by a single `run_pipeline.py` script. Pure-logic stages (geometry math, aggregation math, label parsing) are unit-tested with synthetic fixtures; I/O-heavy stages (Census API, GTFS/OSM downloads, r5py network build) are unit-tested at their wiring boundary with mocks, then exercised for real in dedicated smoke-run steps.

**Tech Stack:** Python 3.11, geopandas, shapely 2.x, pandas, requests, python-dotenv, pytest, r5py (Conveyal R5, requires JDK 21+).

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-08-29-transit-accessibility-data-pipeline-design.md` — every task below implements a specific section of it.
- Census tract is the calculation unit only; NTA is the only display/output unit. No dashboard code, schema, or UI decisions belong in this plan.
- All demographic percentages are computed from **summed raw counts at the NTA level**, never from averaged tract-level percentages.
- Facility filter: `featuresta == 'Active'` only.
- Time windows (6, each computed independently): weekday morning 7:00–9:00am, weekday noon 11:00am–1:00pm, weekday evening 5:00–7:00pm, weekend morning 9:00–11:00am, weekend noon 11:00am–1:00pm, weekend evening 5:00–7:00pm.
- Intra-tract walking offset: bounding-box 4-corner distances to the tract's "point on surface", averaged, halved, converted to time at 3.0 mph (4.8 km/h) — added flat to every OD time from that tract. This is separate from r5py's own internal access/egress walk speed and must not be conflated with it.
- GTFS feeds: NYCT subway + all MTA bus companies + NYC Ferry only. No LIRR/Metro-North/SIR.
- `data/` is gitignored (large shapefiles, PDF, downloaded network files, processed outputs). Only code and specs are committed.
- Census API key lives in `.env` (gitignored) as `CENSUS_API_KEY`; never print or commit it.

---

## File Structure

```
pipeline/
  __init__.py
  config.py                  # constants: FIPS codes, sport-type columns, time windows, CRS, paths, GTFS URLs
  geography.py                # load/reproject NTA + tract shapefiles, validate join
  offsets.py                  # tract origin point + intra-tract walking offset (pure geometry)
  facilities.py                # load facilities, Active filter, per-sport-type GeoDataFrame builder
  census_client.py             # Census API group-fetch (raw estimates + variable labels)
  demographics.py               # label-driven category extraction + tract->NTA sum-then-percent aggregation
  network_acquisition.py        # download OSM extract + GTFS zips
  travel_time.py                 # r5py TransportNetwork + TravelTimeMatrix orchestration across sport types x windows
  aggregate_travel_time.py        # tract->NTA population-weighted travel time aggregation
  build_output.py                  # assemble + write final tract-level and NTA-level tables
run_pipeline.py                     # end-to-end orchestration script
tests/
  test_config.py
  test_geography.py
  test_offsets.py
  test_facilities.py
  test_census_client.py
  test_demographics.py
  test_travel_time.py
  test_aggregate_travel_time.py
  test_build_output.py
requirements.txt
pytest.ini
data/network/                          # gitignored: downloaded OSM + GTFS
data/processed/                         # gitignored: final output tables
```

---

### Task 1: Project scaffolding & dependencies

**Files:**
- Create: `requirements.txt`
- Create: `pytest.ini`
- Create: `pipeline/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/test_smoke.py`

**Interfaces:**
- Produces: an importable `pipeline` package and a working `pytest` command for all later tasks.

- [ ] **Step 1: Write `requirements.txt`**

```
geopandas>=0.14
shapely>=2.0
pandas>=2.0
requests>=2.31
python-dotenv>=1.0
pytest>=8.0
r5py>=1.1
```

- [ ] **Step 2: Write `pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 3: Create empty package files**

```bash
touch pipeline/__init__.py tests/__init__.py
```

- [ ] **Step 4: Write a smoke test**

```python
# tests/test_smoke.py
import pipeline


def test_package_imports():
    assert pipeline is not None
```

- [ ] **Step 5: Install dependencies and run the smoke test**

```bash
pip install -r requirements.txt
pytest tests/test_smoke.py -v
```
Expected: 1 passed. (`r5py` install requires a JDK 21+ already on PATH — verify with `java -version` before this step; if missing, install a JDK first, e.g. via conda-forge: `conda install -c conda-forge openjdk=21 r5py`.)

- [ ] **Step 6: Commit**

```bash
git add requirements.txt pytest.ini pipeline/__init__.py tests/__init__.py tests/test_smoke.py
git commit -m "chore: scaffold pipeline package and test runner"
```

---

### Task 2: Config module

**Files:**
- Create: `pipeline/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `NYC_COUNTY_FIPS: dict[str, str]`, `STATE_FIPS: str`, `SPORT_TYPE_COLUMNS: list[str]`, `TIME_WINDOWS: dict[str, dict]`, `INTRA_TRACT_WALK_SPEED_MPH: float`, `GTFS_URLS: dict[str, str]`, `CRS_GEOGRAPHIC: str`, `CRS_PROJECTED: str`, `DATA_DIR`, `NETWORK_DIR`, `PROCESSED_DIR`, `CENSUS_ACS_YEAR: int`.
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_config.py
import datetime
from pipeline import config


def test_county_fips_covers_five_boroughs():
    assert config.NYC_COUNTY_FIPS == {
        "Bronx": "005",
        "Kings": "047",
        "New York": "061",
        "Queens": "081",
        "Richmond": "085",
    }
    assert config.STATE_FIPS == "36"


def test_sport_type_columns_excludes_non_sport_attributes():
    # accessible/wheelchair are accessibility flags, nonregulat/regulation are
    # facility-size flags, primary_sp is a separate categorical field — none
    # of these are sport-type categories and must not be in this list.
    excluded = {"accessible", "wheelchair", "nonregulat", "regulation", "primary_sp", "featuresta"}
    assert excluded.isdisjoint(config.SPORT_TYPE_COLUMNS)
    assert "basketball" in config.SPORT_TYPE_COLUMNS
    assert len(config.SPORT_TYPE_COLUMNS) == 23


def test_time_windows_has_six_entries_with_start_and_duration():
    assert set(config.TIME_WINDOWS) == {
        "weekday_morning",
        "weekday_noon",
        "weekday_evening",
        "weekend_morning",
        "weekend_noon",
        "weekend_evening",
    }
    morning = config.TIME_WINDOWS["weekday_morning"]
    assert morning["start_time"] == datetime.time(7, 0)
    assert morning["duration"] == datetime.timedelta(hours=2)
    assert morning["is_weekend"] is False


def test_gtfs_urls_present_for_required_agencies():
    required = {
        "subway",
        "bus_manhattan",
        "bus_brooklyn",
        "bus_bronx",
        "bus_queens",
        "bus_staten_island",
        "bus_company",
        "ferry",
    }
    assert required == set(config.GTFS_URLS)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError` or `AttributeError` (config has no such names yet).

- [ ] **Step 3: Write `pipeline/config.py`**

```python
"""Project-wide constants for the transit-accessibility data pipeline.

See docs/superpowers/specs/2026-08-29-transit-accessibility-data-pipeline-design.md
for the rationale behind every value here.
"""
import datetime
from pathlib import Path

STATE_FIPS = "36"
NYC_COUNTY_FIPS = {
    "Bronx": "005",
    "Kings": "047",
    "New York": "061",
    "Queens": "081",
    "Richmond": "085",
}

CENSUS_ACS_YEAR = 2024  # 2020-2024 ACS 5-year estimates

# The Athletic Facilities shapefile has ~25 boolean columns; only these 23
# represent an actual sport/game. `accessible` and `wheelchair` are
# accessibility attributes, `nonregulat`/`regulation` describe field size,
# not what's played there.
SPORT_TYPE_COLUMNS = [
    "adult_base", "adult_foot", "adult_soft", "basketball", "bocce",
    "cricket", "flagfootba", "frisbee", "handball", "hockey", "kickball",
    "lacrosse", "ll_baseb_1", "ll_baseb_2", "ll_softbal", "netball",
    "pickleball", "rugby", "tennis", "track_and_", "t_ball", "volleyball",
    "youth_foot",
]

# Reference dates: must fall within the downloaded GTFS feeds' calendar
# validity window. Placeholder values below are checked/adjusted in Task 9
# Step 1 against the actual calendar.txt of the downloaded feeds.
REFERENCE_WEEKDAY = datetime.date(2026, 9, 15)   # a Tuesday
REFERENCE_WEEKEND_DAY = datetime.date(2026, 9, 19)  # a Saturday

TIME_WINDOWS = {
    "weekday_morning": {
        "date": REFERENCE_WEEKDAY, "start_time": datetime.time(7, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": False,
    },
    "weekday_noon": {
        "date": REFERENCE_WEEKDAY, "start_time": datetime.time(11, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": False,
    },
    "weekday_evening": {
        "date": REFERENCE_WEEKDAY, "start_time": datetime.time(17, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": False,
    },
    "weekend_morning": {
        "date": REFERENCE_WEEKEND_DAY, "start_time": datetime.time(9, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": True,
    },
    "weekend_noon": {
        "date": REFERENCE_WEEKEND_DAY, "start_time": datetime.time(11, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": True,
    },
    "weekend_evening": {
        "date": REFERENCE_WEEKEND_DAY, "start_time": datetime.time(17, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": True,
    },
}

INTRA_TRACT_WALK_SPEED_MPH = 3.0

GTFS_URLS = {
    "subway": "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
    "bus_manhattan": "http://web.mta.info/developers/data/nyct/bus/google_transit_manhattan.zip",
    "bus_brooklyn": "http://web.mta.info/developers/data/nyct/bus/google_transit_brooklyn.zip",
    "bus_bronx": "http://web.mta.info/developers/data/nyct/bus/google_transit_bronx.zip",
    "bus_queens": "http://web.mta.info/developers/data/nyct/bus/google_transit_queens.zip",
    "bus_staten_island": "http://web.mta.info/developers/data/nyct/bus/google_transit_staten_island.zip",
    "bus_company": "http://web.mta.info/developers/data/busco/google_transit.zip",
    "ferry": "http://nycferry.connexionz.net/rtt/public/resource/gtfs.zip",
}

CRS_GEOGRAPHIC = "EPSG:4326"   # WGS84, required by r5py
CRS_PROJECTED = "EPSG:2263"    # NY State Plane ft, matches source shapefiles

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
NETWORK_DIR = DATA_DIR / "network"
PROCESSED_DIR = DATA_DIR / "processed"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_config.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/config.py tests/test_config.py
git commit -m "feat: add pipeline config constants"
```

---

### Task 3: Geography loader

**Files:**
- Create: `pipeline/geography.py`
- Test: `tests/test_geography.py`

**Interfaces:**
- Consumes: `config.CRS_GEOGRAPHIC`, `config.CRS_PROJECTED`.
- Produces: `load_nta_boundaries() -> geopandas.GeoDataFrame` (columns include `NTA2020`, `NTAName`, `geometry`, projected CRS `EPSG:2263`), `load_census_tracts() -> geopandas.GeoDataFrame` (columns include `GEOID`, `NTA2020`, `geometry`, projected CRS `EPSG:2263`), `validate_tract_nta_join(tracts, ntas) -> None` (raises `ValueError` if any tract's `NTA2020` is missing or not present in the NTA layer).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_geography.py
import pytest
from pipeline import geography


def test_load_nta_boundaries_has_expected_shape():
    ntas = geography.load_nta_boundaries()
    assert len(ntas) == 262
    assert {"NTA2020", "NTAName", "geometry"}.issubset(ntas.columns)
    assert ntas.crs.to_string() == "EPSG:2263"


def test_load_census_tracts_has_expected_shape():
    tracts = geography.load_census_tracts()
    assert len(tracts) == 2325
    assert {"GEOID", "NTA2020", "geometry"}.issubset(tracts.columns)
    assert tracts.crs.to_string() == "EPSG:2263"


def test_validate_tract_nta_join_passes_on_real_data():
    tracts = geography.load_census_tracts()
    ntas = geography.load_nta_boundaries()
    geography.validate_tract_nta_join(tracts, ntas)  # must not raise


def test_validate_tract_nta_join_raises_on_orphan_tract():
    tracts = geography.load_census_tracts().copy()
    ntas = geography.load_nta_boundaries()
    tracts.loc[tracts.index[0], "NTA2020"] = "NOT_A_REAL_NTA_CODE"
    with pytest.raises(ValueError, match="NOT_A_REAL_NTA_CODE"):
        geography.validate_tract_nta_join(tracts, ntas)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_geography.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.geography'`.

- [ ] **Step 3: Write `pipeline/geography.py`**

```python
"""Loading and validating the NTA and census tract boundary shapefiles."""
import geopandas as gpd

from pipeline import config

NTA_SHAPEFILE = "data/nynta2020_26c/nynta2020_26c/nynta2020.shp"
TRACT_SHAPEFILE = "data/nyct2020_26c/nyct2020.shp"


def load_nta_boundaries() -> gpd.GeoDataFrame:
    ntas = gpd.read_file(NTA_SHAPEFILE)
    return ntas.to_crs(config.CRS_PROJECTED)


def load_census_tracts() -> gpd.GeoDataFrame:
    tracts = gpd.read_file(TRACT_SHAPEFILE)
    return tracts.to_crs(config.CRS_PROJECTED)


def validate_tract_nta_join(tracts: gpd.GeoDataFrame, ntas: gpd.GeoDataFrame) -> None:
    valid_nta_codes = set(ntas["NTA2020"])
    tract_nta_codes = tracts["NTA2020"]
    if tract_nta_codes.isna().any():
        missing_geoids = tracts.loc[tract_nta_codes.isna(), "GEOID"].tolist()
        raise ValueError(f"Tracts with missing NTA2020: {missing_geoids}")
    orphans = set(tract_nta_codes) - valid_nta_codes
    if orphans:
        raise ValueError(f"Tract NTA2020 codes not found in NTA layer: {orphans}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_geography.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/geography.py tests/test_geography.py
git commit -m "feat: add geography loader with tract-NTA join validation"
```

---

### Task 4: Tract origin point & intra-tract walking offset

**Files:**
- Create: `pipeline/offsets.py`
- Test: `tests/test_offsets.py`

**Interfaces:**
- Consumes: `config.INTRA_TRACT_WALK_SPEED_MPH`.
- Produces: `compute_origin_point(geometry: shapely.Geometry) -> shapely.Point`, `compute_walking_offset_minutes(geometry: shapely.Geometry, origin: shapely.Point, walk_speed_mph: float = config.INTRA_TRACT_WALK_SPEED_MPH) -> float`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_offsets.py
import math

from shapely.geometry import Point, Polygon

from pipeline import offsets


def test_origin_point_is_always_inside_polygon():
    # A concave "C" shape whose arithmetic centroid falls outside it.
    concave = Polygon([(0, 0), (10, 0), (10, 10), (7, 10), (7, 3), (3, 3), (3, 10), (0, 10)])
    origin = offsets.compute_origin_point(concave)
    assert concave.contains(origin) or concave.boundary.distance(origin) < 1e-9


def test_walking_offset_for_a_known_square():
    # 1000ft x 1000ft square (units match EPSG:2263, feet). Centroid at (500,500).
    # Corner distances to centroid = sqrt(500^2+500^2) = 707.1067..., all four equal,
    # so avg = 707.1067, half = 353.5534 ft. At 3.0 mph = 264 ft/min,
    # expected minutes = 353.5534 / 264 = 1.3391...
    square = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    origin = offsets.compute_origin_point(square)
    minutes = offsets.compute_walking_offset_minutes(square, origin, walk_speed_mph=3.0)
    feet_per_minute = 3.0 * 5280 / 60
    expected_half_avg_corner_distance = (math.sqrt(500**2 + 500**2)) / 2
    expected_minutes = expected_half_avg_corner_distance / feet_per_minute
    assert minutes == pytest.approx(expected_minutes, rel=1e-6)


def test_walking_offset_is_nonnegative_for_irregular_polygon():
    irregular = Polygon([(0, 0), (400, 0), (600, 300), (300, 900), (0, 500)])
    origin = offsets.compute_origin_point(irregular)
    minutes = offsets.compute_walking_offset_minutes(irregular, origin)
    assert minutes > 0
```

Add the missing import at the top: `import pytest` (needed for `pytest.approx`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_offsets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.offsets'`.

- [ ] **Step 3: Write `pipeline/offsets.py`**

```python
"""Tract origin point and intra-tract walking-time offset.

The origin point is a "point on surface" (shapely's representative_point),
not a naive centroid, so it never falls outside concave/oddly-shaped tracts.
The walking offset approximates the extra walk a resident who isn't
standing exactly at the origin point needs: it averages the distance from
the tract's bounding-box corners to the origin, halves it, and converts to
time at a fixed walking speed. This is independent of r5py's own internal
access/egress walk speed for the transit leg itself.
"""
import shapely.geometry

from pipeline import config


def compute_origin_point(geometry: shapely.geometry.base.BaseGeometry) -> shapely.geometry.Point:
    return geometry.representative_point()


def compute_walking_offset_minutes(
    geometry: shapely.geometry.base.BaseGeometry,
    origin: shapely.geometry.Point,
    walk_speed_mph: float = config.INTRA_TRACT_WALK_SPEED_MPH,
) -> float:
    min_x, min_y, max_x, max_y = geometry.bounds
    corners = [
        shapely.geometry.Point(min_x, min_y),
        shapely.geometry.Point(max_x, min_y),
        shapely.geometry.Point(max_x, max_y),
        shapely.geometry.Point(min_x, max_y),
    ]
    avg_corner_distance_ft = sum(origin.distance(c) for c in corners) / 4
    half_distance_ft = avg_corner_distance_ft / 2
    feet_per_minute = walk_speed_mph * 5280 / 60
    return half_distance_ft / feet_per_minute
```

Note: this assumes the input geometry is in a feet-based projected CRS (`EPSG:2263`, as produced by `pipeline.geography`). If a different CRS is ever used, the `5280` feet-per-mile conversion must change accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_offsets.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/offsets.py tests/test_offsets.py
git commit -m "feat: add tract origin point and intra-tract walking offset"
```

---

### Task 5: Athletic facility loading & per-sport-type filtering

**Files:**
- Create: `pipeline/facilities.py`
- Test: `tests/test_facilities.py`

**Interfaces:**
- Consumes: `config.SPORT_TYPE_COLUMNS`, `config.CRS_GEOGRAPHIC`.
- Produces: `load_active_facilities() -> geopandas.GeoDataFrame` (all Active facilities, reprojected to `EPSG:4326`), `facilities_for_sport_type(facilities: geopandas.GeoDataFrame, sport_type: str) -> geopandas.GeoDataFrame` (subset where that boolean column is `True`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_facilities.py
import geopandas as gpd
from shapely.geometry import Point

from pipeline import facilities


def _make_fake_facilities():
    return gpd.GeoDataFrame(
        {
            "featuresta": ["Active", "Removed", "Active", "Inactive"],
            "basketball": [True, True, False, True],
            "tennis": [False, True, True, False],
            "geometry": [Point(0, 0), Point(1, 1), Point(2, 2), Point(3, 3)],
        },
        crs="EPSG:4326",
    )


def test_load_active_facilities_filters_status_and_reprojects():
    active = facilities.load_active_facilities()
    assert (active["featuresta"] == "Active").all()
    assert active.crs.to_string() == "EPSG:4326"


def test_facilities_for_sport_type_filters_boolean_column():
    fake = _make_fake_facilities()
    active_only = fake[fake["featuresta"] == "Active"]
    basketball_facilities = facilities.facilities_for_sport_type(active_only, "basketball")
    assert len(basketball_facilities) == 1
    assert basketball_facilities.iloc[0].geometry == Point(0, 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_facilities.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.facilities'`.

- [ ] **Step 3: Write `pipeline/facilities.py`**

```python
"""Loading and filtering the athletic facilities shapefile."""
import geopandas as gpd

from pipeline import config

FACILITIES_SHAPEFILE = (
    "data/Athletic Facilities_20260829/"
    "geo_export_9aa1a825-babe-4113-8640-a1af14f8b6c1.shp"
)


def load_active_facilities() -> gpd.GeoDataFrame:
    facilities = gpd.read_file(FACILITIES_SHAPEFILE)
    active = facilities[facilities["featuresta"] == "Active"].copy()
    return active.to_crs(config.CRS_GEOGRAPHIC)


def facilities_for_sport_type(facilities: gpd.GeoDataFrame, sport_type: str) -> gpd.GeoDataFrame:
    if sport_type not in config.SPORT_TYPE_COLUMNS:
        raise ValueError(f"Unknown sport type column: {sport_type}")
    return facilities[facilities[sport_type] == True].copy()  # noqa: E712
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_facilities.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/facilities.py tests/test_facilities.py
git commit -m "feat: add facility loading and per-sport-type filtering"
```

---

### Task 6: Census API client

**Files:**
- Create: `pipeline/census_client.py`
- Test: `tests/test_census_client.py`

**Interfaces:**
- Consumes: `config.STATE_FIPS`, `config.NYC_COUNTY_FIPS`, `config.CENSUS_ACS_YEAR`, env var `CENSUS_API_KEY`.
- Produces: `fetch_acs_group(table_id: str) -> pandas.DataFrame` (columns: `GEOID`, `variable`, `label`, `estimate`; one row per tract per variable in the group), `fetch_group_labels(table_id: str) -> dict[str, str]` (maps variable code, e.g. `"B03002_012E"`, to its full Census label string, e.g. `"Estimate!!Total:!!Hispanic or Latino"`).

Why label-driven, not hardcoded variable-suffix lookups: exact numeric suffixes have historically shifted between ACS table revisions (e.g. `B16001` was recently restricted below PUMA level), while the underlying category label text ("Hispanic or Latino", "Foreign born:", "White alone") is far more stable. Matching on labels in `pipeline/demographics.py` (Task 7) is more robust than hardcoding `_0XX` suffixes for every one of the ~30 variables this pipeline needs.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_census_client.py
from unittest.mock import patch

import pandas as pd

from pipeline import census_client


FAKE_GROUP_RESPONSE = [
    ["GEOID", "NAME", "B03002_001E", "B03002_001EA", "B03002_012E", "B03002_012EA", "state", "county", "tract"],
    ["36061000100", "Census Tract 1, New York County, New York", "1500", "", "300", "", "36", "061", "000100"],
]

FAKE_GROUP_LABELS_RESPONSE = {
    "variables": {
        "B03002_001E": {"label": "Estimate!!Total:", "concept": "HISPANIC OR LATINO ORIGIN BY RACE"},
        "B03002_012E": {"label": "Estimate!!Total:!!Hispanic or Latino", "concept": "HISPANIC OR LATINO ORIGIN BY RACE"},
    }
}


def test_fetch_group_labels_maps_variable_to_label():
    with patch("pipeline.census_client.requests.get") as mock_get:
        mock_get.return_value.json.return_value = FAKE_GROUP_LABELS_RESPONSE
        mock_get.return_value.raise_for_status.return_value = None
        labels = census_client.fetch_group_labels("B03002")
    assert labels["B03002_012E"] == "Estimate!!Total:!!Hispanic or Latino"


def test_fetch_acs_group_returns_tidy_long_dataframe():
    with patch("pipeline.census_client.requests.get") as mock_get:
        mock_get.return_value.json.return_value = FAKE_GROUP_RESPONSE
        mock_get.return_value.raise_for_status.return_value = None
        df = census_client.fetch_acs_group("B03002")
    expected = pd.DataFrame(
        {
            "GEOID": ["36061000100", "36061000100"],
            "variable": ["B03002_001E", "B03002_012E"],
            "estimate": [1500.0, 300.0],
        }
    )
    pd.testing.assert_frame_equal(
        df[["GEOID", "variable", "estimate"]].reset_index(drop=True), expected
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_census_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.census_client'`.

- [ ] **Step 3: Write `pipeline/census_client.py`**

```python
"""Thin client for pulling ACS group data at census-tract level for NYC."""
import os

import pandas as pd
import requests

from pipeline import config

BASE_URL = "https://api.census.gov/data/{year}/acs/acs5"


def _api_key() -> str:
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        raise RuntimeError("CENSUS_API_KEY not set (check .env is loaded)")
    return key


def fetch_group_labels(table_id: str) -> dict[str, str]:
    url = f"{BASE_URL.format(year=config.CENSUS_ACS_YEAR)}/groups/{table_id}.json"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    variables = response.json()["variables"]
    return {code: meta["label"] for code, meta in variables.items() if code.endswith("E")}


def fetch_acs_group(table_id: str) -> pd.DataFrame:
    rows = []
    for county_fips in config.NYC_COUNTY_FIPS.values():
        response = requests.get(
            BASE_URL.format(year=config.CENSUS_ACS_YEAR),
            params={
                "get": f"group({table_id})",
                "for": "tract:*",
                "in": f"state:{config.STATE_FIPS}+county:{county_fips}",
                "key": _api_key(),
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        header, *data_rows = payload
        county_df = pd.DataFrame(data_rows, columns=header)
        estimate_columns = [c for c in header if c.endswith("E") and c.startswith(table_id)]
        long_df = county_df.melt(
            id_vars=["GEOID"], value_vars=estimate_columns, var_name="variable", value_name="estimate"
        )
        long_df["estimate"] = pd.to_numeric(long_df["estimate"], errors="coerce")
        rows.append(long_df)
    return pd.concat(rows, ignore_index=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_census_client.py -v`
Expected: 2 passed.

- [ ] **Step 5: Manually verify against the real Census API (not part of automated test suite — requires network + the real key)**

```bash
python -c "
from dotenv import load_dotenv
load_dotenv()
from pipeline import census_client
labels = census_client.fetch_group_labels('B03002')
print(labels.get('B03002_012E'))
df = census_client.fetch_acs_group('B03002')
print(df.shape)
print(df.head())
"
```
Expected: prints `Estimate!!Total:!!Hispanic or Latino`, then a DataFrame shape with rows = (number of NYC tracts) × (number of B03002 estimate variables), no exceptions.

- [ ] **Step 6: Commit**

```bash
git add pipeline/census_client.py tests/test_census_client.py
git commit -m "feat: add label-driven Census ACS group client"
```

---

### Task 7: Demographic category extraction & tract→NTA aggregation

**Files:**
- Create: `pipeline/demographics.py`
- Test: `tests/test_demographics.py`

**Interfaces:**
- Consumes: `census_client.fetch_acs_group`, `census_client.fetch_group_labels`, tract→NTA mapping (a `pandas.Series` or dict keyed by `GEOID` → `NTA2020`, as produced by `geography.load_census_tracts()[["GEOID", "NTA2020"]]`).
- Produces: `build_nta_demographics(tract_to_nta: pandas.DataFrame) -> pandas.DataFrame` — one row per NTA, columns: `NTA2020`, `pct_non_white`, `pct_immigrant`, `pct_asian`, `pct_hispanic_or_latino`, `pct_black_or_african_american`, `pct_two_or_more_races`, plus one `pct_foreign_born_{country_slug}` column per country found in the `B05006` group labels (detailed national origin, additional data per the spec).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_demographics.py
from unittest.mock import patch

import pandas as pd

from pipeline import demographics


TRACT_TO_NTA = pd.DataFrame(
    {"GEOID": ["36061000100", "36061000200"], "NTA2020": ["MN0101", "MN0101"]}
)

B03002_LABELS = {
    "B03002_001E": "Estimate!!Total:",
    "B03002_003E": "Estimate!!Total:!!Not Hispanic or Latino:!!White alone",
    # Real ACS labels carry a trailing colon on rows with further
    # sub-breakdowns (confirmed against the live API in Task 6) -- this
    # fixture intentionally includes it so the test exercises the
    # rstrip(":") handling in demographics.py, not a simplified label.
    "B03002_012E": "Estimate!!Total:!!Hispanic or Latino:",
}
B02001_LABELS = {
    "B02001_001E": "Estimate!!Total:",
    "B02001_003E": "Estimate!!Total:!!Black or African American alone",
    "B02001_005E": "Estimate!!Total:!!Asian alone",
    "B02001_008E": "Estimate!!Total:!!Two or more races:",
}
B05002_LABELS = {
    "B05002_001E": "Estimate!!Total:",
    "B05002_013E": "Estimate!!Total:!!Foreign born:",
}
B05006_LABELS = {
    "B05006_001E": "Estimate!!Total:",
    "B05006_050E": "Estimate!!Total:!!Latin America:!!Mexico",
}

B03002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000100",
                  "36061000200", "36061000200", "36061000200"],
        "variable": ["B03002_001E", "B03002_003E", "B03002_012E"] * 2,
        "estimate": [1000.0, 400.0, 300.0, 1000.0, 200.0, 500.0],
    }
)
B02001_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100"] * 4 + ["36061000200"] * 4,
        "variable": ["B02001_001E", "B02001_003E", "B02001_005E", "B02001_008E"] * 2,
        "estimate": [1000.0, 100.0, 150.0, 50.0, 1000.0, 200.0, 100.0, 30.0],
    }
)
B05002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B05002_001E", "B05002_013E"] * 2,
        "estimate": [1000.0, 250.0, 1000.0, 400.0],
    }
)
B05006_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B05006_001E", "B05006_050E"] * 2,
        "estimate": [250.0, 60.0, 400.0, 90.0],
    }
)


def _fake_fetch_group_labels(table_id):
    return {
        "B03002": B03002_LABELS, "B02001": B02001_LABELS,
        "B05002": B05002_LABELS, "B05006": B05006_LABELS,
    }[table_id]


def _fake_fetch_acs_group(table_id):
    return {
        "B03002": B03002_DATA, "B02001": B02001_DATA,
        "B05002": B05002_DATA, "B05006": B05006_DATA,
    }[table_id]


def test_build_nta_demographics_sums_before_dividing():
    with patch("pipeline.demographics.fetch_group_labels", side_effect=_fake_fetch_group_labels), \
         patch("pipeline.demographics.fetch_acs_group", side_effect=_fake_fetch_acs_group):
        result = demographics.build_nta_demographics(TRACT_TO_NTA)

    row = result[result["NTA2020"] == "MN0101"].iloc[0]
    # White alone (non-Hispanic) summed = 400+200=600, total summed=1000+1000=2000
    # non_white = 100 * (1 - 600/2000) = 70.0
    assert row["pct_non_white"] == pytest.approx(70.0)
    # Hispanic summed = 300+500=800, total=2000 -> 40.0
    assert row["pct_hispanic_or_latino"] == pytest.approx(40.0)
    # Black summed=100+200=300, total(B02001)=1000+1000=2000 -> 15.0
    assert row["pct_black_or_african_american"] == pytest.approx(15.0)
    # Asian summed=150+100=250 -> 12.5
    assert row["pct_asian"] == pytest.approx(12.5)
    # Two-or-more summed=50+30=80 -> 4.0
    assert row["pct_two_or_more_races"] == pytest.approx(4.0)
    # Foreign born summed=250+400=650, total(B05002)=1000+1000=2000 -> 32.5
    assert row["pct_immigrant"] == pytest.approx(32.5)
    # Detailed national origin: Mexico summed=60+90=150, total(B05006)=250+400=650 -> ~23.077
    assert row["pct_foreign_born_mexico"] == pytest.approx(100 * 150 / 650)
```

Add `import pytest` at the top of the test file for `pytest.approx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_demographics.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.demographics'`.

- [ ] **Step 3: Write `pipeline/demographics.py`**

```python
"""Label-driven demographic category extraction and tract->NTA aggregation.

Every percentage is computed by first summing raw ACS estimates across all
tracts belonging to an NTA, then dividing -- never by averaging tract-level
percentages. See spec section 2 for why.
"""
import re

import pandas as pd

from pipeline.census_client import fetch_acs_group, fetch_group_labels


def _variable_for_label(labels: dict[str, str], predicate) -> str:
    matches = [code for code, label in labels.items() if predicate(label)]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly 1 label match, got {matches}")
    return matches[0]


def _summed_by_nta(data: pd.DataFrame, variable: str, tract_to_nta: pd.DataFrame) -> pd.Series:
    merged = data[data["variable"] == variable].merge(tract_to_nta, on="GEOID", how="inner")
    return merged.groupby("NTA2020")["estimate"].sum()


def _country_slug(label: str) -> str:
    country_name = label.rsplit("!!", 1)[-1]
    slug = re.sub(r"[^a-z0-9]+", "_", country_name.lower()).strip("_")
    return slug


def build_nta_demographics(tract_to_nta: pd.DataFrame) -> pd.DataFrame:
    b03002_labels = fetch_group_labels("B03002")
    b03002_data = fetch_acs_group("B03002")
    b02001_labels = fetch_group_labels("B02001")
    b02001_data = fetch_acs_group("B02001")
    b05002_labels = fetch_group_labels("B05002")
    b05002_data = fetch_acs_group("B05002")
    b05006_labels = fetch_group_labels("B05006")
    b05006_data = fetch_acs_group("B05006")

    # Real ACS labels sometimes carry a trailing colon on category rows that
    # have further sub-breakdowns (e.g. "...Hispanic or Latino:" when the
    # table then breaks Hispanic/Latino down further) -- confirmed against
    # the live API in Task 6. Every endswith() check below strips a trailing
    # colon first so matching doesn't depend on whether a given vintage adds
    # or omits it.
    b03002_total_var = _variable_for_label(b03002_labels, lambda l: l == "Estimate!!Total:")
    white_alone_var = _variable_for_label(
        b03002_labels,
        lambda l: "Not Hispanic or Latino" in l and l.rstrip(":").endswith("White alone"),
    )
    hispanic_var = _variable_for_label(
        b03002_labels, lambda l: l.rstrip(":").endswith("Hispanic or Latino")
    )

    b02001_total_var = _variable_for_label(b02001_labels, lambda l: l == "Estimate!!Total:")
    black_var = _variable_for_label(b02001_labels, lambda l: "Black or African American alone" in l)
    asian_var = _variable_for_label(b02001_labels, lambda l: l.rstrip(":").endswith("Asian alone"))
    two_or_more_var = _variable_for_label(b02001_labels, lambda l: "Two or more races" in l)

    b05002_total_var = _variable_for_label(b05002_labels, lambda l: l == "Estimate!!Total:")
    foreign_born_var = _variable_for_label(b05002_labels, lambda l: "Foreign born" in l)

    b05006_total_var = _variable_for_label(b05006_labels, lambda l: l == "Estimate!!Total:")
    country_vars = {
        code: label for code, label in b05006_labels.items()
        if code != b05006_total_var and "!!" in label
    }

    b03002_total = _summed_by_nta(b03002_data, b03002_total_var, tract_to_nta)
    white_alone = _summed_by_nta(b03002_data, white_alone_var, tract_to_nta)
    hispanic = _summed_by_nta(b03002_data, hispanic_var, tract_to_nta)

    b02001_total = _summed_by_nta(b02001_data, b02001_total_var, tract_to_nta)
    black = _summed_by_nta(b02001_data, black_var, tract_to_nta)
    asian = _summed_by_nta(b02001_data, asian_var, tract_to_nta)
    two_or_more = _summed_by_nta(b02001_data, two_or_more_var, tract_to_nta)

    b05002_total = _summed_by_nta(b05002_data, b05002_total_var, tract_to_nta)
    foreign_born = _summed_by_nta(b05002_data, foreign_born_var, tract_to_nta)

    b05006_total = _summed_by_nta(b05006_data, b05006_total_var, tract_to_nta)

    result = pd.DataFrame({
        "NTA2020": b03002_total.index,
        "pct_non_white": 100 * (1 - white_alone / b03002_total),
        "pct_hispanic_or_latino": 100 * hispanic / b03002_total,
    })
    result = result.merge(
        pd.DataFrame({
            "NTA2020": b02001_total.index,
            "pct_black_or_african_american": 100 * black / b02001_total,
            "pct_asian": 100 * asian / b02001_total,
            "pct_two_or_more_races": 100 * two_or_more / b02001_total,
        }),
        on="NTA2020",
    )
    result = result.merge(
        pd.DataFrame({
            "NTA2020": b05002_total.index,
            "pct_immigrant": 100 * foreign_born / b05002_total,
        }),
        on="NTA2020",
    )

    for code, label in country_vars.items():
        slug = _country_slug(label)
        country_by_nta = _summed_by_nta(b05006_data, code, tract_to_nta)
        result[f"pct_foreign_born_{slug}"] = 100 * country_by_nta.reindex(result["NTA2020"]).values / b05006_total.reindex(result["NTA2020"]).values

    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_demographics.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/demographics.py tests/test_demographics.py
git commit -m "feat: add label-driven demographic aggregation to NTA level"
```

---

### Task 8: OSM + GTFS network data acquisition

**Files:**
- Create: `pipeline/network_acquisition.py`
- Test: `tests/test_network_acquisition.py`

**Interfaces:**
- Consumes: `config.GTFS_URLS`, `config.NETWORK_DIR`.
- Produces: `download_gtfs_feeds() -> list[pathlib.Path]` (one path per downloaded+validated GTFS zip in `NETWORK_DIR`), `download_osm_extract(url: str) -> pathlib.Path` (downloads the Geofabrik NY extract to `NETWORK_DIR`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_network_acquisition.py
import zipfile
from unittest.mock import patch, MagicMock

from pipeline import network_acquisition


def test_download_gtfs_feeds_writes_valid_zip_files(tmp_path, monkeypatch):
    monkeypatch.setattr(network_acquisition.config, "NETWORK_DIR", tmp_path)
    monkeypatch.setattr(
        network_acquisition.config, "GTFS_URLS", {"subway": "http://example.com/gtfs_subway.zip"}
    )

    fake_response = MagicMock()
    fake_response.iter_content.return_value = [b"PK\x03\x04fakezipbytes"]
    fake_response.raise_for_status.return_value = None

    with patch("pipeline.network_acquisition.requests.get", return_value=fake_response):
        with patch("pipeline.network_acquisition.zipfile.is_zipfile", return_value=True):
            paths = network_acquisition.download_gtfs_feeds()

    assert len(paths) == 1
    assert paths[0].name == "subway.zip"
    assert paths[0].exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_network_acquisition.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.network_acquisition'`.

- [ ] **Step 3: Write `pipeline/network_acquisition.py`**

```python
"""Downloading OSM extract and GTFS static feeds for r5py."""
import zipfile
from pathlib import Path

import requests

from pipeline import config


def _download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with open(destination, "wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    return destination


def download_gtfs_feeds() -> list[Path]:
    paths = []
    for name, url in config.GTFS_URLS.items():
        destination = config.NETWORK_DIR / f"{name}.zip"
        _download(url, destination)
        if not zipfile.is_zipfile(destination):
            raise ValueError(f"Downloaded file for '{name}' is not a valid zip: {destination}")
        paths.append(destination)
    return paths


def download_osm_extract(url: str) -> Path:
    destination = config.NETWORK_DIR / "new-york.osm.pbf"
    return _download(url, destination)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_network_acquisition.py -v`
Expected: 1 passed.

- [ ] **Step 5: Download the real network data (manual, not part of automated tests — large files, real network access)**

```bash
python -c "
from pipeline import network_acquisition
paths = network_acquisition.download_gtfs_feeds()
print('Downloaded:', paths)
"
```
Then download a Geofabrik New York extract (check https://download.geofabrik.de/north-america/us/new-york.html for the current `.osm.pbf` URL, since Geofabrik doesn't publish a permanently stable URL guaranteed not to move) and clip it to the 5-borough bounding box using `osmium extract` or `osmconvert` if the statewide extract is larger than needed:
```bash
python -c "
from pipeline import network_acquisition
network_acquisition.download_osm_extract('<geofabrik-new-york-url-confirmed-at-runtime>')
"
```
Verify both: `ls data/network/` should show `subway.zip`, `bus_manhattan.zip`, `bus_brooklyn.zip`, `bus_bronx.zip`, `bus_queens.zip`, `bus_staten_island.zip`, `bus_company.zip`, `ferry.zip`, `new-york.osm.pbf`.

- [ ] **Step 6: Commit**

```bash
git add pipeline/network_acquisition.py tests/test_network_acquisition.py
git commit -m "feat: add OSM/GTFS network data acquisition"
```

---

### Task 9: r5py travel-time matrix computation

**Files:**
- Create: `pipeline/travel_time.py`
- Test: `tests/test_travel_time.py`

**Interfaces:**
- Consumes: `config.SPORT_TYPE_COLUMNS`, `config.TIME_WINDOWS`, `config.NETWORK_DIR`, `offsets.compute_origin_point`, `offsets.compute_walking_offset_minutes`, `facilities.facilities_for_sport_type`.
- Produces: `build_transport_network() -> r5py.TransportNetwork`, `compute_nearest_facility_times(transport_network, tract_origins: geopandas.GeoDataFrame, facilities_by_sport_type: dict[str, geopandas.GeoDataFrame], tract_offsets_minutes: dict[str, float]) -> pandas.DataFrame` — one row per `(GEOID, sport_type, window_name)`, columns `GEOID`, `sport_type`, `window_name`, `travel_time_minutes` (already offset-adjusted, `NaN` if unreachable within `max_time`).

This is the heaviest, longest-running task. The computation itself (`r5py.TravelTimeMatrix`) is not unit-tested directly — it requires a JVM, a real OSM+GTFS network, and can take a long time per call. Instead, the orchestration logic (looping over sport types/windows, applying the offset, taking the per-tract minimum) is unit-tested against a fake matrix-computing function injected as a parameter, and the real r5py call is exercised once in a manual smoke-run step on a tiny subset.

- [ ] **Step 1: Verify the reference dates against the downloaded GTFS calendar (manual, before writing code)**

```bash
python -c "
import zipfile, pandas as pd
with zipfile.ZipFile('data/network/subway.zip') as z:
    with z.open('calendar.txt') as f:
        print(pd.read_csv(f))
"
```
Confirm `config.REFERENCE_WEEKDAY` and `config.REFERENCE_WEEKEND_DAY` fall within the printed `start_date`/`end_date` range and match an active weekday/Saturday service_id. Update the two constants in `pipeline/config.py` if not.

- [ ] **Step 2: Write the failing test for the orchestration logic**

```python
# tests/test_travel_time.py
import pandas as pd

from pipeline import travel_time


def _fake_matrix_fn(transport_network, origins, destinations, departure, departure_time_window, percentiles):
    # Every origin can reach every destination in a fixed 10.0-minute base time,
    # so the test only needs to check offset application and per-tract min-take.
    rows = []
    for from_id in origins["id"]:
        for to_id in destinations["id"]:
            rows.append({"from_id": from_id, "to_id": to_id, "travel_time": 10.0})
    return pd.DataFrame(rows)


def test_compute_nearest_facility_times_applies_offset_and_takes_min(monkeypatch):
    import geopandas as gpd
    from shapely.geometry import Point

    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1", "T2"], "geometry": [Point(0, 0), Point(1, 1)]}, crs="EPSG:4326"
    )
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame(
            {"id": ["F1", "F2"], "geometry": [Point(0, 0), Point(2, 2)]}, crs="EPSG:4326"
        )
    }
    tract_offsets_minutes = {"T1": 2.0, "T2": 5.0}

    monkeypatch.setattr(travel_time, "_run_matrix", _fake_matrix_fn)

    result = travel_time.compute_nearest_facility_times(
        transport_network=None,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        tract_offsets_minutes=tract_offsets_minutes,
        window_names=["weekday_morning"],
    )

    t1_row = result[(result["GEOID"] == "T1") & (result["sport_type"] == "basketball")].iloc[0]
    t2_row = result[(result["GEOID"] == "T2") & (result["sport_type"] == "basketball")].iloc[0]
    assert t1_row["travel_time_minutes"] == pytest.approx(12.0)  # 10.0 base + 2.0 offset
    assert t2_row["travel_time_minutes"] == pytest.approx(15.0)  # 10.0 base + 5.0 offset
```

Add `import pytest` to the top of the test file.

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_travel_time.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.travel_time'`.

- [ ] **Step 4: Write `pipeline/travel_time.py`**

```python
"""r5py-based transit travel-time computation, per sport type per time window."""
import datetime

import geopandas as gpd
import pandas as pd

from pipeline import config


def build_transport_network():
    import r5py  # imported lazily so unit tests don't require a JVM

    gtfs_paths = [str(p) for p in config.NETWORK_DIR.glob("*.zip")]
    osm_path = str(config.NETWORK_DIR / "new-york.osm.pbf")
    return r5py.TransportNetwork(osm_path, gtfs=gtfs_paths)


def _run_matrix(transport_network, origins, destinations, departure, departure_time_window, percentiles):
    import r5py  # imported lazily so unit tests don't require a JVM

    return r5py.TravelTimeMatrix(
        transport_network,
        origins=origins,
        destinations=destinations,
        transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        departure=departure,
        departure_time_window=departure_time_window,
        percentiles=percentiles,
    )


def compute_nearest_facility_times(
    transport_network,
    tract_origins: gpd.GeoDataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
    tract_offsets_minutes: dict[str, float],
    window_names: list[str] | None = None,
) -> pd.DataFrame:
    window_names = window_names or list(config.TIME_WINDOWS)
    origins = tract_origins.rename(columns={"GEOID": "id"})[["id", "geometry"]]

    all_rows = []
    for window_name in window_names:
        window = config.TIME_WINDOWS[window_name]
        departure = datetime.datetime.combine(window["date"], window["start_time"])

        for sport_type, destinations in facilities_by_sport_type.items():
            matrix = _run_matrix(
                transport_network,
                origins=origins,
                destinations=destinations[["id", "geometry"]],
                departure=departure,
                departure_time_window=window["duration"],
                percentiles=[50],
            )
            time_column = "travel_time" if "travel_time" in matrix.columns else "travel_time_p50"
            matrix = matrix.rename(columns={time_column: "travel_time"})
            matrix["travel_time"] = matrix["travel_time"] + matrix["from_id"].map(tract_offsets_minutes)

            nearest = matrix.groupby("from_id")["travel_time"].min().reset_index()
            nearest = nearest.rename(columns={"from_id": "GEOID", "travel_time": "travel_time_minutes"})
            nearest["sport_type"] = sport_type
            nearest["window_name"] = window_name
            all_rows.append(nearest)

    return pd.concat(all_rows, ignore_index=True)[
        ["GEOID", "sport_type", "window_name", "travel_time_minutes"]
    ]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_travel_time.py -v`
Expected: 1 passed.

- [ ] **Step 6: Manual smoke run on a tiny real subset (requires JDK 21+, the downloaded network data from Task 8, and can take several minutes for the network build)**

```bash
python -c "
import geopandas as gpd
from pipeline import geography, facilities, offsets, travel_time

# offsets.compute_walking_offset_minutes assumes a feet-based CRS, so the
# offset is computed on the projected (EPSG:2263) geometry; only the
# resulting origin *point* is reprojected to WGS84 for r5py, matching
# run_pipeline.py's approach.
tracts = geography.load_census_tracts().head(3)
tracts['origin_point'] = tracts.geometry.apply(offsets.compute_origin_point)
tract_offsets = {
    row.GEOID: offsets.compute_walking_offset_minutes(row.geometry, row.origin_point)
    for row in tracts.itertuples()
}
origin_points_geo = gpd.GeoSeries(tracts['origin_point'], crs='EPSG:2263').to_crs('EPSG:4326')
tract_origins = gpd.GeoDataFrame(
    {'GEOID': tracts['GEOID'], 'geometry': origin_points_geo}, crs='EPSG:4326'
)

active = facilities.load_active_facilities()
basketball = facilities.facilities_for_sport_type(active, 'basketball').head(20)
basketball['id'] = basketball['gispropnum']

network = travel_time.build_transport_network()
result = travel_time.compute_nearest_facility_times(
    network, tract_origins, {'basketball': basketball}, tract_offsets,
    window_names=['weekday_morning'],
)
print(result)
"
```
Expected: a 3-row DataFrame (one per tract), `travel_time_minutes` populated (not all `NaN`), no exceptions from the JVM bridge.

- [ ] **Step 7: Commit**

```bash
git add pipeline/travel_time.py tests/test_travel_time.py
git commit -m "feat: add r5py travel-time matrix orchestration per sport type and window"
```

---

### Task 10: Tract→NTA population-weighted travel-time aggregation

**Files:**
- Create: `pipeline/aggregate_travel_time.py`
- Test: `tests/test_aggregate_travel_time.py`

**Interfaces:**
- Consumes: output of `travel_time.compute_nearest_facility_times` (columns `GEOID`, `sport_type`, `window_name`, `travel_time_minutes`), tract→NTA mapping, tract population (a `pandas.Series` keyed by `GEOID`, e.g. from `B05002_001E`/`B02001_001E` total population already fetched in Task 7).
- Produces: `aggregate_to_nta(tract_times: pandas.DataFrame, tract_to_nta: pandas.DataFrame, tract_population: pandas.Series) -> pandas.DataFrame` — one row per `(NTA2020, sport_type, window_name)`, column `travel_time_minutes` = population-weighted average across that NTA's tracts. Tracts with `NaN` travel time (unreachable) are excluded from both the weighted sum and the weight total for that row, not treated as zero.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_aggregate_travel_time.py
import pandas as pd
import pytest

from pipeline import aggregate_travel_time


TRACT_TIMES = pd.DataFrame({
    "GEOID": ["T1", "T2", "T3"],
    "sport_type": ["basketball"] * 3,
    "window_name": ["weekday_morning"] * 3,
    "travel_time_minutes": [10.0, 20.0, None],
})
TRACT_TO_NTA = pd.DataFrame({"GEOID": ["T1", "T2", "T3"], "NTA2020": ["N1", "N1", "N1"]})
TRACT_POPULATION = pd.Series({"T1": 100, "T2": 300, "T3": 500})


def test_aggregate_to_nta_is_population_weighted_and_ignores_nan():
    result = aggregate_travel_time.aggregate_to_nta(TRACT_TIMES, TRACT_TO_NTA, TRACT_POPULATION)
    row = result[
        (result["NTA2020"] == "N1")
        & (result["sport_type"] == "basketball")
        & (result["window_name"] == "weekday_morning")
    ].iloc[0]
    # T3 is NaN and must be excluded entirely (not weighted as 0 population):
    # weighted avg = (10*100 + 20*300) / (100+300) = 7000/400 = 17.5
    assert row["travel_time_minutes"] == pytest.approx(17.5)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_aggregate_travel_time.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.aggregate_travel_time'`.

- [ ] **Step 3: Write `pipeline/aggregate_travel_time.py`**

```python
"""Population-weighted aggregation of tract-level travel times to NTA level."""
import pandas as pd


def aggregate_to_nta(
    tract_times: pd.DataFrame,
    tract_to_nta: pd.DataFrame,
    tract_population: pd.Series,
) -> pd.DataFrame:
    merged = tract_times.merge(tract_to_nta, on="GEOID", how="inner")
    merged["population"] = merged["GEOID"].map(tract_population)
    merged = merged.dropna(subset=["travel_time_minutes"])
    merged["weighted_time"] = merged["travel_time_minutes"] * merged["population"]

    grouped = merged.groupby(["NTA2020", "sport_type", "window_name"]).agg(
        weighted_time_sum=("weighted_time", "sum"),
        population_sum=("population", "sum"),
    ).reset_index()
    grouped["travel_time_minutes"] = grouped["weighted_time_sum"] / grouped["population_sum"]
    return grouped[["NTA2020", "sport_type", "window_name", "travel_time_minutes"]]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_aggregate_travel_time.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/aggregate_travel_time.py tests/test_aggregate_travel_time.py
git commit -m "feat: add population-weighted tract-to-NTA travel time aggregation"
```

---

### Task 11: Output assembly

**Files:**
- Create: `pipeline/build_output.py`
- Test: `tests/test_build_output.py`

**Interfaces:**
- Consumes: `demographics.build_nta_demographics`, `aggregate_travel_time.aggregate_to_nta`, `geography.load_nta_boundaries`.
- Produces: `write_nta_output(nta_demographics: pandas.DataFrame, nta_travel_times: pandas.DataFrame, nta_boundaries: geopandas.GeoDataFrame, output_path: pathlib.Path) -> None` — writes a GeoJSON with one row per NTA, demographic columns wide, and travel-time columns pivoted wide as `travel_time_{sport_type}_{window_name}`. `write_tract_output(tract_times: pandas.DataFrame, tract_to_nta: pandas.DataFrame, output_path: pathlib.Path) -> None` — writes a CSV, tract times pivoted the same way plus `NTA2020`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_build_output.py
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from pipeline import build_output


def test_write_nta_output_pivots_travel_times_wide(tmp_path):
    nta_demographics = pd.DataFrame({"NTA2020": ["N1", "N2"], "pct_non_white": [50.0, 80.0]})
    nta_travel_times = pd.DataFrame({
        "NTA2020": ["N1", "N1", "N2", "N2"],
        "sport_type": ["basketball", "tennis", "basketball", "tennis"],
        "window_name": ["weekday_morning"] * 4,
        "travel_time_minutes": [12.0, 18.0, 9.0, 22.0],
    })
    nta_boundaries = gpd.GeoDataFrame(
        {"NTA2020": ["N1", "N2"], "geometry": [Point(0, 0), Point(1, 1)]}, crs="EPSG:4326"
    )
    output_path = tmp_path / "nta_output.geojson"

    build_output.write_nta_output(nta_demographics, nta_travel_times, nta_boundaries, output_path)

    result = gpd.read_file(output_path)
    assert set(["N1", "N2"]) == set(result["NTA2020"])
    n1 = result[result["NTA2020"] == "N1"].iloc[0]
    assert n1["travel_time_basketball_weekday_morning"] == pytest.approx(12.0)
    assert n1["travel_time_tennis_weekday_morning"] == pytest.approx(18.0)
    assert n1["pct_non_white"] == pytest.approx(50.0)
```

Add `import pytest` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_build_output.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.build_output'`.

- [ ] **Step 3: Write `pipeline/build_output.py`**

```python
"""Assembling and writing the final tract-level and NTA-level output tables."""
from pathlib import Path

import geopandas as gpd
import pandas as pd


def _pivot_wide(travel_times: pd.DataFrame, id_column: str) -> pd.DataFrame:
    travel_times = travel_times.copy()
    travel_times["column"] = "travel_time_" + travel_times["sport_type"] + "_" + travel_times["window_name"]
    return travel_times.pivot(index=id_column, columns="column", values="travel_time_minutes").reset_index()


def write_nta_output(
    nta_demographics: pd.DataFrame,
    nta_travel_times: pd.DataFrame,
    nta_boundaries: gpd.GeoDataFrame,
    output_path: Path,
) -> None:
    wide_times = _pivot_wide(nta_travel_times, "NTA2020")
    merged = nta_boundaries.merge(nta_demographics, on="NTA2020", how="left")
    merged = merged.merge(wide_times, on="NTA2020", how="left")
    merged.to_file(output_path, driver="GeoJSON")


def write_tract_output(
    tract_times: pd.DataFrame,
    tract_to_nta: pd.DataFrame,
    output_path: Path,
) -> None:
    wide_times = _pivot_wide(tract_times, "GEOID")
    merged = wide_times.merge(tract_to_nta, on="GEOID", how="left")
    merged.to_csv(output_path, index=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_build_output.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/build_output.py tests/test_build_output.py
git commit -m "feat: add tract and NTA output table assembly"
```

---

### Task 12: End-to-end orchestration and full real run

**Files:**
- Create: `run_pipeline.py`

**Interfaces:**
- Consumes: every module above.
- Produces: `data/processed/nta_output.geojson`, `data/processed/tract_output.csv` (both gitignored).

- [ ] **Step 1: Write `run_pipeline.py`**

```python
"""End-to-end orchestration: run once after Tasks 1-11 are all committed."""
import geopandas as gpd
from dotenv import load_dotenv

from pipeline import (
    aggregate_travel_time,
    build_output,
    census_client,
    config,
    demographics,
    facilities,
    geography,
    offsets,
    travel_time,
)

load_dotenv()


def main():
    print("Loading geography...")
    tracts = geography.load_census_tracts()
    ntas = geography.load_nta_boundaries()
    geography.validate_tract_nta_join(tracts, ntas)
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    print("Computing tract origin points and intra-tract offsets...")
    # Origin point and offset are computed once in the projected (feet-based)
    # CRS, since compute_walking_offset_minutes assumes feet. The same point
    # geometry is then reprojected (not recomputed) to WGS84 for r5py, so the
    # routing origin and the offset calculation always agree on one point.
    tracts["origin_point"] = tracts.geometry.apply(offsets.compute_origin_point)
    tract_offsets = {
        row.GEOID: offsets.compute_walking_offset_minutes(row.geometry, row.origin_point)
        for row in tracts.itertuples()
    }
    origin_points_geo = gpd.GeoSeries(tracts["origin_point"], crs=config.CRS_PROJECTED).to_crs(
        config.CRS_GEOGRAPHIC
    )
    tract_origins = gpd.GeoDataFrame(
        {"GEOID": tracts["GEOID"], "geometry": origin_points_geo}, crs=config.CRS_GEOGRAPHIC
    )

    print("Fetching demographic data...")
    nta_demographics = demographics.build_nta_demographics(tract_to_nta)
    tract_population = census_client.fetch_acs_group("B02001")
    tract_population = (
        tract_population[tract_population["variable"].str.endswith("_001E")]
        .set_index("GEOID")["estimate"]
    )

    print("Loading and filtering athletic facilities...")
    active_facilities = facilities.load_active_facilities()
    facilities_by_sport_type = {
        sport: facilities.facilities_for_sport_type(active_facilities, sport).assign(
            id=lambda df: df["gispropnum"]
        )
        for sport in config.SPORT_TYPE_COLUMNS
    }

    print("Building r5py transport network (this can take several minutes)...")
    network = travel_time.build_transport_network()

    print("Computing travel-time matrices (this can take hours for the full dataset)...")
    tract_times = travel_time.compute_nearest_facility_times(
        network, tract_origins, facilities_by_sport_type, tract_offsets
    )

    print("Aggregating travel times to NTA level...")
    nta_times = aggregate_travel_time.aggregate_to_nta(tract_times, tract_to_nta, tract_population)

    print("Writing output tables...")
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    build_output.write_tract_output(tract_times, tract_to_nta, config.PROCESSED_DIR / "tract_output.csv")
    build_output.write_nta_output(
        nta_demographics, nta_times, ntas.to_crs(config.CRS_GEOGRAPHIC), config.PROCESSED_DIR / "nta_output.geojson"
    )
    print("Done.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the full pipeline against real NYC data**

```bash
python run_pipeline.py
```
Expected: runs to completion without exceptions (this is a long-running step — full 2,325 tracts × 23 sport types × 6 windows; if runtime is impractically long, consider running per-sport-type batches and checkpointing intermediate `tract_times` results to disk before aggregation, rather than holding the whole computation in one process).

- [ ] **Step 3: Sanity-check the output**

```bash
python -c "
import geopandas as gpd
import pandas as pd

nta = gpd.read_file('data/processed/nta_output.geojson')
tract = pd.read_csv('data/processed/tract_output.csv')

assert len(nta) == 262, len(nta)
assert len(tract) == 2325, len(tract)
assert nta['pct_non_white'].notna().mean() > 0.9
print('NTA columns:', list(nta.columns))
print('Non-null travel-time rate (basketball, weekday morning):',
      nta['travel_time_basketball_weekday_morning'].notna().mean())
"
```
Expected: no assertion errors; a printed non-null rate close to 1.0 (a handful of transit-desert NTAs may legitimately be `NaN` if unreachable within `max_time`).

- [ ] **Step 4: Commit**

```bash
git add run_pipeline.py
git commit -m "feat: add end-to-end pipeline orchestration script"
```

---

## Self-Review Notes

- **Spec coverage:** Geography/joins → Task 3. Demographic categories (6 + national origin) → Tasks 6-7. Facility filtering/typing → Task 5. r5py network + 6 time windows + intra-tract offset → Tasks 4, 8-9. Tract→NTA population-weighted aggregation → Task 10. Output tables → Task 11. Full run → Task 12.
- **Placeholder scan:** No TBD/TODO; the only forward-reference is `REFERENCE_WEEKDAY`/`REFERENCE_WEEKEND_DAY`, which is handled by an explicit verification step (Task 9, Step 1) rather than left vague.
- **Type consistency:** `GEOID` and `NTA2020` are used consistently as the join keys across `geography`, `demographics`, `travel_time`, `aggregate_travel_time`, and `build_output`. `sport_type`/`window_name`/`travel_time_minutes` column names are consistent from Task 9 through Task 11.
- **Scope:** This plan stops at the two output tables. No dashboard, UI, or Mapbox integration code is included — that is explicitly a separate future phase per the spec.
