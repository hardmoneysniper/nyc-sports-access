"""Shared data prep for the foreign-born% / soccer-15min-access% NTA metrics
used by both make_maps.py and make_scatter.py, so the two never drift apart
on how the numbers are derived.

Deliberately does not import pipeline.travel_time or call
pipeline_setup.run_setup() -- needs no r5py/JVM at all, only already-computed
output (nta_output.geojson, tract_output_combined_time.csv) plus one
lightweight Census API population pull, so it's safe to run alongside the
evening-windows job without competing for its resources.
"""
import geopandas as gpd
import pandas as pd

from pipeline import accessibility, census_client, config, geography

SOCCER_THRESHOLD_MINUTES = 15


def _tract_population() -> pd.Series:
    population = census_client.fetch_acs_group("B02001")
    return (
        population[population["variable"].str.endswith("_001E")]
        .set_index("GEOID")["estimate"]
    )


def load_nta_with_accessibility(threshold_minutes: float = SOCCER_THRESHOLD_MINUTES) -> gpd.GeoDataFrame:
    """Returns nta_output.geojson's columns (including pct_immigrant) plus a
    new pct_within_threshold column: % of the NTA's population within
    threshold_minutes of its nearest soccer field, from
    tract_output_combined_time.csv's travel_time_soccer (the
    weekday-frequency-weighted combined time across the original 4 windows).
    """
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")

    tracts = geography.load_census_tracts()
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    tract_times = pd.read_csv(
        config.PROCESSED_DIR / "tract_output_combined_time.csv", dtype={"GEOID": str}
    ).set_index("GEOID")["travel_time_soccer"]

    tract_population = _tract_population()

    soccer_access = accessibility.pct_population_within_threshold(
        tract_times, tract_to_nta, tract_population, threshold_minutes
    )
    return nta.merge(soccer_access, on="NTA2020", how="left")


def load_nta_with_avg_travel_time(sport_type: str = "soccer") -> gpd.GeoDataFrame:
    """Returns nta_output.geojson's columns (including total_population)
    plus a new avg_travel_time_minutes column: the tract-population-weighted
    average public-transit travel time to the nearest facility of
    sport_type, from tract_output_combined_time.csv's
    travel_time_{sport_type} (the weekday-frequency-weighted combined time
    across the original 4 windows). sport_type must be one of
    config.SPORT_TYPE_COLUMNS, OR one of config.SPORT_TYPE_GROUPS' display
    categories (e.g. "youth_baseball"), in which case the tract-level time
    is the row-wise minimum across that group's member columns first --
    same "nearest facility of ANY member type" reduction
    export_dashboard_data.py's export_travel_time() already applies for
    the live dashboard, just computed here directly from tract_output_
    combined_time.csv instead of being read back from travel_time.geojson.
    Defaults to soccer, matching every existing caller.

    Computed directly from tract-level data here (not read back from
    nta_output.geojson's own travel_time_{sport}_* columns) so this stays
    on the exact same tract_times/tract_population inputs as
    load_nta_with_accessibility's pct_within_threshold above -- the two
    numbers are meant to be directly comparable replacements for each
    other, not derived from two different population snapshots.
    """
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")

    tracts = geography.load_census_tracts()
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    tract_output = pd.read_csv(
        config.PROCESSED_DIR / "tract_output_combined_time.csv", dtype={"GEOID": str}
    ).set_index("GEOID")

    member_columns = config.SPORT_TYPE_GROUPS.get(sport_type)
    if member_columns is not None:
        tract_times = tract_output[[f"travel_time_{c}" for c in member_columns]].min(axis=1, skipna=True)
    else:
        tract_times = tract_output[f"travel_time_{sport_type}"]

    tract_population = _tract_population()

    avg_travel_time = accessibility.population_weighted_average_travel_time(
        tract_times, tract_to_nta, tract_population
    )
    return nta.merge(avg_travel_time, on="NTA2020", how="left")
