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

# Not used until the dashboard design phase (per project owner instruction,
# 2026-08-31) -- defined now so the mapping exists alongside the columns it
# describes, but no pipeline or output code reads this yet.
#
# Groups sub-type columns (e.g. adult/Little-League/tee-ball baseball
# variants) under one display category, so a future dashboard filter can
# treat them as a single "sport type" -- the nearest facility for a group is
# just min() across its member columns' precomputed travel times, no
# recomputation needed. Every SPORT_TYPE_COLUMNS entry appears in exactly one
# group; sports with no naming variant in this dataset are single-item
# groups. `regulation`/`nonregulat` are field-size attributes, not sport
# variants, and are not part of this mapping (already excluded from
# SPORT_TYPE_COLUMNS entirely).
SPORT_TYPE_GROUPS = {
    "baseball": ["adult_base", "ll_baseb_1", "ll_baseb_2", "t_ball"],
    "softball": ["adult_soft", "ll_softbal"],
    "football": ["adult_foot", "flagfootba", "youth_foot"],
    "basketball": ["basketball"],
    "bocce": ["bocce"],
    "cricket": ["cricket"],
    "frisbee": ["frisbee"],
    "handball": ["handball"],
    "hockey": ["hockey"],
    "kickball": ["kickball"],
    "lacrosse": ["lacrosse"],
    "netball": ["netball"],
    "pickleball": ["pickleball"],
    "rugby": ["rugby"],
    "tennis": ["tennis"],
    "track_and_field": ["track_and_"],
    "volleyball": ["volleyball"],
}

# Reference dates: must fall within the downloaded GTFS feeds' calendar
# validity window. Values below were re-validated in Task 12 Step 1 against
# the actual calendar.txt of all freshly re-downloaded feeds (subway, ferry,
# and all six bus feeds) -- not just subway's. NYC bus GTFS feeds publish a
# short rolling validity window (the previous 2026-09-15/19 placeholders,
# valid against subway/ferry, were already outside every bus feed's window,
# which ended 2026-09-04/05 at the time of this run); these dates were
# chosen to fall inside the intersection of all eight feeds' windows.
REFERENCE_WEEKDAY = datetime.date(2026, 9, 1)   # a Tuesday
REFERENCE_WEEKEND_DAY = datetime.date(2026, 9, 5)  # a Saturday

TIME_WINDOWS = {
    "weekday_morning": {
        "date": REFERENCE_WEEKDAY, "start_time": datetime.time(7, 0),
        "duration": datetime.timedelta(hours=2), "is_weekend": False,
    },
    "weekday_noon": {
        "date": REFERENCE_WEEKDAY, "start_time": datetime.time(11, 0),
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

# Stable Geofabrik perma-alias that 302-redirects to the current dated
# snapshot. Confirmed live/working when this was downloaded for real (see
# docs/superpowers/plans/2026-08-29-transit-accessibility-data-pipeline.md).
OSM_EXTRACT_URL = "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"

CRS_GEOGRAPHIC = "EPSG:4326"   # WGS84, required by r5py
CRS_PROJECTED = "EPSG:2263"    # NY State Plane ft, matches source shapefiles

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
NETWORK_DIR = DATA_DIR / "network"
PROCESSED_DIR = DATA_DIR / "processed"
