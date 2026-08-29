"""Label-driven demographic category extraction and tract->NTA aggregation.

Every percentage is computed by first summing raw ACS estimates across all
tracts belonging to an NTA, then dividing -- never by averaging tract-level
percentages. See spec section 2 for why.
"""
import re

import pandas as pd

from pipeline.census_client import fetch_acs_group, fetch_group_labels


def _variable_for_label(labels: dict[str, str], predicate) -> str:
    matches = [code for code, label in labels.items() if predicate(label)]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly 1 label match, got {matches}")
    return matches[0]


def _summed_by_nta(data: pd.DataFrame, variable: str, tract_to_nta: pd.DataFrame) -> pd.Series:
    merged = data[data["variable"] == variable].merge(tract_to_nta, on="GEOID", how="inner")
    return merged.groupby("NTA2020")["estimate"].sum()


def _country_slug(label: str) -> str:
    country_name = label.rsplit("!!", 1)[-1]
    slug = re.sub(r"[^a-z0-9]+", "_", country_name.lower()).strip("_")
    return slug


def build_nta_demographics(tract_to_nta: pd.DataFrame) -> pd.DataFrame:
    b03002_labels = fetch_group_labels("B03002")
    b03002_data = fetch_acs_group("B03002")
    b02001_labels = fetch_group_labels("B02001")
    b02001_data = fetch_acs_group("B02001")
    b05002_labels = fetch_group_labels("B05002")
    b05002_data = fetch_acs_group("B05002")
    b05006_labels = fetch_group_labels("B05006")
    b05006_data = fetch_acs_group("B05006")

    # Real ACS labels sometimes carry a trailing colon on category rows that
    # have further sub-breakdowns (e.g. "...Hispanic or Latino:" when the
    # table then breaks Hispanic/Latino down further) -- confirmed against
    # the live API in Task 6. Every endswith() check below strips a trailing
    # colon first so matching doesn't depend on whether a given vintage adds
    # or omits it.
    b03002_total_var = _variable_for_label(b03002_labels, lambda l: l == "Estimate!!Total:")
    white_alone_var = _variable_for_label(
        b03002_labels,
        lambda l: "Not Hispanic or Latino" in l and l.rstrip(":").endswith("White alone"),
    )
    hispanic_var = _variable_for_label(
        b03002_labels, lambda l: l.rstrip(":").endswith("Hispanic or Latino")
    )

    b02001_total_var = _variable_for_label(b02001_labels, lambda l: l == "Estimate!!Total:")
    black_var = _variable_for_label(b02001_labels, lambda l: "Black or African American alone" in l)
    asian_var = _variable_for_label(b02001_labels, lambda l: l.rstrip(":").endswith("Asian alone"))
    two_or_more_var = _variable_for_label(b02001_labels, lambda l: "Two or more races" in l)

    b05002_total_var = _variable_for_label(b05002_labels, lambda l: l == "Estimate!!Total:")
    foreign_born_var = _variable_for_label(b05002_labels, lambda l: "Foreign born" in l)

    b05006_total_var = _variable_for_label(b05006_labels, lambda l: l == "Estimate!!Total:")
    country_vars = {
        code: label for code, label in b05006_labels.items()
        if code != b05006_total_var and "!!" in label
    }

    b03002_total = _summed_by_nta(b03002_data, b03002_total_var, tract_to_nta)
    white_alone = _summed_by_nta(b03002_data, white_alone_var, tract_to_nta)
    hispanic = _summed_by_nta(b03002_data, hispanic_var, tract_to_nta)

    b02001_total = _summed_by_nta(b02001_data, b02001_total_var, tract_to_nta)
    black = _summed_by_nta(b02001_data, black_var, tract_to_nta)
    asian = _summed_by_nta(b02001_data, asian_var, tract_to_nta)
    two_or_more = _summed_by_nta(b02001_data, two_or_more_var, tract_to_nta)

    b05002_total = _summed_by_nta(b05002_data, b05002_total_var, tract_to_nta)
    foreign_born = _summed_by_nta(b05002_data, foreign_born_var, tract_to_nta)

    b05006_total = _summed_by_nta(b05006_data, b05006_total_var, tract_to_nta)

    # NOTE: groupby("NTA2020")["estimate"].sum() produces a Series whose
    # *index* is named "NTA2020". Building a DataFrame via a dict literal
    # that both supplies these Series (which align on that named index) and
    # a separate "NTA2020": <index> entry leaves the resulting DataFrame
    # with a column named "NTA2020" *and* a row index also named
    # "NTA2020" -- pandas raises "'NTA2020' is both an index level and a
    # column label" the moment that frame is used in .merge(on="NTA2020").
    # Instead, let the dict-of-Series construction keep "NTA2020" as the
    # (unlabeled-as-column) index, then reset_index() to promote it to a
    # real column and give the frame a fresh default row index.
    result = pd.DataFrame({
        "pct_non_white": 100 * (1 - white_alone / b03002_total),
        "pct_hispanic_or_latino": 100 * hispanic / b03002_total,
    }).reset_index()
    result = result.merge(
        pd.DataFrame({
            "pct_black_or_african_american": 100 * black / b02001_total,
            "pct_asian": 100 * asian / b02001_total,
            "pct_two_or_more_races": 100 * two_or_more / b02001_total,
        }).reset_index(),
        on="NTA2020",
    )
    result = result.merge(
        pd.DataFrame({
            "pct_immigrant": 100 * foreign_born / b05002_total,
        }).reset_index(),
        on="NTA2020",
    )

    for code, label in country_vars.items():
        slug = _country_slug(label)
        country_by_nta = _summed_by_nta(b05006_data, code, tract_to_nta)
        result[f"pct_foreign_born_{slug}"] = 100 * country_by_nta.reindex(result["NTA2020"]).values / b05006_total.reindex(result["NTA2020"]).values

    return result
