# tests/test_aggregate_travel_time.py
import pandas as pd
import pytest

from pipeline import aggregate_travel_time


TRACT_TIMES = pd.DataFrame({
    "GEOID": ["T1", "T2", "T3"],
    "sport_type": ["basketball"] * 3,
    "window_name": ["weekday_morning"] * 3,
    "travel_time_minutes": [10.0, 20.0, None],
})
TRACT_TO_NTA = pd.DataFrame({"GEOID": ["T1", "T2", "T3"], "NTA2020": ["N1", "N1", "N1"]})
TRACT_POPULATION = pd.Series({"T1": 100, "T2": 300, "T3": 500})


def test_aggregate_to_nta_is_population_weighted_and_ignores_nan():
    result = aggregate_travel_time.aggregate_to_nta(TRACT_TIMES, TRACT_TO_NTA, TRACT_POPULATION)
    row = result[
        (result["NTA2020"] == "N1")
        & (result["sport_type"] == "basketball")
        & (result["window_name"] == "weekday_morning")
    ].iloc[0]
    # T3 is NaN and must be excluded entirely (not weighted as 0 population):
    # weighted avg = (10*100 + 20*300) / (100+300) = 7000/400 = 17.5
    assert row["travel_time_minutes"] == pytest.approx(17.5)


def test_aggregate_to_nta_raises_on_missing_population_for_known_travel_time():
    # T2 has a real (non-NaN) travel time but is absent from tract_population
    # entirely -- this must be treated as a data-integrity failure, not a
    # silent drop from the weighted sum/denominator.
    tract_population = pd.Series({"T1": 100, "T3": 500})
    with pytest.raises(ValueError, match="T2"):
        aggregate_travel_time.aggregate_to_nta(TRACT_TIMES, TRACT_TO_NTA, tract_population)


def test_aggregate_to_nta_surfaces_whole_group_unreachability_as_nan_row():
    tract_times = pd.DataFrame({
        "GEOID": ["T1", "T2", "T3", "T4"],
        "sport_type": ["basketball"] * 3 + ["swimming"],
        "window_name": ["weekday_morning"] * 3 + ["weekday_morning"],
        # Every tract in the (N1, swimming, weekday_morning) group is
        # unreachable (NaN travel time); N1/basketball/weekday_morning is
        # fully reachable as a control.
        "travel_time_minutes": [10.0, 20.0, None, None],
    })
    tract_to_nta = pd.DataFrame({
        "GEOID": ["T1", "T2", "T3", "T4"],
        "NTA2020": ["N1", "N1", "N1", "N1"],
    })
    tract_population = pd.Series({"T1": 100, "T2": 300, "T3": 500, "T4": 500})

    result = aggregate_travel_time.aggregate_to_nta(tract_times, tract_to_nta, tract_population)

    swimming_rows = result[
        (result["NTA2020"] == "N1")
        & (result["sport_type"] == "swimming")
        & (result["window_name"] == "weekday_morning")
    ]
    # The row must be present (not absent) with an explicit NaN, signaling
    # "no reachable data" rather than being silently dropped from the output.
    assert len(swimming_rows) == 1
    assert pd.isna(swimming_rows.iloc[0]["travel_time_minutes"])
