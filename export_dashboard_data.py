"""Export lightweight static data bundles for the Next.js dashboard
(frontend/). Purely a post-processing/export step -- reads already-computed
pipeline output, does not run r5py or touch the underlying pipeline.

Writes to frontend/public/data/:

- demographics.geojson: NTA boundaries + the 6 selectable demographic
  columns (DEMOGRAPHIC_COLUMNS -- mostly pct_* percentages, plus one dollar
  figure, median_household_income), from data/processed/nta_output.geojson.
- travel_time.geojson: NTA boundaries + the 21 display-level
  travel_time_{group} columns (config.SPORT_TYPE_GROUPS -- e.g. youth
  baseball's 3 raw variants collapse into one), derived from the 24 raw
  travel_time_{sport} columns in data/processed/nta_output_combined_time.csv
  (the original 4-window data -- the 5pm evening-window data is NOT used
  for this file).
- burden_index.geojson: NTA boundaries + a burden_index_{group} column per
  one of the same 21 SPORT_TYPE_GROUPS categories -- a
  population-conditioned access burden score (see
  docs/SOCCER_ACCESS_BURDEN_METHODOLOGY.md), generalized from a soccer-only
  prototype to every sport type. This is what the dashboard's non-
  demographics map shows now, in place of raw travel time.
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
import numpy as np
import pandas as pd
import pyogrio
from dotenv import load_dotenv
from scipy import stats

from pipeline import config, facilities as facilities_module, geography

load_dotenv()

OUTPUT_DIR = config.DATA_DIR.parent / "frontend" / "public" / "data"

# Narrowed down from the original 6 race/ethnicity + immigrant categories
# to just immigrant/foreign-born plus 5 new ones (poverty, income, vehicle
# access, youth, seniors), ranked in this order -- kept the race/ethnicity
# breakdown by column, not in the selectable set. Per project owner
# instruction, 2026-11-09.
DEMOGRAPHIC_COLUMNS = [
    "pct_immigrant", "pct_poverty", "median_household_income",
    "pct_no_vehicle", "pct_youth", "pct_senior",
]


def _nta_density(gdf: gpd.GeoDataFrame) -> pd.Series:
    """People per square mile, per NTA -- EPSG:2263 (feet) is this
    pipeline's standard projected CRS (see docs/METHODOLOGY.md).
    Reprojects only for this area computation, never mutates gdf's own
    (geographic) geometry. Shared by export_demographics() (so the
    methodology page's density-vs-population explainer can read it
    straight off demographics.geojson) and export_burden_index() (the
    regression predictor), so the two never compute it two different ways.
    """
    area_sqmi = gdf.to_crs(config.CRS_PROJECTED).geometry.area / (5280**2)
    return gdf["total_population"] / area_sqmi


def export_demographics():
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")
    nta["density"] = _nta_density(nta)
    trimmed = nta[["NTA2020", "NTAName", "total_population", "density"] + DEMOGRAPHIC_COLUMNS + ["geometry"]]
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


def _load_merged_with_travel_time() -> pd.DataFrame:
    """NTA table (boundaries + total_population) joined to every
    display-level travel_time_{group} column. Shared base frame for both
    export_burden_index() and _compute_burden_indices(), so the two never
    build this join two different ways.
    """
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")[["NTA2020", "NTAName", "total_population", "geometry"]]
    times = pd.read_csv(config.PROCESSED_DIR / "nta_output_combined_time.csv")
    merged = nta.merge(times.drop(columns=["NTAName"]), on="NTA2020", how="left")
    for group, members in config.SPORT_TYPE_GROUPS.items():
        member_columns = [f"travel_time_{m}" for m in members]
        merged[f"travel_time_{group}"] = merged[member_columns].min(axis=1)
    return merged


def _compute_residuals(merged: pd.DataFrame) -> dict[str, pd.Series]:
    """Raw, SIGNED, UNWEIGHTED residual from travel_time_{sport} ~
    log(population_density) by OLS, for every one of
    config.SPORT_TYPE_GROUPS' 21 display-level sport types -- density
    (population per square mile), not raw population, since travel time is
    fundamentally spatial and density explains far more of its variance
    (verified empirically, 2026-09-29: log(density) r^2=0.41 vs
    log(population) r^2=0.23 for soccer). A positive residual means that
    NTA's access is worse than its own density would predict; negative
    means better.

    Deliberately NOT clipped at 0 and NOT population-weighted here -- that
    transformation (see _compute_burden_indices) is the right one for the
    dashboard's own burden score (a population-of-10,000-units
    prioritization metric), but the wrong one for correlating against a
    per-capita demographic %: clipping at 0 throws away every
    better-than-expected NTA before any correlation is run, and
    multiplying by population conflates "how bad is access here" with "how
    many people live here," adding variance that has nothing to do with
    demographics. Per project owner instruction, 2026-11-02 ("use the
    residual, only keep positive values... re-generate the linear
    regression").

    Returns one Series per group, indexed like `merged` (NOT keyed by
    NTA2020) so callers can align it against any of merged's other columns
    (e.g. a demographic pct_* column) positionally without a re-merge. NaN
    wherever the sport's travel time or the NTA's population/area itself is
    missing/zero (regression fit only on the valid subset, per sport, since
    different sports have different unreachable NTAs).
    """
    log_density = np.log(_nta_density(merged).clip(lower=1e-6))
    has_population = merged["total_population"] > 0

    residual_by_group: dict[str, pd.Series] = {}
    for group in config.SPORT_TYPE_GROUPS:
        tt_col = f"travel_time_{group}"
        valid = has_population & merged[tt_col].notna()
        if valid.sum() < 10:
            residual_by_group[group] = pd.Series(float("nan"), index=merged.index)
            continue

        slope, intercept, *_ = stats.linregress(log_density[valid], merged.loc[valid, tt_col])
        predicted = intercept + slope * log_density
        residual = merged[tt_col] - predicted
        residual_by_group[group] = residual.where(valid)

    return residual_by_group


def _compute_burden_indices(merged: pd.DataFrame) -> dict[str, pd.Series]:
    """Population-conditioned access burden score (see
    docs/SOCCER_ACCESS_BURDEN_METHODOLOGY.md for the full derivation):
    burden_index_{sport} = max(residual, 0) * (total_population / 10_000) --
    excess person-minutes of access burden beyond what density alone
    predicts, weighted by RAW population in units of 10,000 residents (not
    density, and not raw headcount -- the /10_000 is a pure display-scale
    choice, dividing every NTA's weight by the same constant, so it changes
    nothing about the ranking, only how large the numbers look). Weighting
    represents how many actual residents are affected, and two NTAs with
    equal population but different density represent the same number of
    underserved people regardless of how spread out they are.

    Returns one Series per group, indexed like `merged`, same shape/NaN
    convention as _compute_residuals (which this builds on).
    """
    residual_by_group = _compute_residuals(merged)
    return {
        group: residual.clip(lower=0) * (merged["total_population"] / 10_000)
        for group, residual in residual_by_group.items()
    }


def export_burden_index():
    """burden_index_{sport} per NTA, for all 21 sport types -- what the
    dashboard's non-demographics map shows, in place of raw
    travel_time.geojson. See _compute_burden_indices() for the derivation.
    """
    merged = _load_merged_with_travel_time()
    burden_by_group = _compute_burden_indices(merged)
    for group, burden in burden_by_group.items():
        merged[f"burden_index_{group}"] = burden

    burden_columns = [f"burden_index_{g}" for g in config.SPORT_TYPE_GROUPS]
    output = merged[["NTA2020", "NTAName", "geometry"] + burden_columns]
    output_path = OUTPUT_DIR / "burden_index.geojson"
    output.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(output)} NTAs, {len(burden_columns)} sport types)")


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
    export_burden_index()
    export_nta_boundaries()
    export_tracts_by_nta()
    export_routes_by_nta()
    export_facilities_by_sport()


if __name__ == "__main__":
    main()
