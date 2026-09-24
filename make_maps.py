"""Produce two NTA choropleth maps:

1. % foreign-born population per NTA -- straight from
   data/processed/nta_output.geojson's already-computed `pct_immigrant`
   column (no new computation needed).
2. % of an NTA's population within 15 minutes of its nearest soccer field --
   a new metric (pipeline/accessibility.py), computed from the
   already-written data/processed/tract_output_combined_time.csv
   (`travel_time_soccer`: the weekday-frequency-weighted combined travel
   time across the original 4 windows -- NOT the weekday-5pm/Saturday-5pm
   evening-window job, which is a separate, still-running addition and isn't
   NTA-aggregated). Per spec: numerator = summed population of tracts whose
   travel_time_soccer <= 15; denominator = total NTA population (not just
   reachable population).

See pipeline/nta_accessibility_data.py for how both numbers are derived
(shared with make_scatter.py, so the two views never drift apart) and why
this needs no r5py/JVM -- safe to run alongside the evening-windows job.
"""
import geopandas as gpd
import matplotlib.pyplot as plt
from dotenv import load_dotenv

from pipeline import config, nta_accessibility_data

load_dotenv()


def _plot_choropleth(nta: gpd.GeoDataFrame, column: str, title: str, output_path) -> None:
    fig, ax = plt.subplots(figsize=(10, 10))
    nta.plot(
        column=column,
        cmap="viridis",
        legend=True,
        ax=ax,
        missing_kwds={"color": "lightgrey", "label": "No data"},
        edgecolor="white",
        linewidth=0.2,
    )
    ax.set_title(title, fontsize=14)
    ax.axis("off")
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    nta = nta_accessibility_data.load_nta_with_accessibility()

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    _plot_choropleth(
        nta, "pct_immigrant",
        "% Foreign-Born Population by NTA",
        config.PROCESSED_DIR / "map_foreign_born.png",
    )
    _plot_choropleth(
        nta, "pct_within_threshold",
        f"% of Population within {nta_accessibility_data.SOCCER_THRESHOLD_MINUTES} Minutes of Nearest Soccer Field",
        config.PROCESSED_DIR / "map_soccer_15min.png",
    )

    print(f"Wrote {config.PROCESSED_DIR / 'map_foreign_born.png'}")
    print(f"Wrote {config.PROCESSED_DIR / 'map_soccer_15min.png'}")


if __name__ == "__main__":
    main()
