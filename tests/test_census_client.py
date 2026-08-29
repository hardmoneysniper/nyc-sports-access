# tests/test_census_client.py
from unittest.mock import patch

import pandas as pd

from pipeline import census_client


FAKE_GROUP_RESPONSE = [
    ["GEOID", "NAME", "B03002_001E", "B03002_001EA", "B03002_012E", "B03002_012EA", "state", "county", "tract"],
    ["36061000100", "Census Tract 1, New York County, New York", "1500", "", "300", "", "36", "061", "000100"],
]

FAKE_GROUP_LABELS_RESPONSE = {
    "variables": {
        "B03002_001E": {"label": "Estimate!!Total:", "concept": "HISPANIC OR LATINO ORIGIN BY RACE"},
        "B03002_012E": {"label": "Estimate!!Total:!!Hispanic or Latino", "concept": "HISPANIC OR LATINO ORIGIN BY RACE"},
    }
}


def test_fetch_group_labels_maps_variable_to_label():
    with patch("pipeline.census_client.requests.get") as mock_get:
        mock_get.return_value.json.return_value = FAKE_GROUP_LABELS_RESPONSE
        mock_get.return_value.raise_for_status.return_value = None
        labels = census_client.fetch_group_labels("B03002")
    assert labels["B03002_012E"] == "Estimate!!Total:!!Hispanic or Latino"


def test_fetch_acs_group_returns_tidy_long_dataframe(monkeypatch):
    monkeypatch.setenv("CENSUS_API_KEY", "test-key-not-real")
    with patch("pipeline.census_client.requests.get") as mock_get:
        mock_get.return_value.json.return_value = FAKE_GROUP_RESPONSE
        mock_get.return_value.raise_for_status.return_value = None
        df = census_client.fetch_acs_group("B03002")
    expected = pd.DataFrame(
        {
            "GEOID": ["36061000100", "36061000100"],
            "variable": ["B03002_001E", "B03002_012E"],
            "estimate": [1500.0, 300.0],
        }
    )
    pd.testing.assert_frame_equal(
        df[["GEOID", "variable", "estimate"]].reset_index(drop=True), expected
    )
