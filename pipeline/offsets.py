"""Tract origin point and intra-tract walking-time offset.

The origin point is a "point on surface" (shapely's representative_point),
not a naive centroid, so it never falls outside concave/oddly-shaped tracts.
The walking offset approximates the extra walk a resident who isn't
standing exactly at the origin point needs: it averages the distance from
the tract's bounding-box corners to the origin, halves it, and converts to
time at a fixed walking speed. This is independent of r5py's own internal
access/egress walk speed for the transit leg itself.
"""
import shapely.geometry

from pipeline import config


def compute_origin_point(geometry: shapely.geometry.base.BaseGeometry) -> shapely.geometry.Point:
    return geometry.representative_point()


def compute_walking_offset_minutes(
    geometry: shapely.geometry.base.BaseGeometry,
    origin: shapely.geometry.Point,
    walk_speed_mph: float = config.INTRA_TRACT_WALK_SPEED_MPH,
) -> float:
    min_x, min_y, max_x, max_y = geometry.bounds
    corners = [
        shapely.geometry.Point(min_x, min_y),
        shapely.geometry.Point(max_x, min_y),
        shapely.geometry.Point(max_x, max_y),
        shapely.geometry.Point(min_x, max_y),
    ]
    avg_corner_distance_ft = sum(origin.distance(c) for c in corners) / 4
    half_distance_ft = avg_corner_distance_ft / 2
    feet_per_minute = walk_speed_mph * 5280 / 60
    return half_distance_ft / feet_per_minute
