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
    # Real ACS labels carry a trailing colon on rows with further
    # sub-breakdowns (confirmed against the live API in Task 6) -- this
    # fixture intentionally includes it so the test exercises the
    # rstrip(":") handling in demographics.py, not a simplified label.
    "B03002_002E": "Estimate!!Total:!!Not Hispanic or Latino:",
    "B03002_003E": "Estimate!!Total:!!Not Hispanic or Latino:!!White alone",
    "B03002_012E": "Estimate!!Total:!!Hispanic or Latino:",
}
B02001_LABELS = {
    "B02001_001E": "Estimate!!Total:",
    "B02001_003E": "Estimate!!Total:!!Black or African American alone",
    "B02001_005E": "Estimate!!Total:!!Asian alone",
    # Real ACS labels use Title Case here ("Two or More Races") -- confirmed
    # against the live API. The old buggy predicate ("Two or more races" in
    # l) would match 0 rows against this fixture, catching that bug.
    "B02001_008E": "Estimate!!Total:!!Two or More Races:",
}
B05002_LABELS = {
    "B05002_001E": "Estimate!!Total:",
    # Real ACS labels hyphenate this row ("Foreign-born:") -- confirmed
    # against the live API. The old buggy predicate ("Foreign born" in l)
    # would match 0 rows against this fixture, catching that bug.
    "B05002_013E": "Estimate!!Total:!!Foreign-born:",
}
B05006_LABELS = {
    "B05006_001E": "Estimate!!Total:",
    # Parent row with trailing colon (has children nested under it)
    "B05006_049E": "Estimate!!Total:!!Latin America:",
    # Child of Latin America
    "B05006_050E": "Estimate!!Total:!!Latin America:!!Mexico",
    # Sibling-prefix case: two leaf rows where one name is a prefix of the other
    # Both are under Caribbean and both should be included (not parent/child)
    "B05006_051E": "Estimate!!Total:!!Caribbean:!!Dominica",
    "B05006_052E": "Estimate!!Total:!!Caribbean:!!Dominican Republic",
}
B01001_LABELS = {
    "B01001_001E": "Estimate!!Total:",
    "B01001_003E": "Estimate!!Total:!!Male:!!Under 5 years",
    "B01001_004E": "Estimate!!Total:!!Male:!!5 to 9 years",
    "B01001_005E": "Estimate!!Total:!!Male:!!10 to 14 years",
    "B01001_006E": "Estimate!!Total:!!Male:!!15 to 17 years",
    # A non-youth, non-senior bracket included deliberately, so the test
    # also catches an over-broad predicate that accidentally sweeps in
    # middle-age brackets.
    "B01001_011E": "Estimate!!Total:!!Male:!!25 to 29 years",
    "B01001_020E": "Estimate!!Total:!!Male:!!65 and 66 years",
    "B01001_021E": "Estimate!!Total:!!Male:!!67 to 69 years",
    "B01001_022E": "Estimate!!Total:!!Male:!!70 to 74 years",
    "B01001_023E": "Estimate!!Total:!!Male:!!75 to 79 years",
    "B01001_024E": "Estimate!!Total:!!Male:!!80 to 84 years",
    "B01001_025E": "Estimate!!Total:!!Male:!!85 years and over",
    "B01001_027E": "Estimate!!Total:!!Female:!!Under 5 years",
    "B01001_028E": "Estimate!!Total:!!Female:!!5 to 9 years",
    "B01001_029E": "Estimate!!Total:!!Female:!!10 to 14 years",
    "B01001_030E": "Estimate!!Total:!!Female:!!15 to 17 years",
    "B01001_044E": "Estimate!!Total:!!Female:!!65 and 66 years",
    "B01001_045E": "Estimate!!Total:!!Female:!!67 to 69 years",
    "B01001_046E": "Estimate!!Total:!!Female:!!70 to 74 years",
    "B01001_047E": "Estimate!!Total:!!Female:!!75 to 79 years",
    "B01001_048E": "Estimate!!Total:!!Female:!!80 to 84 years",
    "B01001_049E": "Estimate!!Total:!!Female:!!85 years and over",
}
B17001_LABELS = {
    "B17001_001E": "Estimate!!Total:",
    "B17001_002E": "Estimate!!Total:!!Income in the past 12 months below poverty level:",
}
B25044_LABELS = {
    "B25044_001E": "Estimate!!Total:",
    "B25044_003E": "Estimate!!Total:!!Owner occupied:!!No vehicle available",
    "B25044_010E": "Estimate!!Total:!!Renter occupied:!!No vehicle available",
}

# The two tracts intentionally have UNEQUAL table totals (1000 vs 3000) for
# every category table, not just B05006. With equal totals, sum-then-divide
# and average-of-tract-percentages produce numerically identical results,
# so a test built on equal totals could not tell the two computation
# strategies apart -- it would pass even if someone accidentally averaged
# tract-level percentages instead of summing raw counts first.
B03002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000100",
                  "36061000200", "36061000200", "36061000200"],
        "variable": ["B03002_001E", "B03002_003E", "B03002_012E"] * 2,
        "estimate": [1000.0, 400.0, 300.0, 3000.0, 900.0, 1200.0],
    }
)
B02001_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100"] * 4 + ["36061000200"] * 4,
        "variable": ["B02001_001E", "B02001_003E", "B02001_005E", "B02001_008E"] * 2,
        "estimate": [1000.0, 100.0, 150.0, 50.0, 3000.0, 600.0, 300.0, 90.0],
    }
)
B05002_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B05002_001E", "B05002_013E"] * 2,
        "estimate": [1000.0, 250.0, 3000.0, 900.0],
    }
)
B05006_DATA = pd.DataFrame(
    {
        "GEOID": (["36061000100"] * 5 + ["36061000200"] * 5),
        "variable": (["B05006_001E", "B05006_049E", "B05006_050E", "B05006_051E", "B05006_052E"] * 2),
        "estimate": [250.0, 70.0, 60.0, 10.0, 5.0, 400.0, 105.0, 90.0, 15.0, 8.0],
    }
)
B01001_VARS = [
    "B01001_001E", "B01001_003E", "B01001_004E", "B01001_005E", "B01001_006E",
    "B01001_011E",
    "B01001_020E", "B01001_021E", "B01001_022E", "B01001_023E", "B01001_024E", "B01001_025E",
    "B01001_027E", "B01001_028E", "B01001_029E", "B01001_030E",
    "B01001_044E", "B01001_045E", "B01001_046E", "B01001_047E", "B01001_048E", "B01001_049E",
]
B01001_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100"] * len(B01001_VARS) + ["36061000200"] * len(B01001_VARS),
        "variable": B01001_VARS * 2,
        # Tract 1 (total 1000): 4 male youth brackets 50/40/30/20, one adult
        # bracket (25-29) 200 (should be ignored), 6 male senior brackets
        # 10/8/12/6/4/2 (sum 42), 4 female youth brackets 45/35/25/15, 6
        # female senior brackets 9/7/11/5/3/1 (sum 36). Youth sum = 260,
        # senior sum = 78.
        # Tract 2 (total 3000): male youth 150/140/130/120, adult 500
        # (ignored), male senior 30/24/36/18/12/6 (sum 126), female youth
        # 145/135/125/115, female senior 27/21/33/15/9/3 (sum 108). Youth
        # sum = 1060, senior sum = 234.
        "estimate": [
            1000.0, 50.0, 40.0, 30.0, 20.0, 200.0,
            10.0, 8.0, 12.0, 6.0, 4.0, 2.0,
            45.0, 35.0, 25.0, 15.0,
            9.0, 7.0, 11.0, 5.0, 3.0, 1.0,
            3000.0, 150.0, 140.0, 130.0, 120.0, 500.0,
            30.0, 24.0, 36.0, 18.0, 12.0, 6.0,
            145.0, 135.0, 125.0, 115.0,
            27.0, 21.0, 33.0, 15.0, 9.0, 3.0,
        ],
    }
)
B17001_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000200", "36061000200"],
        "variable": ["B17001_001E", "B17001_002E"] * 2,
        # Tract 1: total 900, below poverty 180. Tract 2: total 2800, below
        # poverty 420. Sum: total 3700, below poverty 600 -> 16.216...%
        "estimate": [900.0, 180.0, 2800.0, 420.0],
    }
)
B25044_DATA = pd.DataFrame(
    {
        "GEOID": ["36061000100"] * 3 + ["36061000200"] * 3,
        "variable": ["B25044_001E", "B25044_003E", "B25044_010E"] * 2,
        # Tract 1: total 800, no-vehicle owner 50 + renter 100 = 150.
        # Tract 2: total 2500, no-vehicle owner 200 + renter 300 = 500.
        # Sum: total 3300, no-vehicle 650 -> 19.6969...%
        "estimate": [800.0, 50.0, 100.0, 2500.0, 200.0, 300.0],
    }
)


def _fake_fetch_group_labels(table_id):
    return {
        "B03002": B03002_LABELS, "B02001": B02001_LABELS,
        "B05002": B05002_LABELS, "B05006": B05006_LABELS,
        "B01001": B01001_LABELS, "B17001": B17001_LABELS, "B25044": B25044_LABELS,
    }[table_id]


def _fake_fetch_acs_group(table_id):
    return {
        "B03002": B03002_DATA, "B02001": B02001_DATA,
        "B05002": B05002_DATA, "B05006": B05006_DATA,
        "B01001": B01001_DATA, "B17001": B17001_DATA, "B25044": B25044_DATA,
    }[table_id]


def test_build_nta_demographics_sums_before_dividing():
    with patch("pipeline.demographics.fetch_group_labels", side_effect=_fake_fetch_group_labels), \
         patch("pipeline.demographics.fetch_acs_group", side_effect=_fake_fetch_acs_group):
        result = demographics.build_nta_demographics(TRACT_TO_NTA)

    row = result[result["NTA2020"] == "MN0101"].iloc[0]
    # Tract totals are unequal (1000 vs 3000) for B03002/B02001/B05002 so
    # sum-then-divide and average-of-tract-percentages give different
    # answers -- these asserted values are the correct sum-then-percent
    # ones; an accidental average-of-percentages implementation would fail.
    #
    # White alone (non-Hispanic) summed = 400+900=1300, total summed=1000+3000=4000
    # non_white = 100 * (1 - 1300/4000) = 67.5
    # (average-of-percentages would give (60+70)/2 = 65.0 -- different)
    # B03002 total summed = 1000+3000 = 4000
    assert row["total_population"] == pytest.approx(4000)
    assert row["pct_non_white"] == pytest.approx(67.5)
    # Hispanic summed = 300+1200=1500, total=4000 -> 37.5
    # (average would give (30+40)/2 = 35.0 -- different)
    assert row["pct_hispanic_or_latino"] == pytest.approx(37.5)
    # Black summed=100+600=700, total(B02001)=1000+3000=4000 -> 17.5
    # (average would give (10+20)/2 = 15.0 -- different)
    assert row["pct_black_or_african_american"] == pytest.approx(17.5)
    # Asian summed=150+300=450 -> 11.25
    # (average would give (15+10)/2 = 12.5 -- different)
    assert row["pct_asian"] == pytest.approx(11.25)
    # Two-or-more summed=50+90=140 -> 3.5
    # (average would give (5+3)/2 = 4.0 -- different)
    assert row["pct_two_or_more_races"] == pytest.approx(3.5)
    # Foreign born summed=250+900=1150, total(B05002)=1000+3000=4000 -> 28.75
    # (average would give (25+30)/2 = 27.5 -- different)
    assert row["pct_immigrant"] == pytest.approx(28.75)
    # Youth (under 18, both sexes) summed across all 8 brackets:
    # tract1 = 50+40+30+20+45+35+25+15 = 260, tract2 = 150+140+130+120+145+135+125+115 = 1060
    # youth_population = 260+1060 = 1320; total(B01001) = 1000+3000 = 4000 -> 33.0
    # (average would give (26+35.333...)/2 != 33.0 -- different; also
    # catches an over-broad predicate, since the fixture's "25 to 29
    # years" adult bracket (200+500=700) is deliberately excluded)
    assert row["youth_population"] == pytest.approx(1320)
    assert row["pct_youth"] == pytest.approx(33.0)
    # Senior (65+, both sexes) summed: tract1 = 42+36 = 78, tract2 = 126+108 = 234
    # senior_population = 78+234 = 312; total(B01001) = 4000 -> 7.8
    assert row["senior_population"] == pytest.approx(312)
    assert row["pct_senior"] == pytest.approx(7.8)
    # Poverty: below summed=180+420=600, total(B17001)=900+2800=3700 -> 16.216...%
    # (average would give (20+15)/2 = 17.5 -- different)
    assert row["pct_poverty"] == pytest.approx(100 * 600 / 3700)
    # No vehicle: summed=150+500=650, total(B25044)=800+2500=3300 -> 19.697...%
    # (average would give (18.75+20)/2 = 19.375 -- different)
    assert row["pct_no_vehicle"] == pytest.approx(100 * 650 / 3300)
    # Detailed national origin: Mexico summed=60+90=150, total(B05006)=250+400=650 -> ~23.077
    assert row["pct_foreign_born_mexico"] == pytest.approx(100 * 150 / 650)

    # Test leaf-node detection: parent-child hierarchy case
    # "Latin America:" (B05006_049E) is a parent with "!!" in its label but has
    # children ("Mexico"), so it should NOT be included in country columns.
    # The child "Mexico" should still be included.
    assert "pct_foreign_born_latin_america" not in result.columns, \
        "Parent row with further sub-breakdowns should be excluded from country columns"
    assert "pct_foreign_born_mexico" in result.columns, \
        "Child row under parent should be included in country columns"

    # Test leaf-node detection: sibling-prefix trap case
    # "Dominica" and "Dominican Republic" are siblings under the same parent
    # (Caribbean), not parent/child. Even though "Dominican Republic".startswith("Dominica")
    # is True as a plain string, the leaf-detection logic uses "!!" boundary checks
    # and should include both as separate columns.
    assert "pct_foreign_born_dominica" in result.columns, \
        "Leaf 'Dominica' should be included even though it is a prefix of sibling 'Dominican Republic'"
    dominica_slug_estim = 10.0 + 15.0  # 25 total
    assert row["pct_foreign_born_dominica"] == pytest.approx(100 * dominica_slug_estim / 650), \
        f"Dominica percentage should be {100 * dominica_slug_estim / 650}"

    assert "pct_foreign_born_dominican_republic" in result.columns, \
        "Leaf 'Dominican Republic' should be included as separate sibling"
    dominican_slug_estim = 5.0 + 8.0  # 13 total
    assert row["pct_foreign_born_dominican_republic"] == pytest.approx(100 * dominican_slug_estim / 650), \
        f"Dominican Republic percentage should be {100 * dominican_slug_estim / 650}"


# Two distinct B05006 leaf labels ("Georgia" under two different parent
# regions) that slugify to the identical string -- simulates the ACS
# publishing the same country name under more than one region breakdown.
# Without a collision guard, the second write to
# result["pct_foreign_born_georgia"] would silently clobber the first
# rather than raising, hiding a real data-modeling problem.
B05006_LABELS_WITH_COLLISION = {
    "B05006_001E": "Estimate!!Total:",
    "B05006_100E": "Estimate!!Total:!!Europe:!!Georgia",
    "B05006_101E": "Estimate!!Total:!!Asia:!!Georgia",
}
B05006_DATA_WITH_COLLISION = pd.DataFrame(
    {
        "GEOID": ["36061000100", "36061000100", "36061000100"],
        "variable": ["B05006_001E", "B05006_100E", "B05006_101E"],
        "estimate": [100.0, 10.0, 20.0],
    }
)


def test_build_nta_demographics_raises_on_country_slug_collision():
    def fake_fetch_group_labels(table_id):
        if table_id == "B05006":
            return B05006_LABELS_WITH_COLLISION
        return _fake_fetch_group_labels(table_id)

    def fake_fetch_acs_group(table_id):
        if table_id == "B05006":
            return B05006_DATA_WITH_COLLISION
        return _fake_fetch_acs_group(table_id)

    with patch("pipeline.demographics.fetch_group_labels", side_effect=fake_fetch_group_labels), \
         patch("pipeline.demographics.fetch_acs_group", side_effect=fake_fetch_acs_group):
        with pytest.raises(ValueError, match="Country slug collision"):
            demographics.build_nta_demographics(TRACT_TO_NTA)
