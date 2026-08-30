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


def _is_leaf_label(label: str, all_labels: list[str]) -> bool:
    """A row is a leaf (most granular level available) if no other row is
    nested underneath it. Nesting must be checked at a "!!" hierarchy
    boundary, not as a raw string prefix -- otherwise a label like
    "...Caribbean:!!Dominica" is wrongly treated as the parent of the
    sibling row "...Caribbean:!!Dominican Republic" (confirmed against the
    live B05006 table: "Dominican Republic".startswith("Dominica") is True
    as a plain string check, even though the two are siblings, not
    parent/child).
    """
    return not any(other != label and other.startswith(label + "!!") for other in all_labels)


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
    #
    # Label casing/punctuation is also NOT stable across tables (confirmed
    # against the live 2024 ACS5 API): B02001 uses Title Case ("Two or More
    # Races"), B05002 hyphenates ("Foreign-born"), and B03002's Hispanic row
    # has a sibling "Not Hispanic or Latino" row whose label is a superstring
    # of "Hispanic or Latino" -- a plain substring/endswith check on the full
    # label matches both rows. Every predicate below therefore either (a)
    # compares only the exact last "!!"-separated hierarchy segment, or (b)
    # lowercases (and, where relevant, hyphen-normalizes) both sides before a
    # substring check, so it can't accidentally match a sibling row that
    # merely shares a suffix/substring.
    b03002_total_var = _variable_for_label(b03002_labels, lambda l: l == "Estimate!!Total:")
    white_alone_var = _variable_for_label(
        b03002_labels,
        lambda l: "not hispanic or latino" in l.lower() and l.rstrip(":").lower().endswith("white alone"),
    )
    hispanic_var = _variable_for_label(
        b03002_labels, lambda l: l.rstrip(":").rsplit("!!", 1)[-1] == "Hispanic or Latino"
    )

    b02001_total_var = _variable_for_label(b02001_labels, lambda l: l == "Estimate!!Total:")
    black_var = _variable_for_label(
        b02001_labels, lambda l: "black or african american alone" in l.lower()
    )
    asian_var = _variable_for_label(b02001_labels, lambda l: l.rstrip(":").lower().endswith("asian alone"))
    # A plain "in" substring check on the full label would also match the
    # table's own child breakdown rows (e.g. "...Two or More Races:!!Two
    # races including Some Other Race" -- confirmed against the live API),
    # since "two or more races" appears as a prefix segment inside those
    # labels too. endswith() on the last segment (post rstrip) selects only
    # the "Two or More Races:" total row itself.
    two_or_more_var = _variable_for_label(
        b02001_labels, lambda l: l.rstrip(":").lower().endswith("two or more races")
    )

    b05002_total_var = _variable_for_label(b05002_labels, lambda l: l == "Estimate!!Total:")
    # Same trap as two_or_more_var above: B05002 nests citizenship/region
    # breakdowns under the "Foreign-born:" row itself (e.g. "...Foreign-born:
    # !!Naturalized U.S. citizen!!Asia" -- confirmed against the live API),
    # so a plain "in" substring check matches those child rows too.
    # endswith() on the last segment selects only the "Foreign-born:" total.
    foreign_born_var = _variable_for_label(
        b05002_labels, lambda l: l.rstrip(":").lower().replace("-", " ").endswith("foreign born")
    )

    b05006_total_var = _variable_for_label(b05006_labels, lambda l: l == "Estimate!!Total:")
    b05006_all_labels = list(b05006_labels.values())
    country_vars = {
        code: label for code, label in b05006_labels.items()
        if code != b05006_total_var
        and "!!" in label
        and _is_leaf_label(label, b05006_all_labels)
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
    # NOTE: no explicit guard against total == 0 here -- an NTA with zero
    # total population produces NaN (0/0) or inf (n/0), and NaN/inf is
    # actually the correct signal for "no population data for this NTA",
    # not a bug to hide.
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
        how="outer",
    )
    result = result.merge(
        pd.DataFrame({
            "pct_immigrant": 100 * foreign_born / b05002_total,
        }).reset_index(),
        on="NTA2020",
        how="outer",
    )

    # Guards against two B05006 leaf labels slugifying to the same string
    # (e.g. differently-punctuated variants of the same country name in a
    # future ACS vintage) silently clobbering one column with another --
    # consistent with the module's fail-loudly discipline elsewhere
    # (_variable_for_label already raises on non-unique matches).
    slug_to_code_label: dict[str, tuple[str, str]] = {}
    for code, label in country_vars.items():
        slug = _country_slug(label)
        column = f"pct_foreign_born_{slug}"
        if slug in slug_to_code_label:
            prior_code, prior_label = slug_to_code_label[slug]
            raise ValueError(
                f"Country slug collision: B05006 codes {prior_code!r} "
                f"({prior_label!r}) and {code!r} ({label!r}) both slugify to "
                f"{slug!r}, which would silently overwrite column {column!r}."
            )
        slug_to_code_label[slug] = (code, label)

        country_by_nta = _summed_by_nta(b05006_data, code, tract_to_nta)
        result[column] = 100 * country_by_nta.reindex(result["NTA2020"]).values / b05006_total.reindex(result["NTA2020"]).values

    return result
