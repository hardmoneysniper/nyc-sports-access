"""Thin client for pulling ACS group data at census-tract level for NYC."""
import os

import pandas as pd
import requests

from pipeline import config

BASE_URL = "https://api.census.gov/data/{year}/acs/acs5"


def _api_key() -> str:
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        raise RuntimeError("CENSUS_API_KEY not set (check .env is loaded)")
    return key


def fetch_group_labels(table_id: str) -> dict[str, str]:
    url = f"{BASE_URL.format(year=config.CENSUS_ACS_YEAR)}/groups/{table_id}.json"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    variables = response.json()["variables"]
    return {code: meta["label"] for code, meta in variables.items() if code.endswith("E")}


def fetch_acs_group(table_id: str) -> pd.DataFrame:
    county_list = ",".join(config.NYC_COUNTY_FIPS.values())
    response = requests.get(
        BASE_URL.format(year=config.CENSUS_ACS_YEAR),
        params={
            "get": f"group({table_id})",
            "for": "tract:*",
            "in": f"state:{config.STATE_FIPS}+county:{county_list}",
            "key": _api_key(),
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    header, *data_rows = payload
    full_df = pd.DataFrame(data_rows, columns=header)
    if "GEOID" not in full_df.columns:
        # The live API returns GEO_ID (e.g. "1400000US36061000100") plus
        # separate state/county/tract columns rather than a plain GEOID
        # field; build the standard 11-digit tract GEOID used elsewhere in
        # this pipeline (see pipeline/geography.py) by concatenating them.
        full_df["GEOID"] = full_df["state"] + full_df["county"] + full_df["tract"]
    estimate_columns = [c for c in header if c.endswith("E") and c.startswith(table_id)]
    long_df = full_df.melt(
        id_vars=["GEOID"], value_vars=estimate_columns, var_name="variable", value_name="estimate"
    )
    long_df["estimate"] = pd.to_numeric(long_df["estimate"], errors="coerce").astype(float)
    return long_df
