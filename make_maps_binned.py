"""Binned (choropleth-classed) versions of make_maps.py's two maps, per
request: the continuous viridis version was "too continuous." Same two
metrics, same data source (pipeline/nta_accessibility_data.py), but each
NTA is bucketed into one of 5 fixed bins -- 0-20, 21-40, 41-60, 61-80,
81-100% -- and colored with a 5-step light-to-dark blue ordinal ramp
instead of a continuous colormap.

Colors: each bin now takes the color the *next* bin up used to have (per
project owner instruction, 2026-09-16) -- e.g. 0-20% now uses the old
21-40% color -- with a new, darker blue added for 81-100% (#08306b, the
next step down in the same ColorBrewer "Blues" family: it's the 9-class
palette's darkest step, vs. #08519c which is the darkest step in the
5-class palette used before). Net effect: #bdd7e7, #6baed6, #3182bd,
#08519c, #08306b.

Note: this does improve on the original version's ~1.05:1 lightest-step
contrast (now ~1.50:1), but per the dataviz skill's validator
(--ordinal --surface "#ffffff") still FAILs the 2:1 floor for an ordinal
ramp -- shifting one step wasn't enough to clear it on its own. Flagging
this since it's directly relevant to the earlier accessibility ask; not
overridden here since this shift was an explicit, separate instruction.

Two earlier fully-accessible revisions of this ramp were tried and then
reverted away from (a dataviz-skill-derived ordinal ramp, then a custom
evenly-spaced-OKLCH/high-chroma version) -- see git history if either is
wanted again. The No-data grey fix (below) remains separately applied:
matplotlib's "lightgrey" was lower-contrast (1.50:1) than even the
original lightest blue.

Kept as new files (map_foreign_born_binned.png, map_soccer_15min_binned.png)
alongside the original continuous versions from make_maps.py, not replacing
them.
"""
import geopandas as gpd
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

BIN_EDGES = [0, 20, 40, 60, 80, 100]
BIN_LABELS = ["0-20", "21-40", "41-60", "61-80", "81-100"]
BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
# matplotlib's "lightgrey" (#d3d3d3) is only 1.50:1 against white -- worse
# than the blue ramp's old low-contrast starting color. This is the
# dataviz skill's validated neutral "muted" ink token, 3.59:1 against white.
NO_DATA_COLOR = "#898781"


def _bin_column(series: pd.Series) -> pd.Categorical:
    return pd.cut(series, bins=BIN_EDGES, labels=BIN_LABELS, include_lowest=True)


def _plot_binned_choropleth(nta: gpd.GeoDataFrame, column: str, title: str, output_path) -> None:
    binned = _bin_column(nta[column])
    cmap = ListedColormap(BIN_COLORS)

    fig, ax = plt.subplots(figsize=(10, 10))
    nta.assign(_bin=binned).plot(
        column="_bin",
        cmap=cmap,
        categorical=True,
        ax=ax,
        missing_kwds={"color": NO_DATA_COLOR, "label": "No data"},
        edgecolor="white",
        linewidth=0.2,
    )

    legend_handles = [Patch(facecolor=color, edgecolor="white", label=f"{label}%")
                       for label, color in zip(BIN_LABELS, BIN_COLORS)]
    legend_handles.append(Patch(facecolor=NO_DATA_COLOR, edgecolor="white", label="No data"))
    ax.legend(handles=legend_handles, loc="lower right", title="", frameon=True)

    ax.set_title(title, fontsize=14)
    ax.axis("off")
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    nta = nta_accessibility_data.load_nta_with_accessibility()

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    _plot_binned_choropleth(
        nta, "pct_immigrant",
        "% Foreign-Born Population by NTA",
        config.PROCESSED_DIR / "map_foreign_born_binned.png",
    )
    _plot_binned_choropleth(
        nta, "pct_within_threshold",
        f"% of Population within {nta_accessibility_data.SOCCER_THRESHOLD_MINUTES} Minutes of Nearest Soccer Field",
        config.PROCESSED_DIR / "map_soccer_15min_binned.png",
    )

    print(f"Wrote {config.PROCESSED_DIR / 'map_foreign_born_binned.png'}")
    print(f"Wrote {config.PROCESSED_DIR / 'map_soccer_15min_binned.png'}")


if __name__ == "__main__":
    main()
