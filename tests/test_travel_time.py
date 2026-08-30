import pytest
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
