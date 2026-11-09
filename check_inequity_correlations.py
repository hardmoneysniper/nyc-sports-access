"""Exploratory check, NOT wired into the live site: does any inequity-related
demographic variable (race/ethnicity %, immigrant %, median household income,
youth %) or other NTA-level variable (population, density) have a POSITIVE
correlation with accessibility -- i.e. a NEGATIVE correlation with average
travel time, since shorter travel time means better access?

Uses raw average travel time across all 21 SPORT_TYPE_GROUPS (uncontrolled
for density), not burden_index/access_gap, because those are already
density-conditioned residuals -- the right lens for "is this neighborhood
underserved relative to its own density," but the wrong one for the plain
question "do richer/whiter/more-native-born neighborhoods just have shorter
trips." Answers the project owner's question, 2026-11-09.
"""
import geopandas as gpd
from dotenv import load_dotenv
from scipy import stats

import export_dashboard_data as e
from pipeline import config

load_dotenv()

nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")
merged = e._load_merged_with_travel_time()
merged["density"] = e._nta_density(merged)

group_cols = [f"travel_time_{g}" for g in config.SPORT_TYPE_GROUPS]
merged["avg_travel_time"] = merged[group_cols].mean(axis=1, skipna=True)

extra_cols = ["median_household_income", "youth_population", "pct_youth"]
keep = ["NTA2020"] + e.DEMOGRAPHIC_COLUMNS + extra_cols
merged = merged.merge(nta[keep], on="NTA2020", how="left")

STANDARD_VARS = {
    "pct_non_white": "% Non-white",
    "pct_hispanic_or_latino": "% Hispanic or Latino",
    "pct_black_or_african_american": "% Black or African American",
    "pct_asian": "% Asian",
    "pct_two_or_more_races": "% Two or more races",
    "pct_immigrant": "% Immigrant / foreign-born",
    "median_household_income": "Median household income ($)",
    "pct_youth": "% Youth (under 18)",
}
OTHER_VARS = {
    "total_population": "Total population",
    "density": "Population density (people/sq mi)",
    "youth_population": "Youth population (count)",
}


def corr(col, target):
    valid = merged[col].notna() & merged[target].notna()
    if valid.sum() < 10:
        return None
    r, p = stats.pearsonr(merged.loc[valid, col], merged.loc[valid, target])
    return r, p, int(valid.sum())


print("=== vs avg_travel_time (raw, uncontrolled; negative r = better access) ===")
rows = []
for col, label in {**STANDARD_VARS, **OTHER_VARS}.items():
    res = corr(col, "avg_travel_time")
    if res:
        r, p, n = res
        rows.append((label, r, p, n))
rows.sort(key=lambda x: x[1])
for label, r, p, n in rows:
    tag = "better access" if r < 0 else "worse access"
    print(f"{label:<36} r={r:+.3f}  p={p:.4f}  n={n:4d}  -> higher value correlates with {tag}")

country_cols = [c for c in nta.columns if c.startswith("pct_foreign_born_")]
merged2 = merged.merge(nta[["NTA2020"] + country_cols], on="NTA2020", how="left")
country_rows = []
for col in country_cols:
    valid = merged2[col].notna() & merged2["avg_travel_time"].notna() & (merged2[col] > 0)
    if valid.sum() < 15:
        continue
    r, p = stats.pearsonr(merged2.loc[valid, col], merged2.loc[valid, "avg_travel_time"])
    country_rows.append((col.replace("pct_foreign_born_", ""), r, p, int(valid.sum())))
country_rows.sort(key=lambda x: x[1])

print("\n=== country-of-birth % vs avg_travel_time: top 8 BETTER access (most negative r) ===")
for name, r, p, n in country_rows[:8]:
    print(f"{name:<24} r={r:+.3f}  p={p:.4f}  n={n:4d}")

print("\n=== country-of-birth % vs avg_travel_time: top 8 WORSE access (most positive r) ===")
for name, r, p, n in sorted(country_rows, key=lambda x: -x[1])[:8]:
    print(f"{name:<24} r={r:+.3f}  p={p:.4f}  n={n:4d}")

print(f"\n{len(country_rows)} countries with n>=15 tested.")
