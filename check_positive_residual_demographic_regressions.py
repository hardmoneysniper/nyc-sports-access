"""Exploratory check, NOT wired into the live site yet: for all 21 sports x
6 demographic categories (126 pairs), regress demographic_pct ~ raw travel
time residual (NTA's actual travel time minus what its own density would
predict), keeping ONLY NTAs with a positive residual (worse access than
expected -- negative/better-than-expected NTAs are dropped entirely, not
clipped to 0).

This replaces burden_index (population-weighted, floored at 0) as the
x-axis for this specific question, per project owner instruction,
2026-11-02: burden_index's population weighting conflates "how bad is
access" with "how many people live here," and its floor-at-0 throws away
half the distribution before any correlation runs -- see the chat
discussion this script follows up on. Prints every pair's r (and r^2),
sorted strongest-first, so we can eyeball whether this is a clearer signal
than burden_index vs. demographic % was, before deciding whether to wire it
into BurdenDemographicScatter.tsx.
"""
from dotenv import load_dotenv
from scipy import stats

import export_dashboard_data as e
from pipeline import config

load_dotenv()

DEMOGRAPHIC_LABELS = {
    "pct_non_white": "Non-white",
    "pct_hispanic_or_latino": "Hispanic or Latino",
    "pct_black_or_african_american": "Black or African American",
    "pct_asian": "Asian",
    "pct_two_or_more_races": "Two or more races",
    "pct_immigrant": "Immigrant / foreign-born",
}


def main():
    merged = e._load_merged_with_travel_time()
    demo = __import__("geopandas").read_file(config.PROCESSED_DIR / "nta_output.geojson")[
        ["NTA2020"] + e.DEMOGRAPHIC_COLUMNS
    ]
    merged = merged.merge(demo, on="NTA2020", how="left")
    residual_by_group = e._compute_residuals(merged)

    results = []
    for sport, residual in residual_by_group.items():
        positive = residual > 0
        for demo_col in e.DEMOGRAPHIC_COLUMNS:
            valid = positive & residual.notna() & merged[demo_col].notna()
            if valid.sum() < 10:
                continue
            slope, intercept, r, p, _ = stats.linregress(residual[valid], merged.loc[valid, demo_col])
            results.append(
                {
                    "sport": sport,
                    "demographic": DEMOGRAPHIC_LABELS[demo_col],
                    "n": int(valid.sum()),
                    "slope": slope,
                    "r": r,
                    "r2": r**2,
                    "p": p,
                }
            )

    results.sort(key=lambda row: abs(row["r"]), reverse=True)

    print(f"{'Sport':<16} {'Demographic':<26} {'n':>4} {'slope':>8} {'r':>7} {'r^2':>6} {'p':>8}")
    for row in results:
        print(
            f"{row['sport']:<16} {row['demographic']:<26} {row['n']:>4} "
            f"{row['slope']:>8.3f} {row['r']:>7.3f} {row['r2']:>6.3f} {row['p']:>8.4f}"
        )

    print(f"\n{len(results)} pairs computed.")
    strong = [r for r in results if abs(r["r"]) >= 0.3]
    print(f"{len(strong)} pairs with |r| >= 0.3.")


if __name__ == "__main__":
    main()
