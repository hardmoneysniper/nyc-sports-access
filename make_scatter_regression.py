"""Same scatter plot as make_scatter.py, restricted to NTAs with a non-zero
y value (pct_within_threshold > 0 -- excludes NTAs with literally 0%
soccer-field access within the threshold, which otherwise form a dense
uninformative band along y=0), with a linear regression line fit through the
remaining points and extended down to x=0 (past the leftmost data point) so
the intercept is visible. No title or axis labels, per request.

Uses the same pipeline/nta_accessibility_data.py data prep as make_maps.py
and make_scatter.py, so all three stay consistent with each other.
"""
import numpy as np
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_accessibility()
    plot_data = nta.dropna(subset=["pct_immigrant", "pct_within_threshold"])
    plot_data = plot_data[plot_data["pct_within_threshold"] > 0]

    x = plot_data["pct_immigrant"].to_numpy()
    y = plot_data["pct_within_threshold"].to_numpy()
    slope, intercept = np.polyfit(x, y, deg=1)

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(x, y, alpha=0.6, marker="x")

    x_line = np.linspace(0, x.max(), 100)
    ax.plot(x_line, slope * x_line + intercept, color="firebrick", linewidth=2)

    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3)
    # Deliberately no title/xlabel/ylabel, per request.

    output_path = config.PROCESSED_DIR / "scatter_foreign_born_vs_soccer_access_regression.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = len(nta) - len(plot_data)
    print(f"Wrote {output_path} ({len(plot_data)} NTAs plotted, {excluded} excluded [missing data or y=0])")
    print(f"Fit: y = {slope:.4f}x + {intercept:.4f}")


if __name__ == "__main__":
    main()
