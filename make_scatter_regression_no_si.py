"""Same as make_scatter_regression.py, but:

- Excludes Staten Island NTAs entirely (BoroName == "Staten Island") from
  both the scatter points and the regression fit -- not just visually
  hidden, actually removed before fitting.
- Includes y == 0 points (no y>0 filter, unlike make_scatter_regression.py).

Regression line is extended to x=0. No title or axis labels, matching the
other scatter scripts in this set.

Uses the same pipeline/nta_accessibility_data.py data prep as make_maps.py,
make_scatter.py, and make_scatter_regression.py, so all four stay
consistent with each other.
"""
import numpy as np
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def main():
    nta = nta_accessibility_data.load_nta_with_accessibility()
    plot_data = nta.dropna(subset=["pct_immigrant", "pct_within_threshold"])
    plot_data = plot_data[plot_data["BoroName"] != "Staten Island"]

    x = plot_data["pct_immigrant"].to_numpy()
    y = plot_data["pct_within_threshold"].to_numpy()
    slope, intercept = np.polyfit(x, y, deg=1)

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(x, y, alpha=0.6, edgecolor="white")

    x_line = np.linspace(0, x.max(), 100)
    ax.plot(x_line, slope * x_line + intercept, color="firebrick", linewidth=2)

    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3)
    # Deliberately no title/xlabel/ylabel, matching the other scatter scripts.

    output_path = config.PROCESSED_DIR / "scatter_foreign_born_vs_soccer_access_no_si_regression.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded_si = (nta["BoroName"] == "Staten Island").sum()
    excluded_missing = len(nta) - excluded_si - len(plot_data)
    print(
        f"Wrote {output_path} ({len(plot_data)} NTAs plotted; "
        f"{excluded_si} excluded [Staten Island], {excluded_missing} excluded [missing data])"
    )
    print(f"Fit: y = {slope:.4f}x + {intercept:.4f}")


if __name__ == "__main__":
    main()
