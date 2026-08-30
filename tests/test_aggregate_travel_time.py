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
