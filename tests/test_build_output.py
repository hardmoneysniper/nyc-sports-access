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


def test_write_tract_output_pivots_travel_times_wide(tmp_path):
    """Happy-path test: pivots tract travel times and writes correctly."""
    tract_times = pd.DataFrame({
        "GEOID": ["T1", "T1", "T2", "T2"],
        "sport_type": ["basketball", "tennis", "basketball", "tennis"],
        "window_name": ["weekday_morning"] * 4,
        "travel_time_minutes": [15.0, 20.0, 10.0, 25.0],
    })
    tract_to_nta = pd.DataFrame({"GEOID": ["T1", "T2"], "NTA2020": ["N1", "N1"]})
    output_path = tmp_path / "tract_output.csv"

    build_output.write_tract_output(tract_times, tract_to_nta, output_path)

    result = pd.read_csv(output_path)
    assert set(["T1", "T2"]) == set(result["GEOID"])
    t1 = result[result["GEOID"] == "T1"].iloc[0]
    assert t1["travel_time_basketball_weekday_morning"] == pytest.approx(15.0)
    assert t1["travel_time_tennis_weekday_morning"] == pytest.approx(20.0)
    assert t1["NTA2020"] == "N1"


def test_write_tract_output_includes_unreachable_tracts_with_nan(tmp_path):
    """Regression test: tract with NO travel-time rows still appears in output with NaN.

    This tests the fix for the merge-anchor bug: if a tract in tract_to_nta has zero rows
    in tract_times (e.g. it cannot reach any facility), the output should include that tract
    with NaN values for pivoted travel-time columns, not silently drop it.
    """
    tract_times = pd.DataFrame({
        "GEOID": ["T1", "T1"],
        "sport_type": ["basketball", "tennis"],
        "window_name": ["weekday_morning"] * 2,
        "travel_time_minutes": [15.0, 20.0],
    })
    # T2 is in the exhaustive tract list but has NO rows in tract_times
    # (fully unreachable: never emitted by r5py matrix calculation).
    tract_to_nta = pd.DataFrame({"GEOID": ["T1", "T2"], "NTA2020": ["N1", "N1"]})
    output_path = tmp_path / "tract_output.csv"

    build_output.write_tract_output(tract_times, tract_to_nta, output_path)

    result = pd.read_csv(output_path)
    assert len(result) == 2, "Both T1 and T2 should appear in output"
    assert set(["T1", "T2"]) == set(result["GEOID"])

    t2 = result[result["GEOID"] == "T2"].iloc[0]
    assert pd.isna(t2["travel_time_basketball_weekday_morning"]), \
        "T2 should have NaN for travel_time_basketball_weekday_morning"
    assert pd.isna(t2["travel_time_tennis_weekday_morning"]), \
        "T2 should have NaN for travel_time_tennis_weekday_morning"
    assert t2["NTA2020"] == "N1", "T2 should still have its NTA2020 mapping"


def test_add_combined_time_columns_applies_weekday_weekend_weighting():
    # weights: weekday_morning=5, weekday_noon=5, weekend_morning=2, weekend_noon=2
    # combined = (5*10 + 5*20 + 2*30 + 2*40) / 14 = (50+100+60+80)/14 = 290/14
    df = pd.DataFrame({
        "GEOID": ["T1"],
        "travel_time_basketball_weekday_morning": [10.0],
        "travel_time_basketball_weekday_noon": [20.0],
        "travel_time_basketball_weekend_morning": [30.0],
        "travel_time_basketball_weekend_noon": [40.0],
    })
    result = build_output.add_combined_time_columns(df, ["basketball"])
    assert result["travel_time_basketball"].iloc[0] == pytest.approx(290 / 14)


def test_add_combined_time_columns_propagates_nan_from_any_missing_window():
    # If any of the 4 windows is NaN, the combined value must be NaN too --
    # not silently re-normalized over the 3 remaining windows.
    df = pd.DataFrame({
        "GEOID": ["T1"],
        "travel_time_basketball_weekday_morning": [10.0],
        "travel_time_basketball_weekday_noon": [20.0],
        "travel_time_basketball_weekend_morning": [float("nan")],
        "travel_time_basketball_weekend_noon": [40.0],
    })
    result = build_output.add_combined_time_columns(df, ["basketball"])
    assert pd.isna(result["travel_time_basketball"].iloc[0])
