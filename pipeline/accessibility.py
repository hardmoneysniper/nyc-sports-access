"""Population-weighted 'share of population within a travel-time threshold'
accessibility metrics -- distinct from aggregate_travel_time.py's
population-weighted *average* travel time.

Both start from the same tract-level inputs (a travel time per tract, tract
population, tract-to-NTA mapping) and follow the same fail-loudly rule for
missing population lookups, but answer a different question: not "what's
the typical travel time in this NTA" but "what share of this NTA's
residents can reach a facility within N minutes."
"""
import pandas as pd


def pct_population_within_threshold(
    tract_times: pd.Series,
    tract_to_nta: pd.DataFrame,
    tract_population: pd.Series,
    threshold_minutes: float,
) -> pd.DataFrame:
    """tract_times: a GEOID-indexed Series of travel-time minutes (e.g. the
    weekday-frequency-weighted combined soccer travel time). A tract absent
    from tract_times or with a NaN value contributes 0 to the
    within-threshold population (NaN <= threshold is always False) but its
    full population still counts in the denominator -- per spec, the
    denominator is total NTA population, not just reachable population.
    """
    merged = tract_to_nta.copy()
    merged["travel_time_minutes"] = merged["GEOID"].map(tract_times)
    merged["population"] = merged["GEOID"].map(tract_population)

    # Mirrors aggregate_travel_time.aggregate_to_nta's precedent: a tract
    # with no population lookup is a data-integrity problem to fail loudly
    # on, not something to silently drop from the denominator.
    missing_population = merged["population"].isna()
    if missing_population.any():
        missing_geoids = sorted(merged.loc[missing_population, "GEOID"].unique().tolist())
        raise ValueError(f"Tracts have no population lookup: {missing_geoids}")

    within_threshold = merged["travel_time_minutes"] <= threshold_minutes
    merged["within_threshold_population"] = merged["population"].where(within_threshold, 0)

    grouped = merged.groupby("NTA2020").agg(
        within_threshold_population=("within_threshold_population", "sum"),
        total_population=("population", "sum"),
    )
    grouped["pct_within_threshold"] = (
        100 * grouped["within_threshold_population"] / grouped["total_population"]
    )
    return grouped[["pct_within_threshold"]].reset_index()


def population_weighted_average_travel_time(
    tract_times: pd.Series,
    tract_to_nta: pd.DataFrame,
    tract_population: pd.Series,
) -> pd.DataFrame:
    """Tract-population-weighted average travel time per NTA -- the same
    weighting rule aggregate_travel_time.aggregate_to_nta applies during the
    full pipeline run (§7 of METHODOLOGY.md), but operating directly on a
    single GEOID-indexed travel-time Series (e.g. the already-combined
    soccer travel time from tract_output_combined_time.csv) instead of that
    function's long sport_type/window_name format, so it can be reused by a
    standalone script without needing the full long-format tract_times
    table in memory.

    A tract missing a travel time (unreachable) is dropped from BOTH the
    weighted sum and the population sum -- per spec, an unreachable tract
    contributes no signal, rather than being treated as a 0-minute trip
    that would pull the average down.
    """
    merged = tract_to_nta.copy()
    merged["travel_time_minutes"] = merged["GEOID"].map(tract_times)
    merged["population"] = merged["GEOID"].map(tract_population)

    # Mirrors pct_population_within_threshold's precedent above: a missing
    # population lookup is a data-integrity problem to fail loudly on.
    missing_population = merged["population"].isna()
    if missing_population.any():
        missing_geoids = sorted(merged.loc[missing_population, "GEOID"].unique().tolist())
        raise ValueError(f"Tracts have no population lookup: {missing_geoids}")

    merged = merged.dropna(subset=["travel_time_minutes"])
    merged["weighted_time"] = merged["travel_time_minutes"] * merged["population"]

    grouped = merged.groupby("NTA2020").agg(
        weighted_time_sum=("weighted_time", "sum"),
        population_sum=("population", "sum"),
    )
    grouped["avg_travel_time_minutes"] = grouped["weighted_time_sum"] / grouped["population_sum"]
    return grouped[["avg_travel_time_minutes"]].reset_index()
