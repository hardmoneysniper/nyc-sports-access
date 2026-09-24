import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, Point

from pipeline import routes


def test_build_route_lines_connects_tract_origin_to_nearest_facility():
    nearest_routes = pd.DataFrame([
        {
            "GEOID": "T1", "sport_type": "basketball", "window_name": "weekday_evening",
            "nearest_facility_id": "F1", "travel_time_minutes": 12.5,
        },
        {
            "GEOID": "T2", "sport_type": "tennis", "window_name": "weekend_evening",
            "nearest_facility_id": "F2", "travel_time_minutes": 30.0,
        },
    ])
    tract_origins = gpd.GeoDataFrame(
        {"GEOID": ["T1", "T2"], "geometry": [Point(0, 0), Point(1, 1)]}, crs="EPSG:4326"
    )
    tract_to_nta = pd.DataFrame({"GEOID": ["T1", "T2"], "NTA2020": ["N1", "N1"]})
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame({"id": ["F1"], "geometry": [Point(5, 5)]}, crs="EPSG:4326"),
        "tennis": gpd.GeoDataFrame({"id": ["F2"], "geometry": [Point(9, 9)]}, crs="EPSG:4326"),
    }

    result = routes.build_route_lines(nearest_routes, tract_origins, tract_to_nta, facilities_by_sport_type)

    assert len(result) == 2
    assert result.crs == "EPSG:4326"
    t1 = result[result["GEOID"] == "T1"].iloc[0]
    assert list(t1.geometry.coords) == [(0, 0), (5, 5)]
    assert t1["NTA2020"] == "N1"
    assert t1["travel_time_minutes"] == 12.5


def test_build_route_lines_resolves_facility_id_per_sport_type_not_globally():
    # The same raw id ("0") can denote a different facility row under a
    # different sport type (facility ids are each sport type's own
    # GeoDataFrame row index) -- the join must not conflate them.
    nearest_routes = pd.DataFrame([
        {
            "GEOID": "T1", "sport_type": "basketball", "window_name": "weekday_evening",
            "nearest_facility_id": "0", "travel_time_minutes": 10.0,
        },
        {
            "GEOID": "T1", "sport_type": "tennis", "window_name": "weekday_evening",
            "nearest_facility_id": "0", "travel_time_minutes": 20.0,
        },
    ])
    tract_origins = gpd.GeoDataFrame({"GEOID": ["T1"], "geometry": [Point(0, 0)]}, crs="EPSG:4326")
    tract_to_nta = pd.DataFrame({"GEOID": ["T1"], "NTA2020": ["N1"]})
    facilities_by_sport_type = {
        "basketball": gpd.GeoDataFrame({"id": ["0"], "geometry": [Point(3, 3)]}, crs="EPSG:4326"),
        "tennis": gpd.GeoDataFrame({"id": ["0"], "geometry": [Point(7, 7)]}, crs="EPSG:4326"),
    }

    result = routes.build_route_lines(nearest_routes, tract_origins, tract_to_nta, facilities_by_sport_type)

    basketball_row = result[result["sport_type"] == "basketball"].iloc[0]
    tennis_row = result[result["sport_type"] == "tennis"].iloc[0]
    assert list(basketball_row.geometry.coords) == [(0, 0), (3, 3)]
    assert list(tennis_row.geometry.coords) == [(0, 0), (7, 7)]


def test_write_routes_geojson_round_trips(tmp_path):
    routes_gdf = gpd.GeoDataFrame(
        {
            "GEOID": ["T1"], "sport_type": ["basketball"], "window_name": ["weekday_evening"],
            "nearest_facility_id": ["F1"], "travel_time_minutes": [12.5], "NTA2020": ["N1"],
        },
        geometry=[LineString([(0, 0), (5, 5)])],
        crs="EPSG:4326",
    )
    output_path = tmp_path / "routes.geojson"

    routes.write_routes_geojson(routes_gdf, output_path)

    assert output_path.exists()
    read_back = gpd.read_file(output_path)
    assert read_back.iloc[0]["GEOID"] == "T1"
    assert read_back.iloc[0]["travel_time_minutes"] == 12.5
