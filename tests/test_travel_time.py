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


def test_compute_nearest_facility_times_accepts_custom_time_windows(monkeypatch):
    # config.EVENING_TIME_WINDOWS ("weekday_evening"/"weekend_evening") lives
    # outside config.TIME_WINDOWS specifically so it can be computed without
    # touching the 4 already-checkpointed windows. compute_nearest_facility_times
    # must be able to route against that separate dict via the time_windows
    # param, using window_names to pick which of its entries to run.
    import geopandas as gpd
    from shapely.geometry import Point
    from pipeline import config

    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326"
    )
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame({"id": ["F1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    }

    monkeypatch.setattr(travel_time, "_run_matrix", _fake_matrix_fn)

    result = travel_time.compute_nearest_facility_times(
        transport_network=None,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        tract_offsets_minutes={"T1": 0.0},
        window_names=list(config.EVENING_TIME_WINDOWS),
        time_windows=config.EVENING_TIME_WINDOWS,
    )

    assert set(result["window_name"]) == {"weekday_evening", "weekend_evening"}


def _fake_matrix_fn_multi_destination(transport_network, origins, destinations, departure, departure_time_window, percentiles):
    # F2 is always closer than F1, so the nearest-facility id should always
    # resolve to F2, not just the first row for a given origin.
    times = {"F1": 20.0, "F2": 5.0}
    rows = []
    for from_id in origins["id"]:
        for to_id in destinations["id"]:
            rows.append({"from_id": from_id, "to_id": to_id, "travel_time": times[to_id]})
    return pd.DataFrame(rows)


def test_compute_nearest_facility_routes_keeps_nearest_facility_id(monkeypatch):
    import geopandas as gpd
    from shapely.geometry import Point

    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326"
    )
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame(
            {"id": ["F1", "F2"], "geometry": [Point(1, 1), Point(2, 2)]}, crs="EPSG:4326"
        )
    }

    monkeypatch.setattr(travel_time, "_run_matrix", _fake_matrix_fn_multi_destination)

    result = travel_time.compute_nearest_facility_routes(
        transport_network=None,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        tract_offsets_minutes={"T1": 0.0},
        window_names=["weekday_morning"],
    )

    assert list(result.columns) == [
        "GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes",
    ]
    row = result.iloc[0]
    assert row["nearest_facility_id"] == "F2"
    assert row["travel_time_minutes"] == pytest.approx(5.0)


def _fake_matrix_fn_one_unreachable_tract(transport_network, origins, destinations, departure, departure_time_window, percentiles):
    # T1 reaches F1 fine; T2's row is present but NaN for every destination
    # -- reproducing the real 2026-09-14 crash, where r5py returned a
    # NaN-valued row for an unreachable tract rather than omitting it
    # outright.
    rows = []
    for from_id in origins["id"]:
        for to_id in destinations["id"]:
            travel_time = float("nan") if from_id == "T2" else 10.0
            rows.append({"from_id": from_id, "to_id": to_id, "travel_time": travel_time})
    return pd.DataFrame(rows)


def test_compute_nearest_facility_routes_skips_tract_whose_matrix_row_is_all_nan(monkeypatch):
    # Regression test: idxmin() (unlike min()) raises ValueError on an
    # all-NaN group instead of silently returning NaN, and crashed the real
    # run on exactly this case. T2 must be dropped, not raise.
    import geopandas as gpd
    from shapely.geometry import Point

    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1", "T2"], "geometry": [Point(0, 0), Point(1, 1)]}, crs="EPSG:4326"
    )
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame({"id": ["F1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    }

    monkeypatch.setattr(travel_time, "_run_matrix", _fake_matrix_fn_one_unreachable_tract)

    result = travel_time.compute_nearest_facility_routes(
        transport_network=None,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        tract_offsets_minutes={"T1": 0.0, "T2": 0.0},
        window_names=["weekday_morning"],
    )

    assert set(result["GEOID"]) == {"T1"}  # T2 dropped, not raised or NaN-valued
