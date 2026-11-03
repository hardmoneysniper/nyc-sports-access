"""Scatter plot, replacing the old pct-within-15-minutes version
(make_scatter.py, now superseded):

X-axis: % foreign-born population (pct_immigrant)
Y-axis: tract-population-weighted average public-transit travel time to the
        nearest soccer field, per NTA (pipeline/accessibility.py's
        population_weighted_average_travel_time, via
        pipeline/nta_accessibility_data.py's load_nta_with_avg_travel_time)

One point per NTA. Filtered to NTAType == "0" (NYC Planning's "this is a
residential neighborhood" flag), not just non-missing data -- same fix as
make_scatter_soccer_avg_travel_time.py: several non-residential NTAs
(parks, cemeteries, military bases, Rikers Island) have a small but
nonzero population AND a nonzero pct_immigrant (e.g. "Sunnyside Yards
(North)": 344 residents, 93% foreign-born), so dropna alone wouldn't catch
them. Per project owner instruction, 2026-10-21 (the identical issue, found
and fixed on the population-vs-travel-time scatter first).
"""
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()
    plot_data = nta[nta["NTAType"] == "0"].dropna(subset=["pct_immigrant", "avg_travel_time_minutes"])

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(plot_data["pct_immigrant"], plot_data["avg_travel_time_minutes"], alpha=0.6, marker="x")
    ax.set_xlabel("% Foreign-Born Population")
    ax.set_ylabel("Population-Weighted Average Travel Time to Nearest Soccer Field (minutes)")
    ax.set_title("Foreign-Born Population vs. Soccer Field Average Travel Time, by NTA")
    ax.set_xlim(0, 100)
    ax.grid(True, alpha=0.3)

    output_path = config.PROCESSED_DIR / "scatter_foreign_born_vs_soccer_avg_travel_time.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = len(nta) - len(plot_data)
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded} excluded)")


if __name__ == "__main__":
    main()
