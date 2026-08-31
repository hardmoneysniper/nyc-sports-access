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


def test_load_active_facilities_synthesizes_soccer_from_primary_sp():
    # Soccer has no native boolean column anywhere in the shapefile's schema
    # (unlike every other primary_sp category) -- load_active_facilities
    # synthesizes one from primary_sp == "SCR".
    active = facilities.load_active_facilities()
    assert "soccer" in active.columns
    assert (active["soccer"] == (active["primary_sp"] == "SCR")).all()
    soccer_facilities = facilities.facilities_for_sport_type(active, "soccer")
    assert len(soccer_facilities) > 0
    assert (soccer_facilities["primary_sp"] == "SCR").all()
