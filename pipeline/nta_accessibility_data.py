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
