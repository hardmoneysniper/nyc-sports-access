"""NTA choropleth map, replacing the old % within 15 minutes version
(make_maps_binned.py's map_soccer_15min_binned.png, now superseded): colors
each NTA by its tract-population-weighted average public-transit travel
time to the nearest soccer field
(pipeline/nta_accessibility_data.load_nta_with_avg_travel_time).

Same binned-choropleth style as make_maps_binned.py (5-step light-to-dark
blue ListedColormap, white NTA borders, grey "No data", Patch-based legend
in the lower right) -- not the plain continuous viridis_r version tried
first, which this replaces. Per project owner instruction, 2026-10-21 ("why
it is continuous? I need the binned blue-ish color scheme... keep the avg
travel time map the same style as that old 15min_binned map too").

Two things intentionally differ from make_maps_binned.py rather than being
copied as-is:

1. **Bin edges are quantiles of this data, not fixed 0/20/40/60/80/100.**
   The old metric was a percentage, so round 20-point-wide bins were a
   natural, bounded scale. Average travel time has no such natural
   ceiling (it ranges ~8.6 to ~74.4 minutes here, heavily right-skewed by
   a handful of far-out NTAs) -- fixed round-minute bins would leave most
   bins nearly empty. Quantile bins (roughly equal NTA count per bin)
   are the same binning convention the live dashboard map already uses
   for burden score (frontend/lib/colorScale.ts's positiveQuantileBinEdges),
   so this stays consistent with that, and each bin's label is its own
   actual minute range rather than a borrowed percentage range.
2. **The same light-to-dark color LIST as the old script, which ends up
   meaning the opposite thing here.** The old script pairs its 5 colors,
   light to dark, with bins sorted ascending by VALUE (0-20% ... 81-100%).
   Since that metric is "higher % = better," ascending-by-value there is
   also ascending-by-goodness, so its dark end lands on the BEST bin
   (81-100%). This metric is "lower minutes = better" -- the opposite
   relationship between value and goodness -- so reusing the exact same
   list, paired the same way (ascending by value, i.e. ascending
   minutes), automatically lands dark on the WORST bin instead. That
   matches the continuous avg-travel-time map's viridis_r convention
   (dark = worse) without needing to manually flip anything here.
"""
import geopandas as gpd
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

# Identical list and order to make_maps_binned.py's BIN_COLORS (light to
# dark) -- see module docstring point 2 for why this unmodified list still
# ends up with dark = worse for this metric.
BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"
N_BINS = 5


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    # Grey out every non-residential NTA (parks, cemeteries, airports, and
    # other special-use land), not just the ones with exactly 0
    # population -- a handful of others (e.g. "Inwood Hill Park": 13
    # residents, "Barren Island-Floyd Bennett Field": 14) have a small but
    # nonzero population from ACS noise despite not being real residential
    # neighborhoods. NTAType == "0" is NYC Planning's own "this is a
    # residential neighborhood" flag; every type-0 NTA has at least 13,998
    # residents and every other type has at most 2,950, so this is a clean
    # split, not an arbitrary population cutoff. Per project owner
    # instruction, 2026-10-21.
    travel_time = nta["avg_travel_time_minutes"].where(nta["NTAType"] == "0")

    binned, bin_edges = pd.qcut(travel_time, N_BINS, retbins=True)
    # "Quantile" rather than a bare minute range -- these 5 bins are equal-
    # COUNT groups of NTAs (quintiles), not equal-width minute buckets, and
    # the label should say so rather than implying the cutoffs were chosen
    # directly. Per project owner instruction, 2026-10-21 ("mark the labels
    # of the legend as 'quantiles'").
    bin_labels = [f"Quantile {i + 1} ({bin_edges[i]:.1f}-{bin_edges[i + 1]:.1f} min)" for i in range(N_BINS)]
    binned = pd.qcut(travel_time, N_BINS, labels=bin_labels)
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

    legend_handles = [Patch(facecolor=color, edgecolor="white", label=label)
                       for label, color in zip(bin_labels, BIN_COLORS)]
    legend_handles.append(Patch(facecolor=NO_DATA_COLOR, edgecolor="white", label="No data"))
    ax.legend(handles=legend_handles, loc="lower right", title="", frameon=True)

    ax.set_title("Population-Weighted Average Travel Time to Nearest Soccer Field (minutes)", fontsize=14)
    ax.axis("off")

    output_path = config.PROCESSED_DIR / "map_soccer_avg_travel_time.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
