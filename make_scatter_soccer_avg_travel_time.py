"""Scatter plot + CSV, replacing the old pct-within-15-minutes version
(make_scatter_population.py, now superseded):

X-axis: total NTA population (same as before)
Y-axis: tract-population-weighted average public-transit travel time to the
        nearest soccer field, per NTA (pipeline/accessibility.py's
        population_weighted_average_travel_time, via
        pipeline/nta_accessibility_data.py's load_nta_with_avg_travel_time)

One point per NTA. Also writes the underlying per-NTA data (NTA2020,
NTAName, total_population, avg_travel_time_minutes) to a CSV alongside the
plot, since the travel-time number itself -- not just the % reachable
within a fixed cutoff -- is the point of this replacement metric.

Excludes every non-residential NTA (parks, cemeteries, airports, and other
special-use land: Rikers Island, military bases, rail yards, the UN), not
just the ones with exactly 0 population. An earlier version of this filter
only dropped total_population == 0, which still left ~17 NTAs on the plot
with a small but nonzero population (12-2,950 -- e.g. "Inwood Hill Park":
13, "Barren Island-Floyd Bennett Field": 14) sitting visually on top of the
y-axis, indistinguishable from a true 0 given the x-axis runs up to
~101,000 for real neighborhoods. All of those turned out to share NTAType
codes 5/6/7/8/9 (NYC Planning's own "not a residential neighborhood"
classification) -- confirmed every type-0 (residential) NTA has at least
13,998 residents and every non-0-type NTA has at most 2,950, a clean split
with no ambiguous middle ground -- so NTAType == "0" is the correct filter,
not an arbitrary population cutoff. Per project owner instruction,
2026-10-21.
"""
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()
    plot_data = nta[nta["NTAType"] == "0"].dropna(subset=["total_population", "avg_travel_time_minutes"])

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = config.PROCESSED_DIR / "soccer_avg_travel_time_by_nta.csv"
    plot_data[["NTA2020", "NTAName", "total_population", "avg_travel_time_minutes"]].sort_values(
        "NTA2020"
    ).to_csv(csv_path, index=False)

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(plot_data["total_population"], plot_data["avg_travel_time_minutes"], alpha=0.6, marker="x")
    ax.set_xlabel("Total Population")
    ax.set_ylabel("Population-Weighted Average Travel Time to Nearest Soccer Field (minutes)")
    ax.set_title("Population vs. Soccer Field Average Travel Time, by NTA")
    ax.grid(True, alpha=0.3)

    output_path = config.PROCESSED_DIR / "scatter_population_vs_soccer_avg_travel_time.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = len(nta) - len(plot_data)
    print(f"Wrote {csv_path} ({len(plot_data)} NTAs)")
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded} excluded for missing data)")


if __name__ == "__main__":
    main()
