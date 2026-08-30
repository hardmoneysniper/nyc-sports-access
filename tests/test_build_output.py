import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point

from pipeline import build_output


def test_write_nta_output_pivots_travel_times_wide(tmp_path):
    nta_demographics = pd.DataFrame({"NTA2020": ["N1", "N2"], "pct_non_white": [50.0, 80.0]})
    nta_travel_times = pd.DataFrame({
        "NTA2020": ["N1", "N1", "N2", "N2"],
        "sport_type": ["basketball", "tennis", "basketball", "tennis"],
        "window_name": ["weekday_morning"] * 4,
        "travel_time_minutes": [12.0, 18.0, 9.0, 22.0],
    })
    nta_boundaries = gpd.GeoDataFrame(
        {"NTA2020": ["N1", "N2"], "geometry": [Point(0, 0), Point(1, 1)]}, crs="EPSG:4326"
    )
    output_path = tmp_path / "nta_output.geojson"

    build_output.write_nta_output(nta_demographics, nta_travel_times, nta_boundaries, output_path)

    result = gpd.read_file(output_path)
    assert set(["N1", "N2"]) == set(result["NTA2020"])
    n1 = result[result["NTA2020"] == "N1"].iloc[0]
    assert n1["travel_time_basketball_weekday_morning"] == pytest.approx(12.0)
    assert n1["travel_time_tennis_weekday_morning"] == pytest.approx(18.0)
    assert n1["pct_non_white"] == pytest.approx(50.0)
