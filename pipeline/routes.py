"""Build map-ready 'desire line' route geometries: a straight line from each
census tract's origin point to its nearest facility.

These are straight origin-to-destination lines, not literal transit/walk
path geometry. r5py's TravelTimeMatrix (used throughout this pipeline, see
pipeline/travel_time.py) only returns scalar travel times between an origin
and destination -- it does not return the path taken. Real route-path
geometry (actual streets walked, actual subway/bus lines ridden) would need
r5py's separate DetailedItineraries API, which computes one full itinerary
per OD pair rather than an entire many-to-many matrix in one call, and is
substantially more expensive per pair. That wasn't part of what was computed
here; this module is the place to add a DetailedItineraries-based variant if
literal transit-path geometry is needed later.
"""
import geopandas as gpd
import pandas as pd
import shapely.geometry

from pipeline import config


def build_route_lines(
    nearest_routes: pd.DataFrame,
    tract_origins: gpd.GeoDataFrame,
    tract_to_nta: pd.DataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
) -> gpd.GeoDataFrame:
    """nearest_routes: GEOID, sport_type, window_name, nearest_facility_id,
    travel_time_minutes (see travel_time.compute_nearest_facility_routes).

    Joined per sport type (each sport type's facility ids only resolve
    against that sport type's own facilities GeoDataFrame), not as one global
    join, since the same `id` value can denote a different facility row
    (a different DataFrame index) under a different sport type.
    """
    origin_points = tract_origins.rename(columns={"geometry": "origin_geometry"})[["GEOID", "origin_geometry"]]

    pieces = []
    for sport_type, group in nearest_routes.groupby("sport_type"):
        dest_points = facilities_by_sport_type[sport_type][["id", "geometry"]].rename(
            columns={"id": "nearest_facility_id", "geometry": "dest_geometry"}
        )
        merged = group.merge(origin_points, on="GEOID", how="left").merge(
            dest_points, on="nearest_facility_id", how="left"
        )
        pieces.append(merged)

    result = pd.concat(pieces, ignore_index=True)
    result = result.merge(tract_to_nta, on="GEOID", how="left")
    result["geometry"] = [
        shapely.geometry.LineString([origin, dest])
        for origin, dest in zip(result["origin_geometry"], result["dest_geometry"])
    ]
    result = result.drop(columns=["origin_geometry", "dest_geometry"])
    return gpd.GeoDataFrame(result, geometry="geometry", crs=config.CRS_GEOGRAPHIC)


def write_routes_geojson(routes: gpd.GeoDataFrame, output_path) -> None:
    routes.to_file(output_path, driver="GeoJSON")
