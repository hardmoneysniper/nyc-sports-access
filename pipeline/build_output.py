"""Assembling and writing the final tract-level and NTA-level output tables."""
from pathlib import Path

import geopandas as gpd
import pandas as pd


def _pivot_wide(travel_times: pd.DataFrame, id_column: str) -> pd.DataFrame:
    travel_times = travel_times.copy()
    travel_times["column"] = "travel_time_" + travel_times["sport_type"] + "_" + travel_times["window_name"]
    return travel_times.pivot(index=id_column, columns="column", values="travel_time_minutes").reset_index()


def write_nta_output(
    nta_demographics: pd.DataFrame,
    nta_travel_times: pd.DataFrame,
    nta_boundaries: gpd.GeoDataFrame,
    output_path: Path,
) -> None:
    wide_times = _pivot_wide(nta_travel_times, "NTA2020")
    merged = nta_boundaries.merge(nta_demographics, on="NTA2020", how="left")
    merged = merged.merge(wide_times, on="NTA2020", how="left")
    merged.to_file(output_path, driver="GeoJSON")


def write_tract_output(
    tract_times: pd.DataFrame,
    tract_to_nta: pd.DataFrame,
    output_path: Path,
) -> None:
    wide_times = _pivot_wide(tract_times, "GEOID")
    # Anchor on tract_to_nta (the exhaustive tract list), not on wide_times.
    # A tract with zero travel-time rows across every sport/window (e.g. it
    # cannot reach any facility, so r5py never emits a matrix row for it) has
    # no representation in tract_times at all. Anchoring the merge on
    # wide_times would silently drop that tract from the output entirely --
    # not even a NaN row -- giving downstream consumers no signal that the
    # tract exists but is unreachable, versus not existing at all. Matches
    # the "explicit NaN over silent absence" precedent set in
    # aggregate_travel_time.aggregate_to_nta.
    merged = tract_to_nta.merge(wide_times, on="GEOID", how="left")
    merged.to_csv(output_path, index=False)
