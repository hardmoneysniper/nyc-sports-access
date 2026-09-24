"""Scatter plot, same style as make_scatter.py:

X-axis: total NTA population
Y-axis: % of population within 15 minutes of nearest soccer field (pct_within_threshold)

One point per NTA. Uses pipeline/nta_accessibility_data.py -- the same
data-prep as make_maps.py, make_scatter.py, and make_scatter_regression.py,
so all stay consistent with each other.
"""
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_accessibility()
    plot_data = nta.dropna(subset=["population", "pct_within_threshold"])

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(plot_data["population"], plot_data["pct_within_threshold"], alpha=0.6, marker="x")
    ax.set_xlabel("Total Population")
    ax.set_ylabel(f"% of Population within {nta_accessibility_data.SOCCER_THRESHOLD_MINUTES} Minutes of Nearest Soccer Field")
    ax.set_title("Population vs. Soccer Field Accessibility, by NTA")
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3)

    output_path = config.PROCESSED_DIR / "scatter_population_vs_soccer_access.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = len(nta) - len(plot_data)
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded} excluded for missing data)")


if __name__ == "__main__":
    main()
