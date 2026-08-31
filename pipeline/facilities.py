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
    # Soccer has no boolean flag anywhere in this shapefile's schema (unlike
    # every other primary_sp category, which has at least one corresponding
    # boolean column). Per project owner domain knowledge, a facility's
    # `regulation`/`nonregulat` flags (generic field-size attributes for
    # every sport) specifically indicate a field that can host soccer when
    # either is set -- primary_sp/system text matching were considered and
    # explicitly rejected as the basis for this (they undercount: 298-316
    # depending on method, vs. 370 via regulation/nonregulat).
    active["soccer"] = active["regulation"] | active["nonregulat"]
    return active.to_crs(config.CRS_GEOGRAPHIC)


def facilities_for_sport_type(facilities: gpd.GeoDataFrame, sport_type: str) -> gpd.GeoDataFrame:
    if sport_type not in config.SPORT_TYPE_COLUMNS:
        raise ValueError(f"Unknown sport type column: {sport_type}")
    return facilities[facilities[sport_type] == True].copy()  # noqa: E712
