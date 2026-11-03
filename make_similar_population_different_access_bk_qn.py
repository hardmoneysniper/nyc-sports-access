"""Same search as make_similar_population_different_access.py (near-
identical population, very different population-weighted average travel
time to the nearest soccer field), restricted to NTA pairs where BOTH NTAs
are in Brooklyn or Queens. Per project owner instruction, 2026-10-21
("select brooklyn/queens examples").

No population floor here (unlike the 50,000 floor in the unrestricted
version) -- restricting to 2 boroughs already narrows the candidate pool
enough that a floor would cut it down further than needed; the output CSV
includes population for every pair so a reader can still see which
examples happen to be larger.
"""
import pandas as pd
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

BOROUGHS = ["Brooklyn", "Queens"]
MAX_POPULATION_PCT_DIFF = 0.03
TOP_N = 10


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()
    df = pd.read_csv(config.PROCESSED_DIR / "soccer_avg_travel_time_by_nta.csv").merge(
        nta[["NTA2020", "BoroName"]], on="NTA2020"
    )
    df = df[df["BoroName"].isin(BOROUGHS)].sort_values("total_population").reset_index(drop=True)

    rows = []
    n = len(df)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = df.loc[i], df.loc[j]
            pop_pct_diff = abs(a.total_population - b.total_population) / max(a.total_population, b.total_population)
            if pop_pct_diff > MAX_POPULATION_PCT_DIFF:
                continue
            rows.append({
                "nta_a_code": a.NTA2020, "nta_a_name": a.NTAName, "nta_a_borough": a.BoroName,
                "nta_a_population": a.total_population, "nta_a_avg_travel_time_minutes": a.avg_travel_time_minutes,
                "nta_b_code": b.NTA2020, "nta_b_name": b.NTAName, "nta_b_borough": b.BoroName,
                "nta_b_population": b.total_population, "nta_b_avg_travel_time_minutes": b.avg_travel_time_minutes,
                "population_pct_diff": 100 * pop_pct_diff,
                "travel_time_diff_minutes": abs(a.avg_travel_time_minutes - b.avg_travel_time_minutes),
            })

    pairs = pd.DataFrame(rows).sort_values("travel_time_diff_minutes", ascending=False).head(TOP_N)

    output_path = config.PROCESSED_DIR / "similar_population_different_access_time_bk_qn.csv"
    pairs.to_csv(output_path, index=False)
    print(f"Wrote {output_path} ({len(pairs)} pairs, both NTAs in {BOROUGHS}, population diff <= {MAX_POPULATION_PCT_DIFF:.0%})")
    print(pairs.iloc[0])


if __name__ == "__main__":
    main()
