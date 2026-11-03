"""NTA choropleth + CSV for % youth population (under 18)
(pipeline/demographics.py's pct_youth, from ACS table B01001, now baked
into nta_output.geojson by add_youth_population.py).

Same binned-choropleth style as make_map_median_household_income.py
(5-step light-to-dark blue ListedColormap, ascending-by-value -- no
"good/bad" direction implied, white NTA borders, grey "No data", quantile
bins/labels), filtered to NTAType == "0" (real residential neighborhoods).
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

    csv_path = config.PROCESSED_DIR / "youth_population_by_nta.csv"
    nta[nta["NTAType"] == "0"][
        ["NTA2020", "NTAName", "total_population", "youth_population", "pct_youth"]
    ].sort_values("NTA2020").to_csv(csv_path, index=False)

    pct_youth = nta["pct_youth"].where(nta["NTAType"] == "0")

    binned, bin_edges = pd.qcut(pct_youth, N_BINS, retbins=True)
    bin_labels = [f"Quantile {i + 1} ({bin_edges[i]:.1f}-{bin_edges[i + 1]:.1f}%)" for i in range(N_BINS)]
    binned = pd.qcut(pct_youth, N_BINS, labels=bin_labels)
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

    ax.set_title("% Population Under 18, by NTA", fontsize=14)
    ax.axis("off")

    output_path = config.PROCESSED_DIR / "map_pct_youth.png"
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Wrote {csv_path} ({int((nta['NTAType'] == '0').sum())} residential NTAs)")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
