"""Same as make_scatter_foreign_born_vs_soccer_avg_travel_time.py (all 5
boroughs, no NTAs removed), but each point is colored by its NTA's borough
(BoroName) instead of a single uniform color, with a legend identifying
which color is which borough. Per project owner instruction, 2026-10-21
("instead of removing staten island, color code the points... by borough").

Colors are ColorBrewer's "Set1" qualitative palette (5 of its 9 colors,
chosen for maximum visual distinction between categories with no implied
ordering -- unlike the sequential/quantile blue ramps used elsewhere in
this project, borough is a category, not a magnitude).
"""
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

BOROUGH_COLORS = {
    "Manhattan": "#4daf4a",
    "Brooklyn": "#377eb8",
    "Queens": "#984ea3",
    "Bronx": "#e41a1c",
    "Staten Island": "#ff7f00",
}


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()
    plot_data = nta[nta["NTAType"] == "0"].dropna(subset=["pct_immigrant", "avg_travel_time_minutes"])

    fig, ax = plt.subplots(figsize=(9, 9))
    for borough, color in BOROUGH_COLORS.items():
        subset = plot_data[plot_data["BoroName"] == borough]
        ax.scatter(subset["pct_immigrant"], subset["avg_travel_time_minutes"], alpha=0.7, marker="x", color=color, label=borough)

    ax.set_xlabel("% Foreign-Born Population")
    ax.set_ylabel("Population-Weighted Average Travel Time to Nearest Soccer Field (minutes)")
    ax.set_title("Foreign-Born Population vs. Soccer Field Average Travel Time, by NTA and Borough")
    ax.set_xlim(0, 100)
    ax.grid(True, alpha=0.3)
    ax.legend(title="Borough", loc="upper right", frameon=True)

    output_path = config.PROCESSED_DIR / "scatter_foreign_born_vs_soccer_avg_travel_time_by_borough.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = len(nta) - len(plot_data)
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded} excluded)")


if __name__ == "__main__":
    main()
