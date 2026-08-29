import math
import pytest

from shapely.geometry import Polygon

from pipeline import offsets


def test_origin_point_is_always_inside_polygon():
    # A concave "C" shape whose arithmetic centroid falls outside it.
    concave = Polygon([(0, 0), (10, 0), (10, 10), (7, 10), (7, 3), (3, 3), (3, 10), (0, 10)])
    origin = offsets.compute_origin_point(concave)
    assert concave.contains(origin) or concave.boundary.distance(origin) < 1e-9


def test_walking_offset_for_a_known_square():
    # 1000ft x 1000ft square (units match EPSG:2263, feet). Centroid at (500,500).
    # Corner distances to centroid = sqrt(500^2+500^2) = 707.1067..., all four equal,
    # so avg = 707.1067, half = 353.5534 ft. At 3.0 mph = 264 ft/min,
    # expected minutes = 353.5534 / 264 = 1.3391...
    square = Polygon([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
    origin = offsets.compute_origin_point(square)
    minutes = offsets.compute_walking_offset_minutes(square, origin, walk_speed_mph=3.0)
    feet_per_minute = 3.0 * 5280 / 60
    expected_half_avg_corner_distance = (math.sqrt(500**2 + 500**2)) / 2
    expected_minutes = expected_half_avg_corner_distance / feet_per_minute
    assert minutes == pytest.approx(expected_minutes, rel=1e-6)


def test_walking_offset_is_nonnegative_for_irregular_polygon():
    # A genuinely concave "C" shape (polygon.area != polygon.convex_hull.area)
    irregular = Polygon([(0, 0), (10, 0), (10, 10), (7, 10), (7, 3), (3, 3), (3, 10), (0, 10)])
    origin = offsets.compute_origin_point(irregular)
    minutes = offsets.compute_walking_offset_minutes(irregular, origin)
    assert minutes > 0
