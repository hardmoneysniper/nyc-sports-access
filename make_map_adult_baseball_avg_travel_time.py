"""Same binned NTA choropleth as make_map_soccer_avg_travel_time.py (see
that file for the full rationale on colors/NTAType filtering), but for
adult baseball instead of soccer: colors each NTA by its tract-population-
weighted average public-transit travel time to the nearest adult baseball
field
(pipeline/nta_accessibility_data.load_nta_with_avg_travel_time("adult_base")).

"adult_base" (not a combined "baseball") because this project's sport
taxonomy keeps adult and youth baseball as two separate categories
(frontend/lib/selectionContext.tsx's SPORT_TYPES: "Baseball (Adult)" vs.
"Baseball (Youth)", the latter a min() across 2 Little League columns plus
tee-ball) -- there's no existing combined "baseball" metric anywhere else
in this project, so this matches the live dashboard's own "Baseball
(Adult)" option exactly rather than inventing a new blended category.

Uses config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES (fixed integer minute
intervals), not per-sport quantile bins -- redrawn in place, replacing an
earlier quantile-binned version, so the same color means the same
absolute travel time on every sport's map, letting this one be visually
compared directly against the others. Per project owner instruction,
2026-10-31 ("design a universal set of absolute value intervals... redraw
all maps in place except for soccer").
"""
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

SPORT = "adult_base"
SPORT_LABEL = "Adult Baseball"

# Identical list/order to make_map_soccer_avg_travel_time.py's BIN_COLORS --
# light to dark, which (since lower minutes = better here) lands dark on
# the WORST bin, matching that script's convention.
BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time(SPORT)

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    # NTAType == "0" (NYC Planning's "this is a residential neighborhood"
    # flag) excludes parks/cemeteries/airports/etc, including the ones
    # with a small nonzero population from ACS noise -- same filter as
    # make_map_soccer_avg_travel_time.py.
    travel_time = nta["avg_travel_time_minutes"].where(nta["NTAType"] == "0")

    # config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES (fixed integer minute
    # intervals), not per-sport quantile bins -- redrawn in place,
    # replacing an earlier quantile-binned version, so the same color
    # means the same absolute travel time on every sport's map. Per
    # project owner instruction, 2026-10-31 ("design a universal set of
    # absolute value intervals... redraw all maps in place except for
    # soccer").
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

    ax.set_title(f"Population-Weighted Average Travel Time to Nearest {SPORT_LABEL} Field (minutes)", fontsize=14)
    ax.axis("off")

    output_path = config.PROCESSED_DIR / f"map_{SPORT}_avg_travel_time.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
