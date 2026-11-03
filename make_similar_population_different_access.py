"""Finds NTA pairs with near-identical population but very different
population-weighted average travel time to the nearest soccer field, from
data/processed/soccer_avg_travel_time_by_nta.csv (already filtered to real
residential NTAs -- see make_scatter_soccer_avg_travel_time.py).

Restricted to pairs where the SMALLER of the two NTAs' populations is at
least MIN_POPULATION (50,000) -- a first pass with no population floor
turned up Breezy Point-Belle Harbor-Rockaway Park-Broad Channel (pop.
25,783) vs. Gramercy (pop. 25,905), a 45.7-minute gap on a 0.5% population
difference; the floor here is for a second, larger-population version of
the same question. Per project owner instruction, 2026-10-21 ("find 2 ntas
that have similar population but very different access time"; "choose 2
with larger population").

Within every pair of NTAs, population difference is capped at
MAX_POPULATION_PCT_DIFF (3%, relative to the larger of the two) so "similar
population" means something consistent across all reported pairs, not just
whichever happened to rank highest by travel-time gap regardless of how
close their populations actually were.
"""
import pandas as pd

from pipeline import config

MIN_POPULATION = 50_000
MAX_POPULATION_PCT_DIFF = 0.03
TOP_N = 10


def main():
    df = pd.read_csv(config.PROCESSED_DIR / "soccer_avg_travel_time_by_nta.csv").sort_values(
        "total_population"
    ).reset_index(drop=True)

    rows = []
    n = len(df)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = df.loc[i], df.loc[j]
            if min(a.total_population, b.total_population) < MIN_POPULATION:
                continue
            pop_pct_diff = abs(a.total_population - b.total_population) / max(a.total_population, b.total_population)
            if pop_pct_diff > MAX_POPULATION_PCT_DIFF:
                continue
            rows.append({
                "nta_a_code": a.NTA2020, "nta_a_name": a.NTAName,
                "nta_a_population": a.total_population, "nta_a_avg_travel_time_minutes": a.avg_travel_time_minutes,
                "nta_b_code": b.NTA2020, "nta_b_name": b.NTAName,
                "nta_b_population": b.total_population, "nta_b_avg_travel_time_minutes": b.avg_travel_time_minutes,
                "population_pct_diff": 100 * pop_pct_diff,
                "travel_time_diff_minutes": abs(a.avg_travel_time_minutes - b.avg_travel_time_minutes),
            })

    pairs = pd.DataFrame(rows).sort_values("travel_time_diff_minutes", ascending=False).head(TOP_N)

    output_path = config.PROCESSED_DIR / "similar_population_different_access_time.csv"
    pairs.to_csv(output_path, index=False)
    print(f"Wrote {output_path} ({len(pairs)} pairs, population >= {MIN_POPULATION:,}, population diff <= {MAX_POPULATION_PCT_DIFF:.0%})")
    print(pairs.iloc[0])


if __name__ == "__main__":
    main()
