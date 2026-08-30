"""Population-weighted aggregation of tract-level travel times to NTA level."""
import pandas as pd


def aggregate_to_nta(
    tract_times: pd.DataFrame,
    tract_to_nta: pd.DataFrame,
    tract_population: pd.Series,
) -> pd.DataFrame:
    merged = tract_times.merge(tract_to_nta, on="GEOID", how="inner")
    merged["population"] = merged["GEOID"].map(tract_population)

    # A GEOID with a known (non-NaN) travel time but no population match is a
    # data-integrity problem (e.g. a dtype mismatch between tract_population's
    # keys and GEOID's dtype), not a legitimately-unreachable tract. Left
    # silent, it would either silently drop that tract's contribution (if some
    # other tracts in the group still have population) or -- if the *whole*
    # group is affected -- collapse both the weighted sum and the population
    # sum to 0 via skipna sum, producing an indistinguishable-from-unreachable
    # 0/0 = NaN. Fail loudly instead, naming the offending GEOIDs, matching the
    # precedent set by validate_tract_nta_join and _variable_for_label.
    missing_population = merged["travel_time_minutes"].notna() & merged["population"].isna()
    if missing_population.any():
        missing_geoids = sorted(merged.loc[missing_population, "GEOID"].unique().tolist())
        raise ValueError(
            f"Tracts have a known travel time but no population lookup: {missing_geoids}"
        )

    merged = merged.dropna(subset=["travel_time_minutes"])
    merged["weighted_time"] = merged["travel_time_minutes"] * merged["population"]

    grouped = merged.groupby(["NTA2020", "sport_type", "window_name"]).agg(
        weighted_time_sum=("weighted_time", "sum"),
        population_sum=("population", "sum"),
    ).reset_index()
    grouped["travel_time_minutes"] = grouped["weighted_time_sum"] / grouped["population_sum"]
    grouped = grouped[["NTA2020", "sport_type", "window_name", "travel_time_minutes"]]

    # Reindex against the full expected combination set so that an NTA/sport/
    # window combination where every tract's travel time is NaN still yields
    # an explicit NaN row, rather than silently vanishing from the output (see
    # pipeline/demographics.py's precedent: NaN is the correct "no data"
    # signal, not a bug to hide -- and a row that's simply absent gives a
    # downstream consumer no signal at all).
    all_ntas = pd.DataFrame({"NTA2020": tract_to_nta["NTA2020"].unique()})
    sport_windows = tract_times[["sport_type", "window_name"]].drop_duplicates()
    full_combinations = all_ntas.merge(sport_windows, how="cross")
    return full_combinations.merge(grouped, on=["NTA2020", "sport_type", "window_name"], how="left")
