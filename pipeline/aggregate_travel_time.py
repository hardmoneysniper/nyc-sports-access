"""Population-weighted aggregation of tract-level travel times to NTA level."""
import pandas as pd


def aggregate_to_nta(
    tract_times: pd.DataFrame,
    tract_to_nta: pd.DataFrame,
    tract_population: pd.Series,
) -> pd.DataFrame:
    merged = tract_times.merge(tract_to_nta, on="GEOID", how="inner")
    merged["population"] = merged["GEOID"].map(tract_population)
    merged = merged.dropna(subset=["travel_time_minutes"])
    merged["weighted_time"] = merged["travel_time_minutes"] * merged["population"]

    grouped = merged.groupby(["NTA2020", "sport_type", "window_name"]).agg(
        weighted_time_sum=("weighted_time", "sum"),
        population_sum=("population", "sum"),
    ).reset_index()
    grouped["travel_time_minutes"] = grouped["weighted_time_sum"] / grouped["population_sum"]
    return grouped[["NTA2020", "sport_type", "window_name", "travel_time_minutes"]]
