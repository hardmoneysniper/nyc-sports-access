# tests/test_demographics.py
from unittest.mock import patch

import pandas as pd
import pytest

from pipeline import demographics


TRACT_TO_NTA = pd.DataFrame(
    {"GEOID": ["36061000100", "36061000200"], "NTA2020": ["MN0101", "MN0101"]}
)

B03002_LABELS = {
    "B03002_001E": "Estimate!!Total:",
    "B03002_003E": "Estimate!!Total:!!Not Hispanic or Latino:!!White alone",
    # Real ACS labels carry a trailing colon on rows with further
    # sub-breakdowns (confirmed against the live API in Task 6) -- this
    # fixture intentionally includes it so the test exercises the
    # rstrip(":") handling in demographics.py, not a simplified label.
    "B03002_012E": "Estimate!!Total:!!Hispanic or Latino:",
}
B02001_LABELS = {
    "B02001_001E": "Estimate!!Total:",
    "B02001_003E": "Estimate!!Total:!!Black or African American alone",
    "B02001_005E": "Estimate!!Total:!!Asian alone",
    "B02001_008E": "Estimate!!Total:!!Two or more races:",
}
B05002_LABELS = {
    "B05002_001E": "Estimate!!Total:",
    "B05002_013E": "Estimate!!Total:!!Foreign born:",
}
B05006_LABELS = {
    "B05006_001E": "Estimate!!Total:",
    "B05006_050E": "Estimate!!Total:!!Latin America:!!Mexico",
}

B03002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000100",
                  "36061000200", "36061000200", "36061000200"],
        "variable": ["B03002_001E", "B03002_003E", "B03002_012E"] * 2,
        "estimate": [1000.0, 400.0, 300.0, 1000.0, 200.0, 500.0],
    }
)
B02001_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100"] * 4 + ["36061000200"] * 4,
        "variable": ["B02001_001E", "B02001_003E", "B02001_005E", "B02001_008E"] * 2,
        "estimate": [1000.0, 100.0, 150.0, 50.0, 1000.0, 200.0, 100.0, 30.0],
    }
)
B05002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B05002_001E", "B05002_013E"] * 2,
        "estimate": [1000.0, 250.0, 1000.0, 400.0],
    }
)
B05006_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B05006_001E", "B05006_050E"] * 2,
        "estimate": [250.0, 60.0, 400.0, 90.0],
    }
)


def _fake_fetch_group_labels(table_id):
    return {
        "B03002": B03002_LABELS, "B02001": B02001_LABELS,
        "B05002": B05002_LABELS, "B05006": B05006_LABELS,
    }[table_id]


def _fake_fetch_acs_group(table_id):
    return {
        "B03002": B03002_DATA, "B02001": B02001_DATA,
        "B05002": B05002_DATA, "B05006": B05006_DATA,
    }[table_id]


def test_build_nta_demographics_sums_before_dividing():
    with patch("pipeline.demographics.fetch_group_labels", side_effect=_fake_fetch_group_labels), \
         patch("pipeline.demographics.fetch_acs_group", side_effect=_fake_fetch_acs_group):
        result = demographics.build_nta_demographics(TRACT_TO_NTA)

    row = result[result["NTA2020"] == "MN0101"].iloc[0]
    # White alone (non-Hispanic) summed = 400+200=600, total summed=1000+1000=2000
    # non_white = 100 * (1 - 600/2000) = 70.0
    assert row["pct_non_white"] == pytest.approx(70.0)
    # Hispanic summed = 300+500=800, total=2000 -> 40.0
    assert row["pct_hispanic_or_latino"] == pytest.approx(40.0)
    # Black summed=100+200=300, total(B02001)=1000+1000=2000 -> 15.0
    assert row["pct_black_or_african_american"] == pytest.approx(15.0)
    # Asian summed=150+100=250 -> 12.5
    assert row["pct_asian"] == pytest.approx(12.5)
    # Two-or-more summed=50+30=80 -> 4.0
    assert row["pct_two_or_more_races"] == pytest.approx(4.0)
    # Foreign born summed=250+400=650, total(B05002)=1000+1000=2000 -> 32.5
    assert row["pct_immigrant"] == pytest.approx(32.5)
    # Detailed national origin: Mexico summed=60+90=150, total(B05006)=250+400=650 -> ~23.077
    assert row["pct_foreign_born_mexico"] == pytest.approx(100 * 150 / 650)
