"""NTA choropleth + CSV for median household income
(pipeline/income.build_nta_median_household_income, now baked into
nta_output.geojson's median_household_income column by
add_median_household_income.py).

Same binned-choropleth style as make_map_soccer_avg_travel_time.py (5-step
light-to-dark blue ListedColormap, white NTA borders, grey "No data",
Patch-based legend, quantile bins/labels), with two differences:

1. **Color direction is NOT flipped.** The travel-time maps pair their
   ascending-by-value color list against a metric where low = good, which
   deliberately lands dark on the WORST (highest-minutes) bin. Income has
   no such "lower is worse" framing -- this map just shows the value
   itself, so dark = highest income, light = lowest, with no judgment
   implied either way.
2. **NTAType == "0" filtering catches two real, populated NTAs too.**
   Besides the usual parks/cemeteries/airports, Tribeca-Civic Center and
   Upper East Side-Carnegie Hill are explicit NaN here (not a bug --
   pipeline/income.py's own docstring: a majority of their households earn
   $200,000+, so the median falls in ACS's open-ended top bracket, which
   has no stated upper bound to interpolate within). These two show up as
   "No data" on the map alongside the non-residential NTAs, for a
   different, legitimate reason.
"""
import geopandas as gpd
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from dotenv import load_dotenv

from pipeline import config

load_dotenv()

BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"]
NO_DATA_COLOR = "#898781"
N_BINS = 5


def main():
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = config.PROCESSED_DIR / "median_household_income_by_nta.csv"
    nta[nta["NTAType"] == "0"][["NTA2020", "NTAName", "total_population", "median_household_income"]].sort_values(
        "NTA2020"
    ).to_csv(csv_path, index=False)

    income = nta["median_household_income"].where(nta["NTAType"] == "0")

    binned, bin_edges = pd.qcut(income, N_BINS, retbins=True)
    bin_labels = [f"Quantile {i + 1} (${bin_edges[i]:,.0f}-${bin_edges[i + 1]:,.0f})" for i in range(N_BINS)]
    binned = pd.qcut(income, N_BINS, labels=bin_labels)
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

    ax.set_title("Median Household Income, by NTA", fontsize=14)
    ax.axis("off")

    output_path = config.PROCESSED_DIR / "map_median_household_income.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    excluded = (nta["NTAType"] == "0").sum() - income.notna().sum()
    print(f"Wrote {csv_path} ({int((nta['NTAType'] == '0').sum())} residential NTAs)")
    print(f"Wrote {output_path} ({int(excluded)} residential NTAs greyed out: open-ended top bracket)")


if __name__ == "__main__":
    main()
