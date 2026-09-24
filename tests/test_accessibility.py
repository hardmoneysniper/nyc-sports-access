import pandas as pd
import pytest

from pipeline import accessibility

TRACT_TO_NTA = pd.DataFrame({"GEOID": ["T1", "T2", "T3"], "NTA2020": ["N1", "N1", "N1"]})
TRACT_POPULATION = pd.Series({"T1": 100, "T2": 300, "T3": 600})


def test_pct_within_threshold_sums_population_of_qualifying_tracts_only():
    # T1 (10 min) and T2 (15 min) qualify at a 15-min threshold; T3 (20 min)
    # does not. pct = (100+300) / (100+300+600) = 400/1000 = 40%.
    tract_times = pd.Series({"T1": 10.0, "T2": 15.0, "T3": 20.0})

    result = accessibility.pct_population_within_threshold(
        tract_times, TRACT_TO_NTA, TRACT_POPULATION, threshold_minutes=15
    )

    row = result[result["NTA2020"] == "N1"].iloc[0]
    assert row["pct_within_threshold"] == pytest.approx(40.0)


def test_pct_within_threshold_uses_exactly_equal_to_threshold_as_qualifying():
    # Spec: "equal to or less than 15 minutes" -- exactly 15.0 must count.
    tract_times = pd.Series({"T1": 15.0, "T2": 15.0, "T3": 15.0})

    result = accessibility.pct_population_within_threshold(
        tract_times, TRACT_TO_NTA, TRACT_POPULATION, threshold_minutes=15
    )

    assert result[result["NTA2020"] == "N1"].iloc[0]["pct_within_threshold"] == pytest.approx(100.0)


def test_pct_within_threshold_counts_unreachable_tract_population_in_denominator_only():
    # T3 is unreachable (NaN travel time) -- it must NOT count toward the
    # within-threshold numerator, but its population still counts in the
    # denominator (spec: divide by *total* NTA population, not just
    # reachable population). pct = (100+300) / (100+300+600) = 40%, not
    # (100+300)/(100+300) = 100%.
    tract_times = pd.Series({"T1": 5.0, "T2": 10.0, "T3": float("nan")})

    result = accessibility.pct_population_within_threshold(
        tract_times, TRACT_TO_NTA, TRACT_POPULATION, threshold_minutes=15
    )

    assert result[result["NTA2020"] == "N1"].iloc[0]["pct_within_threshold"] == pytest.approx(40.0)


def test_pct_within_threshold_treats_tract_missing_from_times_same_as_nan():
    # T3 has no entry at all in tract_times (e.g. it never appeared in the
    # nearest-facility output because it's unreachable) -- .map() produces
    # NaN for it, same as an explicit NaN value.
    tract_times = pd.Series({"T1": 5.0, "T2": 10.0})  # T3 absent entirely

    result = accessibility.pct_population_within_threshold(
        tract_times, TRACT_TO_NTA, TRACT_POPULATION, threshold_minutes=15
    )

    assert result[result["NTA2020"] == "N1"].iloc[0]["pct_within_threshold"] == pytest.approx(40.0)


def test_pct_within_threshold_raises_on_missing_population():
    tract_times = pd.Series({"T1": 5.0, "T2": 10.0, "T3": 20.0})
    tract_population = pd.Series({"T1": 100, "T3": 600})  # T2 missing

    with pytest.raises(ValueError, match="T2"):
        accessibility.pct_population_within_threshold(
            tract_times, TRACT_TO_NTA, tract_population, threshold_minutes=15
        )


def test_pct_within_threshold_zero_population_nta_yields_nan_not_error():
    tract_to_nta = pd.DataFrame({"GEOID": ["T1"], "NTA2020": ["PARK1"]})
    tract_population = pd.Series({"T1": 0})
    tract_times = pd.Series({"T1": 5.0})

    result = accessibility.pct_population_within_threshold(
        tract_times, tract_to_nta, tract_population, threshold_minutes=15
    )

    assert pd.isna(result[result["NTA2020"] == "PARK1"].iloc[0]["pct_within_threshold"])
