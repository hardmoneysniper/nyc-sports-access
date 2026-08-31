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


def test_load_active_facilities_synthesizes_soccer_from_regulation_flags():
    # Soccer has no native boolean column anywhere in the shapefile's schema
    # (unlike every other primary_sp category) -- load_active_facilities
    # synthesizes one from regulation | nonregulat (per project owner domain
    # knowledge: either flag being true means a field can host soccer).
    # primary_sp == "SCR" / system-text matching were considered and
    # explicitly rejected as the basis for this (they undercount).
    active = facilities.load_active_facilities()
    assert "soccer" in active.columns
    assert (active["soccer"] == (active["regulation"] | active["nonregulat"])).all()
    soccer_facilities = facilities.facilities_for_sport_type(active, "soccer")
    # Verified count on the real Active-only data as of 2026-08-29.
    assert len(soccer_facilities) == 370
    assert (soccer_facilities["regulation"] | soccer_facilities["nonregulat"]).all()


def test_facilities_for_sport_type_soccer_ignores_primary_sp_and_system():
    # A facility can host soccer via regulation/nonregulat regardless of its
    # primary_sp classification or system text -- these must NOT gate
    # inclusion (this was the rejected approach: primary_sp=="SCR" alone
    # undercounts by not capturing multi-use fields like MPPA/football
    # fields that are also soccer-capable per their size flags).
    fake = gpd.GeoDataFrame(
        {
            "featuresta": ["Active", "Active"],
            "regulation": [True, False],
            "nonregulat": [False, True],
            "primary_sp": ["FTB", "MPPA"],
            "system": ["B001-FOOTBALL-1", "B002-MPPA-1"],
            "geometry": [Point(0, 0), Point(1, 1)],
        },
        crs="EPSG:4326",
    )
    fake["soccer"] = fake["regulation"] | fake["nonregulat"]
    soccer_facilities = facilities.facilities_for_sport_type(fake, "soccer")
    assert len(soccer_facilities) == 2
