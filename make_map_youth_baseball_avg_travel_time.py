"""Same binned NTA choropleth as make_map_soccer_avg_travel_time.py (see
that file for the full rationale on colors/NTAType filtering), plus a CSV,
for youth baseball instead of soccer: colors each NTA by its
tract-population-weighted average public-transit travel time to the
nearest youth baseball facility
(pipeline/nta_accessibility_data.load_nta_with_avg_travel_time("youth_baseball")).

"youth_baseball" is a GROUP, not a single raw column (frontend/lib/
selectionContext.tsx's "Baseball (Youth)" = min() across 2 Little League
columns + tee-ball, same taxonomy as the adult-baseball map earlier).
pipeline/nta_accessibility_data.py's load_nta_with_avg_travel_time was
generalized to take the row-wise minimum across a group's member columns
at the tract level first (matching how the live dashboard reduces a
group to "nearest facility of any member type") before this script's
population-weighting runs on top of that.

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

SPORT = "youth_baseball"
SPORT_LABEL = "Youth Baseball"

# Identical list/order to make_map_soccer_avg_travel_time.py's BIN_COLORS --
# light to dark, which (since lower minutes = better here) lands dark on
# the WORST bin, matching that script's convention.
BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"


def main():
    nta = nta_accessibility_data.load_nta_with_avg_travel_time(SPORT)

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = config.PROCESSED_DIR / f"{SPORT}_avg_travel_time_by_nta.csv"
    nta[nta["NTAType"] == "0"][
        ["NTA2020", "NTAName", "total_population", "avg_travel_time_minutes"]
    ].dropna(subset=["avg_travel_time_minutes"]).sort_values("NTA2020").to_csv(csv_path, index=False)

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

    ax.set_title(f"Population-Weighted Average Travel Time to Nearest {SPORT_LABEL} Facility (minutes)", fontsize=14)
    ax.axis("off")

    output_path = config.PROCESSED_DIR / f"map_{SPORT}_avg_travel_time.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Wrote {csv_path}")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
