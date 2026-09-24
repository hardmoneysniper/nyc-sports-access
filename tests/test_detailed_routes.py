import datetime

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import LineString, Point

from pipeline import detailed_routes


def _fake_itineraries_factory(slow_minutes=180.0, fast_minutes=20.0):
    """Fake r5py.DetailedItineraries stand-in: for each one-to-one pair (row
    i of origins <-> row i of destinations), returns option 0 = a single
    slow "direct walk" segment and option 1 = two fast transit segments --
    mirroring TripPlanner.trips' real `direct_paths + transit_paths` order
    (slow direct option always first), so tests can verify the fastest-option
    selection actually looks past option 0.
    """
    def _fake(transport_network, origins, destinations, departure, departure_time_window):
        rows = []
        for i, (from_id, to_id) in enumerate(zip(origins["id"], destinations["id"])):
            rows.append({
                "from_id": from_id, "to_id": to_id, "option": 0, "segment": 0,
                "transport_mode": "WALK", "departure_time": departure,
                "distance": 5000.0, "travel_time": datetime.timedelta(minutes=slow_minutes),
                "wait_time": datetime.timedelta(0), "feed": None, "agency_id": None,
                "route_id": None, "start_stop_id": None, "end_stop_id": None,
                "geometry": LineString([(0, 0), (1, 1)]),
            })
            rows.append({
                "from_id": from_id, "to_id": to_id, "option": 1, "segment": 0,
                "transport_mode": "WALK", "departure_time": departure,
                "distance": 200.0, "travel_time": datetime.timedelta(minutes=fast_minutes / 2),
                "wait_time": datetime.timedelta(0), "feed": None, "agency_id": None,
                "route_id": None, "start_stop_id": None, "end_stop_id": None,
                "geometry": LineString([(0, 0), (0.1, 0.1)]),
            })
            rows.append({
                "from_id": from_id, "to_id": to_id, "option": 1, "segment": 1,
                "transport_mode": "SUBWAY", "departure_time": departure,
                "distance": 3000.0, "travel_time": datetime.timedelta(minutes=fast_minutes / 2),
                "wait_time": datetime.timedelta(minutes=2), "feed": "subway", "agency_id": "MTA",
                "route_id": "A", "start_stop_id": "S1", "end_stop_id": "S2",
                "geometry": LineString([(0.1, 0.1), (1, 1)]),
            })
        return pd.DataFrame(rows)
    return _fake


def test_picks_fastest_option_not_option_zero():
    nearest_routes = pd.DataFrame([
        {"GEOID": "T1", "sport_type": "soccer", "window_name": "weekday_evening",
         "nearest_facility_id": "5", "travel_time_minutes": 19.5},
    ])
    tract_origins = gpd.GeoDataFrame({"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    facilities_by_sport_type = {
        "soccer": gpd.GeoDataFrame({"id": ["5"], "geometry": [Point(1, 1)]}, crs="EPSG:4326"),
    }
    time_windows = {
        "weekday_evening": {
            "date": datetime.date(2026, 9, 1), "start_time": datetime.time(17, 0),
            "duration": datetime.timedelta(hours=2),
        }
    }

    result = detailed_routes.compute_nearest_facility_paths(
        transport_network=None,
        nearest_routes=nearest_routes,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        time_windows=time_windows,
        detailed_itineraries_fn=_fake_itineraries_factory(),
    )

    # Only option 1 (the fast transit option) should survive, as 2 segments.
    assert len(result) == 2
    assert set(result["transport_mode"]) == {"WALK", "SUBWAY"}
    assert (result["GEOID"] == "T1").all()
    assert (result["nearest_facility_id"] == "5").all()
    assert (result["sport_type"] == "soccer").all()


def test_handles_multiple_tracts_sharing_the_same_nearest_facility():
    # Two different tracts both route to the same facility ("5") -- the
    # synthetic ordinal-id workaround (module docstring point 2) must keep
    # them distinguishable instead of crashing or conflating them.
    nearest_routes = pd.DataFrame([
        {"GEOID": "T1", "sport_type": "netball", "window_name": "weekday_evening",
         "nearest_facility_id": "5", "travel_time_minutes": 10.0},
        {"GEOID": "T2", "sport_type": "netball", "window_name": "weekday_evening",
         "nearest_facility_id": "5", "travel_time_minutes": 12.0},
    ])
    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1", "T2"], "geometry": [Point(0, 0), Point(2, 2)]}, crs="EPSG:4326"
    )
    facilities_by_sport_type = {
        "netball": gpd.GeoDataFrame({"id": ["5"], "geometry": [Point(1, 1)]}, crs="EPSG:4326"),
    }
    time_windows = {
        "weekday_evening": {
            "date": datetime.date(2026, 9, 1), "start_time": datetime.time(17, 0),
            "duration": datetime.timedelta(hours=2),
        }
    }

    result = detailed_routes.compute_nearest_facility_paths(
        transport_network=None,
        nearest_routes=nearest_routes,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        time_windows=time_windows,
        detailed_itineraries_fn=_fake_itineraries_factory(),
    )

    assert set(result["GEOID"]) == {"T1", "T2"}
    assert (result["nearest_facility_id"] == "5").all()
    # 2 tracts x 2 segments (the fast option) each = 4 rows.
    assert len(result) == 4


def test_resolves_facility_id_per_sport_type_not_globally():
    # Same raw facility id ("0") under two different sport types must
    # resolve to each sport type's own geometry, matching pipeline/routes.py's
    # equivalent per-sport-type join rule.
    nearest_routes = pd.DataFrame([
        {"GEOID": "T1", "sport_type": "basketball", "window_name": "weekday_evening",
         "nearest_facility_id": "0", "travel_time_minutes": 10.0},
        {"GEOID": "T1", "sport_type": "tennis", "window_name": "weekday_evening",
         "nearest_facility_id": "0", "travel_time_minutes": 20.0},
    ])
    tract_origins = gpd.GeoDataFrame({"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame({"id": ["0"], "geometry": [Point(3, 3)]}, crs="EPSG:4326"),
        "tennis": gpd.GeoDataFrame({"id": ["0"], "geometry": [Point(7, 7)]}, crs="EPSG:4326"),
    }
    time_windows = {
        "weekday_evening": {
            "date": datetime.date(2026, 9, 1), "start_time": datetime.time(17, 0),
            "duration": datetime.timedelta(hours=2),
        }
    }

    result = detailed_routes.compute_nearest_facility_paths(
        transport_network=None,
        nearest_routes=nearest_routes,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        time_windows=time_windows,
        detailed_itineraries_fn=_fake_itineraries_factory(),
    )

    assert set(result["sport_type"]) == {"basketball", "tennis"}
    assert len(result[result["sport_type"] == "basketball"]) == 2
    assert len(result[result["sport_type"] == "tennis"]) == 2


def test_travel_time_and_wait_time_are_json_serializable_seconds():
    """r5py's raw DetailedItineraries output carries travel_time/wait_time
    as datetime.timedelta (pandas timedelta64 dtype). GeoJSON (pyogrio)
    cannot write that dtype at all -- confirmed against a real run, every
    per-sport-type checkpoint write crashed with NotImplementedError right
    after the (slow) routing work finished. compute_nearest_facility_paths
    must convert both columns to plain seconds (float) before returning.
    """
    nearest_routes = pd.DataFrame([
        {"GEOID": "T1", "sport_type": "soccer", "window_name": "weekday_evening",
         "nearest_facility_id": "5", "travel_time_minutes": 19.5},
    ])
    tract_origins = gpd.GeoDataFrame({"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    facilities_by_sport_type = {
        "soccer": gpd.GeoDataFrame({"id": ["5"], "geometry": [Point(1, 1)]}, crs="EPSG:4326"),
    }
    time_windows = {
        "weekday_evening": {
            "date": datetime.date(2026, 9, 1), "start_time": datetime.time(17, 0),
            "duration": datetime.timedelta(hours=2),
        }
    }

    result = detailed_routes.compute_nearest_facility_paths(
        transport_network=None,
        nearest_routes=nearest_routes,
        tract_origins=tract_origins,
        facilities_by_sport_type=facilities_by_sport_type,
        time_windows=time_windows,
        detailed_itineraries_fn=_fake_itineraries_factory(fast_minutes=20.0),
    )

    assert result["travel_time"].dtype == "float64"
    assert result["wait_time"].dtype == "float64"
    walk_row = result[result["transport_mode"] == "WALK"].iloc[0]
    assert walk_row["travel_time"] == pytest.approx(600.0)  # fast_minutes/2 in seconds
    subway_row = result[result["transport_mode"] == "SUBWAY"].iloc[0]
    assert subway_row["wait_time"] == pytest.approx(120.0)  # 2 minutes in seconds


def test_write_detailed_routes_geojson_round_trips(tmp_path):
    routes_gdf = gpd.GeoDataFrame(
        {
            "GEOID": ["T1"], "nearest_facility_id": ["F1"], "sport_type": ["soccer"],
            "window_name": ["weekday_evening"], "option": [1], "segment": [0],
            "transport_mode": ["WALK"], "distance": [100.0],
            "travel_time": [90.0], "wait_time": [0.0],
        },
        geometry=[LineString([(0, 0), (1, 1)])],
        crs="EPSG:4326",
    )
    output_path = tmp_path / "detailed_routes.geojson"

    detailed_routes.write_detailed_routes_geojson(routes_gdf, output_path)

    assert output_path.exists()
    read_back = gpd.read_file(output_path)
    assert read_back.iloc[0]["GEOID"] == "T1"
