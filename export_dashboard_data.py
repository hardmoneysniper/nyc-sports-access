"""Export lightweight static data bundles for the Next.js dashboard
(frontend/). Purely a post-processing/export step -- reads already-computed
pipeline output, does not run r5py or touch the underlying pipeline.

Writes to frontend/public/data/:

- demographics.geojson: NTA boundaries + the 6 selectable pct_* demographic
  columns, from data/processed/nta_output.geojson.
- travel_time.geojson: NTA boundaries + the 21 display-level
  travel_time_{group} columns (config.SPORT_TYPE_GROUPS -- e.g. youth
  baseball's 3 raw variants collapse into one), derived from the 24 raw
  travel_time_{sport} columns in data/processed/nta_output_combined_time.csv
  (the original 4-window data -- the 5pm evening-window data is NOT used
  for this file).
- nta_boundaries.geojson: NTA2020 + geometry only, no other properties --
  the lightweight "faint backdrop of every NTA" layer used behind the
  NTA-clicked detail view (see NtaDetailView.tsx).
- tracts/{NTA2020}.geojson: that NTA's census tract boundaries, one file per
  NTA (262 files).
- routes/{NTA2020}.geojson: that NTA's tracts' real transit-path routes (all
  24 sport types, both 5pm windows), one file per NTA -- split from the
  573MB data/processed/evening_routes_detailed.geojson so the browser never
  has to fetch more than one NTA's worth of routes at a time.
- facilities/{sport_type}.geojson: every active facility of that sport
  type's actual polygon shape (not the representative_point() used for
  routing), one file per sport type (24 files) -- a global lookup, since
  which facility is "nearest" varies per tract/NTA but a facility's shape
  doesn't depend on who's routing to it.

Per-NTA (not a single citywide file) because dumping all 262 NTAs' routes
into one file would mean shipping a meaningful fraction of that 573MB to
the browser on every page load; per-NTA files mean a click on one NTA only
ever fetches that NTA's data.
"""
import geopandas as gpd
import pandas as pd
import pyogrio
from dotenv import load_dotenv

from pipeline import config, facilities as facilities_module, geography

load_dotenv()

OUTPUT_DIR = config.DATA_DIR.parent / "frontend" / "public" / "data"

DEMOGRAPHIC_COLUMNS = [
    "pct_non_white", "pct_hispanic_or_latino", "pct_black_or_african_american",
    "pct_asian", "pct_two_or_more_races", "pct_immigrant",
]


def export_demographics():
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")
    trimmed = nta[["NTA2020", "NTAName", "total_population"] + DEMOGRAPHIC_COLUMNS + ["geometry"]]
    output_path = OUTPUT_DIR / "demographics.geojson"
    trimmed.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(trimmed)} NTAs)")


def export_travel_time():
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")[["NTA2020", "NTAName", "geometry"]]
    times = pd.read_csv(config.PROCESSED_DIR / "nta_output_combined_time.csv")
    merged = nta.merge(times.drop(columns=["NTAName"]), on="NTA2020", how="left")

    # Collapse the 24 raw sport-type columns into config.SPORT_TYPE_GROUPS'
    # 21 display categories. Each raw column already means "travel time to
    # the nearest facility of that one type," so min() across a group's
    # member columns is exactly "travel time to the nearest facility of any
    # of these types" -- no re-routing needed. min()'s default skipna=True
    # is the right behavior here too: if only some member types have a
    # reachable facility, the group's value is the best of what's
    # available, not NaN. Per project owner instruction, 2026-09-27.
    for group, members in config.SPORT_TYPE_GROUPS.items():
        member_columns = [f"travel_time_{m}" for m in members]
        merged[f"travel_time_{group}"] = merged[member_columns].min(axis=1)

    group_columns = [f"travel_time_{g}" for g in config.SPORT_TYPE_GROUPS]
    merged = merged[["NTA2020", "NTAName", "geometry"] + group_columns]

    output_path = OUTPUT_DIR / "travel_time.geojson"
    merged.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(merged)} NTAs, {len(group_columns)} sport types)")


def export_nta_boundaries():
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")[["NTA2020", "geometry"]]
    output_path = OUTPUT_DIR / "nta_boundaries.geojson"
    nta.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(nta)} NTAs, boundary-only)")


def export_tracts_by_nta():
    tracts = geography.load_census_tracts()[["GEOID", "NTA2020", "geometry"]].to_crs(config.CRS_GEOGRAPHIC)
    output_dir = OUTPUT_DIR / "tracts"
    output_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for nta_code, group in tracts.groupby("NTA2020"):
        group[["GEOID", "geometry"]].to_file(output_dir / f"{nta_code}.geojson", driver="GeoJSON")
        count += 1
    print(f"Wrote {count} per-NTA tract files to {output_dir}")


def export_routes_by_nta():
    tract_to_nta = geography.load_census_tracts()[["GEOID", "NTA2020"]]

    print("Reading full evening_routes_detailed.geojson (573MB, ~15s)...")
    routes = pyogrio.read_dataframe(config.PROCESSED_DIR / "evening_routes_detailed.geojson")
    routes = routes.merge(tract_to_nta, on="GEOID", how="left")

    output_dir = OUTPUT_DIR / "routes"
    output_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for nta_code, group in routes.groupby("NTA2020"):
        subset = group.drop(columns=["NTA2020"])
        gpd.GeoDataFrame(subset, geometry="geometry", crs=config.CRS_GEOGRAPHIC).to_file(
            output_dir / f"{nta_code}.geojson", driver="GeoJSON"
        )
        count += 1
    print(f"Wrote {count} per-NTA route files to {output_dir} ({len(routes)} total route segments)")


def export_facilities_by_sport():
    active = facilities_module.load_active_facilities()
    output_dir = OUTPUT_DIR / "facilities"
    output_dir.mkdir(parents=True, exist_ok=True)
    for sport_type in config.SPORT_TYPE_COLUMNS:
        sport_facilities = facilities_module.facilities_for_sport_type(active, sport_type)
        result = sport_facilities[["geometry"]].copy()
        result["facility_id"] = result.index.astype(str)
        result = gpd.GeoDataFrame(result, geometry="geometry", crs=config.CRS_GEOGRAPHIC)
        result.to_file(output_dir / f"{sport_type}.geojson", driver="GeoJSON")
    print(f"Wrote {len(config.SPORT_TYPE_COLUMNS)} per-sport-type facility files to {output_dir}")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    export_demographics()
    export_travel_time()
    export_nta_boundaries()
    export_tracts_by_nta()
    export_routes_by_nta()
    export_facilities_by_sport()


if __name__ == "__main__":
    main()
