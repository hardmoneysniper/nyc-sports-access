"""Same as make_scatter_foreign_born_vs_soccer_avg_travel_time.py, but
excludes Staten Island NTAs entirely (BoroName == "Staten Island"), not
just visually -- actually removed from the plotted data. Per project owner
instruction, 2026-10-21. Same exclusion convention as
make_scatter_regression_no_si.py's "no_si" variant of the original
foreign-born-vs-soccer-access scatter.
"""
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()
    plot_data = nta[nta["NTAType"] == "0"].dropna(subset=["pct_immigrant", "avg_travel_time_minutes"])
    plot_data = plot_data[plot_data["BoroName"] != "Staten Island"]

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(plot_data["pct_immigrant"], plot_data["avg_travel_time_minutes"], alpha=0.6, marker="x")
    ax.set_xlabel("% Foreign-Born Population")
    ax.set_ylabel("Population-Weighted Average Travel Time to Nearest Soccer Field (minutes)")
    ax.set_title("Foreign-Born Population vs. Soccer Field Average Travel Time, by NTA (excl. Staten Island)")
    ax.set_xlim(0, 100)
    ax.grid(True, alpha=0.3)

    output_path = config.PROCESSED_DIR / "scatter_foreign_born_vs_soccer_avg_travel_time_no_si.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    full = nta[nta["NTAType"] == "0"].dropna(subset=["pct_immigrant", "avg_travel_time_minutes"])
    excluded_si = (full["BoroName"] == "Staten Island").sum()
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded_si} excluded [Staten Island])")


if __name__ == "__main__":
    main()
