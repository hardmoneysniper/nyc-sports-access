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
