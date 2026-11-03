"""Grouped-median household income, by NTA.

ACS table B19001 ("Household Income in the Past 12 Months") publishes
household COUNTS in 16 income brackets per census tract -- unlike the
percentage-category tables in demographics.py, there is no single
per-tract "household income" number to average or sum directly, and ACS
doesn't publish a tract-level median from this table either. Bracket
counts are summed across an NTA's tracts first (same aggregation rule as
every other category in this project -- raw counts first, derived
statistic second -- see demographics.py's module docstring), then the
NTA-level median is estimated from the aggregated bracket counts via the
standard grouped-median (linear interpolation within the bracket
containing the 50th household) formula.

Bracket boundaries are parsed from the table's own label text (e.g.
"$10,000 to $14,999"), not hardcoded by variable code, matching this
project's label-driven convention (demographics.py's
`_variable_for_label`) -- ACS variable codes are stable within a table in
practice, but the actual dollar boundaries they mean are only stated in
the label.
"""
import re

import pandas as pd

from pipeline.census_client import fetch_acs_group, fetch_group_labels

INCOME_TABLE = "B19001"


def _bracket_bounds(label: str) -> tuple[float, float | None]:
    """Parses a B19001 bracket label into (lower, upper) bounds in
    dollars, where upper is the first dollar NOT in the bracket (so bracket
    width is upper - lower). Returns upper=None for the open-ended top
    bracket ("$200,000 or more"), which has no stated upper bound.
    """
    text = label.rsplit("!!", 1)[-1]
    if text.lower().startswith("less than"):
        return 0.0, float(re.sub(r"[^\d]", "", text))
    if "or more" in text.lower():
        return float(re.sub(r"[^\d]", "", text)), None
    low_str, high_str = text.split(" to ")
    lower = float(re.sub(r"[^\d]", "", low_str))
    upper = float(re.sub(r"[^\d]", "", high_str)) + 1
    return lower, upper


def build_nta_median_household_income(tract_to_nta: pd.DataFrame) -> pd.DataFrame:
    """Returns one row per NTA2020 with median_household_income (dollars).

    NaN for an NTA with 0 households (no income to have a median of -- same
    "legitimate NaN, not a bug" precedent as demographics.py's zero-total
    percentages) OR for the rare case where the interpolated median would
    fall inside the open-ended "$200,000 or more" bracket, which has no
    label-stated width to interpolate within -- not expected for any real
    NYC NTA given the live distribution (checked: it doesn't occur), but
    left as an explicit NaN rather than an assumed/guessed cap if it ever
    did.
    """
    labels = fetch_group_labels(INCOME_TABLE)
    data = fetch_acs_group(INCOME_TABLE)

    total_var = next(code for code, label in labels.items() if label == "Estimate!!Total:")
    bracket_vars = [code for code in labels if code not in (total_var, "NAME")]
    bounds = {v: _bracket_bounds(labels[v]) for v in bracket_vars}
    # Walked in ascending income order below, not whatever order the API
    # happened to return variable codes in.
    ordered_vars = sorted(bracket_vars, key=lambda v: bounds[v][0])

    merged = data[data["variable"].isin(bracket_vars + [total_var])].merge(
        tract_to_nta, on="GEOID", how="inner"
    )
    by_nta = merged.groupby(["NTA2020", "variable"])["estimate"].sum().unstack("variable")

    rows = []
    for nta_code, row in by_nta.iterrows():
        total_households = row.get(total_var, 0) or 0
        median = float("nan")
        if total_households > 0:
            half = total_households / 2
            cumulative = 0.0
            for v in ordered_vars:
                count = row.get(v, 0) or 0
                lower, upper = bounds[v]
                if cumulative + count >= half:
                    if upper is not None:
                        frac = (half - cumulative) / count if count else 0.0
                        median = lower + frac * (upper - lower)
                    break
                cumulative += count
        rows.append({"NTA2020": nta_code, "median_household_income": median})

    return pd.DataFrame(rows)
