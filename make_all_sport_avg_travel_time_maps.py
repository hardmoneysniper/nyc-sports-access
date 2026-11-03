"""Avg-travel-time NTA choropleth for EVERY sport type (all 21 of
frontend/lib/selectionContext.tsx's SPORT_TYPES / pipeline/config.py's
SPORT_TYPE_GROUPS), not just the 5 done individually so far
(soccer/adult_base/cricket/volleyball/youth_baseball).

Same style and same config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES universal
bins as those 5 (see make_map_soccer_avg_travel_time_universal_scale.py
for the full rationale) -- the whole point of the universal scale was to
make every sport's map directly comparable, so this reuses it rather than
re-deriving a per-sport scale. Writes:

1. One full-size PNG per sport, map_{sport}_avg_travel_time.png, for every
   SPORT_TYPES key EXCEPT "soccer" -- soccer already has its own two files
   (the preserved original quantile-binned map_soccer_avg_travel_time.png,
   and map_soccer_avg_travel_time_universal_scale.png); writing here too
   under the same "soccer" name would silently overwrite one of those.
   Note "adult_baseball" here is a new, more consistent name alongside
   (not replacing) the existing map_adult_base_avg_travel_time.png from
   make_map_adult_baseball_avg_travel_time.py -- same data, canonical
   SPORT_TYPES key instead of the raw column name.
2. One combined small-multiples grid, map_all_sports_avg_travel_time_grid.png,
   with ALL 21 sports (soccer included, reusing the same universal-scale
   data) side by side under one shared legend -- per the dataviz skill's
   small-multiples guidance: one legend for a visually consistent panel
   set, not a repeated legend per tile, since they all share the same
   color encoding by construction (the universal bins). Per project owner
   instruction, 2026-10-31 ("can you produce the avg travel time map for
   all sports types?").

Per project owner instruction, 2026-10-31.
"""
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()

# Matches frontend/lib/selectionContext.tsx's SPORT_TYPES exactly (value,
# label), including its ordering (alphabetical by label) -- so the grid
# reads in the same order a visitor would see in the live dropdown.
SPORT_TYPES = [
    ("adult_baseball", "Baseball (Adult)"),
    ("youth_baseball", "Baseball (Youth)"),
    ("basketball", "Basketball"),
    ("bocce", "Bocce"),
    ("cricket", "Cricket"),
    ("adult_football", "Football (Adult)"),
    ("youth_football", "Football (Youth)"),
    ("frisbee", "Frisbee"),
    ("handball", "Handball"),
    ("hockey", "Hockey"),
    ("kickball", "Kickball"),
    ("lacrosse", "Lacrosse"),
    ("netball", "Netball"),
    ("pickleball", "Pickleball"),
    ("rugby", "Rugby"),
    ("soccer", "Soccer"),
    ("adult_softball", "Softball (Adult)"),
    ("youth_softball", "Softball (Youth)"),
    ("tennis", "Tennis"),
    ("track_and_field", "Track and Field"),
    ("volleyball", "Volleyball"),
]

BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"


def _binned_travel_time(sport: str) -> tuple[object, list[str]]:
    nta = nta_accessibility_data.load_nta_with_avg_travel_time(sport)
    travel_time = nta["avg_travel_time_minutes"].where(nta["NTAType"] == "0")
    edges = config.TRAVEL_TIME_MAP_BIN_EDGES_MINUTES
    bin_labels = [f"{edges[i]}-{edges[i + 1]} min" for i in range(len(edges) - 1)] + [f"{edges[-1]}+ min"]
    binned = pd.cut(travel_time, bins=edges + [float("inf")], labels=bin_labels, right=False)
    return nta.assign(_bin=binned), bin_labels


def main():
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cmap = ListedColormap(BIN_COLORS)
    legend_handles = None

    computed = {}
    for sport, label in SPORT_TYPES:
        print(f"Computing {label}...")
        nta, bin_labels = _binned_travel_time(sport)
        computed[sport] = nta
        if legend_handles is None:
            legend_handles = [Patch(facecolor=color, edgecolor="white", label=l)
                               for l, color in zip(bin_labels, BIN_COLORS)]
            legend_handles.append(Patch(facecolor=NO_DATA_COLOR, edgecolor="white", label="No data"))

        if sport == "soccer":
            continue  # already has its own 2 files -- see module docstring.

        fig, ax = plt.subplots(figsize=(10, 10))
        nta.plot(
            column="_bin", cmap=cmap, categorical=True, ax=ax,
            missing_kwds={"color": NO_DATA_COLOR, "label": "No data"},
            edgecolor="white", linewidth=0.2,
        )
        ax.legend(handles=legend_handles, loc="lower right", title="", frameon=True)
        ax.set_title(f"Population-Weighted Average Travel Time to Nearest {label} Facility (minutes)", fontsize=14)
        ax.axis("off")
        output_path = config.PROCESSED_DIR / f"map_{sport}_avg_travel_time.png"
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        print(f"  Wrote {output_path}")

    # Small-multiples grid: 21 sports -> 3 rows x 7 cols. One shared
    # legend for the whole figure (every tile uses the identical 5-color
    # + no-data encoding by construction), not a legend per tile.
    n_cols, n_rows = 7, 3
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(n_cols * 3.2, n_rows * 3.6))
    for ax, (sport, label) in zip(axes.flat, SPORT_TYPES):
        computed[sport].plot(
            column="_bin", cmap=cmap, categorical=True, ax=ax,
            missing_kwds={"color": NO_DATA_COLOR},
            edgecolor="white", linewidth=0.1,
        )
        ax.set_title(label, fontsize=10)
        ax.axis("off")
    for ax in axes.flat[len(SPORT_TYPES):]:
        ax.axis("off")

    fig.suptitle("Population-Weighted Average Travel Time to Nearest Facility, by Sport (minutes)", fontsize=16, y=1.0)
    fig.legend(handles=legend_handles, loc="lower center", ncol=6, frameon=True, bbox_to_anchor=(0.5, -0.02))
    fig.tight_layout(rect=(0, 0.03, 1, 0.97))

    grid_path = config.PROCESSED_DIR / "map_all_sports_avg_travel_time_grid.png"
    fig.savefig(grid_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Wrote {grid_path}")


if __name__ == "__main__":
    main()
