"""Real transit-path geometry for the weekday-5pm/Saturday-5pm nearest-facility
pairs already computed by run_evening_windows.py.

Requires data/processed/checkpoints_evening/{sport_type}.csv to already
exist (produced by run_evening_windows.py) -- this script only adds real
path geometry on top of nearest-facility assignments made there; it does
not redo that computation, and does not touch it.

Runs against WHICHEVER sport types currently have a Stage-1 checkpoint, not
all 24 -- run_evening_windows.py checkpoints one sport type at a time, so on
a machine where it's still running (or only partially copied over), most
sport types won't have a checkpoint yet. A re-run after more Stage-1
checkpoints appear picks up the newly-available ones and skips whatever
Stage-2 checkpoints this script already wrote, same resume behavior as
Stage 1. "Done" therefore means "done for what's available so far," not
necessarily all 24 -- the final printed count says how many sport types
were actually included.

Cost model warning: unlike run_evening_windows.py (one r5py.TravelTimeMatrix
call covers an entire sport type's ~2,325 tracts in one batched sweep), this
script calls r5py.DetailedItineraries once per (sport_type, window) group,
and that call itself runs one full point-to-point trip search PER TRACT
internally (see pipeline/detailed_routes.py's module docstring for why).
Expect this to be substantially slower per sport type than
run_evening_windows.py was -- there is no empirical timing for this yet, so
budget extra time and consider a small-scope test run first (e.g. one sport
type) before committing to all 24.

Checkpointed the same way as run_evening_windows.py, one sport type at a
time, so it can be safely interrupted and resumed: each sport type's result
is written atomically to
data/processed/checkpoints_evening_detailed/{sport_type}.geojson.
"""
import os

import geopandas as gpd
import pandas as pd
from dotenv import load_dotenv

from pipeline import batch_runner, config, detailed_routes, pipeline_setup

load_dotenv()

NEAREST_ROUTES_CHECKPOINT_DIR = config.PROCESSED_DIR / "checkpoints_evening"
DETAILED_CHECKPOINT_DIR = config.PROCESSED_DIR / "checkpoints_evening_detailed"
ROUTE_CHECKPOINT_COLUMNS = ["GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes"]


def _checkpoint_path(sport_type):
    return DETAILED_CHECKPOINT_DIR / f"{sport_type}.geojson"


def _write_checkpoint_atomic(gdf, sport_type):
    # Same atomic temp-file-then-rename pattern as
    # batch_runner.write_checkpoint_atomic, adapted for GeoJSON (geometry
    # doesn't round-trip cleanly through CSV) -- a process killed mid-write
    # never leaves a checkpoint that looks falsely complete.
    path = _checkpoint_path(sport_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    gdf.to_file(tmp_path, driver="GeoJSON")
    os.replace(tmp_path, path)


def _available_sport_types():
    # config.SPORT_TYPE_COLUMNS order preserved (not just whatever os.listdir
    # happens to return), so behavior is deterministic across runs/machines.
    return [
        sport_type for sport_type in config.SPORT_TYPE_COLUMNS
        if (NEAREST_ROUTES_CHECKPOINT_DIR / f"{sport_type}.csv").exists()
    ]


def main():
    setup = pipeline_setup.run_setup()

    sport_types = _available_sport_types()
    missing = sorted(set(config.SPORT_TYPE_COLUMNS) - set(sport_types))
    print(f"{len(sport_types)}/{len(config.SPORT_TYPE_COLUMNS)} sport types have a Stage-1 checkpoint available.")
    if missing:
        print(f"Not yet available (will be skipped this run): {missing}")
    if not sport_types:
        print(f"No Stage-1 checkpoints found in {NEAREST_ROUTES_CHECKPOINT_DIR} -- nothing to do yet.")
        return

    nearest_routes = batch_runner.read_all_checkpoints(
        sport_types=sport_types, checkpoint_dir=NEAREST_ROUTES_CHECKPOINT_DIR, columns=ROUTE_CHECKPOINT_COLUMNS
    )

    print("Computing real transit-path geometry, one sport type at a time...")
    for sport_type, group in nearest_routes.groupby("sport_type"):
        if _checkpoint_path(sport_type).exists():
            print(f"[{sport_type}] checkpoint already exists, skipping")
            continue

        print(f"[{sport_type}] computing detailed routes for {len(group)} tract/window pairs...")
        detailed = detailed_routes.compute_nearest_facility_paths(
            setup.network, group, setup.tract_origins, setup.facilities_by_sport_type,
            time_windows=config.EVENING_TIME_WINDOWS,
        )
        _write_checkpoint_atomic(detailed, sport_type)
        print(f"[{sport_type}] checkpoint written")

    print("Combining per-sport-type checkpoints...")
    all_routes = pd.concat(
        [gpd.read_file(_checkpoint_path(sport_type)) for sport_type in nearest_routes["sport_type"].unique()],
        ignore_index=True,
    )
    all_routes = gpd.GeoDataFrame(all_routes, crs=config.CRS_GEOGRAPHIC)
    output_path = config.PROCESSED_DIR / "evening_routes_detailed.geojson"
    detailed_routes.write_detailed_routes_geojson(all_routes, output_path)
    print(f"Done. {len(all_routes)} route segments written to {output_path}")


if __name__ == "__main__":
    main()
