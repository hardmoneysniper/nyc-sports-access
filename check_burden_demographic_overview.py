"""Exploratory, NOT wired into the live site: summarize burden_index (the
population-weighted, density-conditioned Access Burden Score actually shown
on the dashboard) against every demographic variable we have -- the 6
standard pct_* categories already in frontend/public/data/
burden_index_demographic_regressions.json, PLUS median household income and
% youth, which aren't in that file yet. Also computes one aggregate "overall
burden" (mean burden_index across all 21 sports, same positive-only filter)
per NTA, so there's a single summary number instead of 21 separate sport
rows. Answers the project owner's question, 2026-11-09.
"""
import geopandas as gpd
from dotenv import load_dotenv
from scipy import stats

import export_dashboard_data as e
from pipeline import config

load_dotenv()

nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")
merged = e._load_merged_with_travel_time()
burden_by_group = e._compute_burden_indices(merged)

for group, burden in burden_by_group.items():
    merged[f"burden_index_{group}"] = burden

burden_cols = [f"burden_index_{g}" for g in config.SPORT_TYPE_GROUPS]
# Overall burden: average burden_index across sports, counting a sport's
# burden as 0 (not NaN) wherever that NTA's own density-regression residual
# for that sport was <= 0 (good access) -- same "excess burden, floored"
# semantics as any individual sport's burden_index, just averaged across
# all 21 instead of reported per sport.
merged["burden_overall"] = merged[burden_cols].mean(axis=1, skipna=True)

extra_cols = ["median_household_income", "pct_youth"]
keep = ["NTA2020"] + e.DEMOGRAPHIC_COLUMNS + extra_cols
merged = merged.merge(nta[keep], on="NTA2020", how="left")

VARS = {
    "pct_non_white": "% Non-white",
    "pct_hispanic_or_latino": "% Hispanic or Latino",
    "pct_black_or_african_american": "% Black or African American",
    "pct_asian": "% Asian",
    "pct_two_or_more_races": "% Two or more races",
    "pct_immigrant": "% Immigrant / foreign-born",
    "median_household_income": "Median household income ($)",
    "pct_youth": "% Youth (under 18)",
}

print("=== burden_overall (mean burden_index across 21 sports) vs demographics ===")
print("(burden_overall > 0 kept only, matching the live site's positive-burden filter)\n")
positive = merged["burden_overall"] > 0
rows = []
for col, label in VARS.items():
    valid = positive & merged["burden_overall"].notna() & merged[col].notna()
    if valid.sum() < 10:
        continue
    r, p = stats.pearsonr(merged.loc[valid, col], merged.loc[valid, "burden_overall"])
    rows.append((label, r, p, int(valid.sum())))
rows.sort(key=lambda x: -abs(x[1]))
for label, r, p, n in rows:
    tag = "higher burden" if r > 0 else "lower burden"
    print(f"{label:<36} r={r:+.3f}  p={p:.4f}  n={n:4d}  -> higher value correlates with {tag}")

print(f"\nOverall positive-burden NTAs: {int(positive.sum())} / {len(merged)}")
