"""Same binned NTA choropleth as make_map_soccer_avg_travel_time.py, but
using config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES (fixed integer minute
intervals shared across every sport's map) instead of per-sport quantile
bins, so the same color means the same absolute travel time on soccer's
map as on cricket/volleyball/adult-baseball/youth-baseball's.

Saved as a SEPARATE file/script, not an in-place edit of
make_map_soccer_avg_travel_time.py -- that script's own quantile-binned
map_soccer_avg_travel_time.png is left exactly as it was (quantile bins
specific to soccer's own distribution, which do a better job of spreading
soccer's own NTAs out visually, at the cost of not being comparable
against other sports' maps). This file is the other, directly-comparable
version. Per project owner instruction, 2026-10-31 ("redraw all maps in
place except for soccer; for soccer, save a separate copy").
"""
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

# Identical list/order to make_map_soccer_avg_travel_time.py's BIN_COLORS --
# light to dark, which (since lower minutes = better here) lands dark on
# the WORST bin, matching that script's convention.
BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time()

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    # NTAType == "0" (NYC Planning's "this is a residential neighborhood"
    # flag) excludes parks/cemeteries/airports/etc -- same filter as
    # make_map_soccer_avg_travel_time.py.
    travel_time = nta["avg_travel_time_minutes"].where(nta["NTAType"] == "0")

    edges = config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES
    bin_labels = [f"{edges[i]}-{edges[i + 1]} min" for i in range(len(edges) - 1)] + [f"{edges[-1]}+ min"]
    binned = pd.cut(travel_time, bins=edges + [float("inf")], labels=bin_labels, right=False)
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

    output_path = config.PROCESSED_DIR / "map_soccer_avg_travel_time_universal_scale.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
