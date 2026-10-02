"""Population-conditioned soccer access burden score, one row per NTA.

Supports the "statement page" narrative: population density only weakly
predicts soccer travel time citywide, and these are the specific NTAs where
access is worse than their own density would predict, weighted by how many
residents that affects. See docs/SOCCER_ACCESS_BURDEN_METHODOLOGY.md for the
full derivation and how to read the results.

Reads already-computed pipeline output (nta_output.geojson,
nta_output_combined_time.csv) -- does not run r5py or touch the underlying
pipeline. Writes data/processed/soccer_access_burden_top20.csv.
"""
import geopandas as gpd
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from scipy import stats

from pipeline import config

load_dotenv()

TOP_N = 20
SQFT_PER_SQMI = 5280**2


def load_population_and_travel_time() -> gpd.GeoDataFrame:
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")[
        ["NTA2020", "NTAName", "total_population", "geometry"]
    ]
    times = pd.read_csv(config.PROCESSED_DIR / "nta_output_combined_time.csv")[
        ["NTA2020", "travel_time_soccer"]
    ]
    df = nta.merge(times, on="NTA2020", how="inner")

    # Drop NTAs with no resident population (parks, cemeteries, airports,
    # etc.) -- log(density) is undefined for them and they have no
    # "burden" to weight since nobody lives there to be underserved.
    df = df.dropna(subset=["travel_time_soccer", "total_population"])
    df = df[df["total_population"] > 0].copy()

    # EPSG:2263 (feet) is this pipeline's standard projected CRS (see
    # docs/METHODOLOGY.md) -- used only for this area computation, not for
    # the geometry carried forward.
    area_sqmi = df.to_crs(config.CRS_PROJECTED).geometry.area / SQFT_PER_SQMI
    df["density"] = df["total_population"] / area_sqmi
    return df


def compute_burden_scores(df: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, dict]:
    df["log_density"] = np.log(df["density"])

    # Density (population per sq mi), not raw population, is the
    # regression predictor -- travel time is fundamentally spatial, and
    # density explains far more of its variance (verified empirically,
    # 2026-09-29: log(density) r^2=0.41 vs log(population) r^2=0.23 here).
    # Two NTAs can share a population but differ hugely in land area, and
    # only density sees that. The burden score below is still weighted by
    # RAW population, not density: weighting represents how many actual
    # residents are affected, and two NTAs with equal population but
    # different density represent the same number of underserved people
    # regardless of how spread out they are. Per project owner
    # instruction, 2026-09-29.
    slope, intercept, r_value, p_value, std_err = stats.linregress(
        df["log_density"], df["travel_time_soccer"]
    )

    df["predicted_travel_time"] = intercept + slope * df["log_density"]
    df["residual"] = df["travel_time_soccer"] - df["predicted_travel_time"]
    df["excess_residual"] = df["residual"].clip(lower=0)
    # Population in units of 10,000 residents -- a pure display-scale
    # choice (dividing every NTA's weight by the same constant changes
    # nothing about the ranking, only how large the numbers look). Per
    # project owner instruction, 2026-09-29.
    df["burden_score"] = df["excess_residual"] * (df["total_population"] / 10_000)

    fit_stats = {
        "n": len(df),
        "slope": slope,
        "intercept": intercept,
        "r": r_value,
        "r_squared": r_value ** 2,
        "p_value": p_value,
        "std_err": std_err,
    }
    return df, fit_stats


def main():
    df = load_population_and_travel_time()
    df, fit_stats = compute_burden_scores(df)

    print(f"NTAs with usable population + travel time: {fit_stats['n']}")
    print(f"slope = {fit_stats['slope']:.4f}, r = {fit_stats['r']:.4f}, "
          f"r^2 = {fit_stats['r_squared']:.4f}, p = {fit_stats['p_value']:.4g}")

    ranked = df.sort_values("burden_score", ascending=False).reset_index(drop=True)
    ranked.insert(0, "rank", ranked.index + 1)

    top_n = ranked.head(TOP_N)[
        ["rank", "NTA2020", "NTAName", "total_population", "density", "travel_time_soccer",
         "predicted_travel_time", "residual", "burden_score"]
    ]

    output_path = config.PROCESSED_DIR / "soccer_access_burden_top20.csv"
    top_n.to_csv(output_path, index=False)
    print(f"Wrote {output_path} (top {TOP_N} of {fit_stats['n']} NTAs by burden score)")


if __name__ == "__main__":
    main()
