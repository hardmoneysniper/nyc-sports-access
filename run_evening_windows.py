"""Point-to-point routing only, for the weekday-5pm/Saturday-5pm window pair.

Per project owner instruction (2026-09-14): compute tract-to-facility travel
times for config.EVENING_TIME_WINDOWS ("weekday_evening", "weekend_evening")
without touching the travel times already computed/checkpointed for the
original 4 windows in config.TIME_WINDOWS, and save the result as a
website-includable GeoJSON of route lines (not just a table of scalar
minutes). This script therefore:

- reuses pipeline_setup.run_setup() for geography/network/facility prep
  (identical to run_pipeline_batched.py), then
- runs batch_runner.run_sport_types against a *separate* checkpoint
  directory (data/processed/checkpoints_evening/), with a compute_fn pinned
  to the 2 evening windows and to
  travel_time.compute_nearest_facility_routes (which, unlike
  compute_nearest_facility_times, keeps which facility was nearest --
  needed to draw a line to it), then
- builds one straight "desire line" per tract/sport-type/window from the
  tract's origin point to its nearest facility (pipeline/routes.py -- see
  that module's docstring for why these are straight lines, not literal
  transit-path geometry), and writes them to
  data/processed/evening_routes.geojson.

No NTA aggregation, no tract/NTA output table writes -- those steps in
run_pipeline_batched.py operate on config.TIME_WINDOWS-shaped scalar travel
times. Wiring the evening windows into that aggregation is a separate
decision for later, not part of "only generate the point-to-point routing."

Checkpointed and resumable exactly like run_pipeline_batched.py: each sport
type's evening-window result is written atomically to
data/processed/checkpoints_evening/{sport_type}.csv, and a re-run skips any
sport type that already has one there.
"""
import functools

from dotenv import load_dotenv

from pipeline import batch_runner, config, pipeline_setup, routes, travel_time

load_dotenv()

EVENING_CHECKPOINT_DIR = config.PROCESSED_DIR / "checkpoints_evening"
ROUTE_CHECKPOINT_COLUMNS = ["GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes"]


def main():
    setup = pipeline_setup.run_setup()

    print("Computing weekday-5pm/Saturday-5pm nearest-facility routes, one sport type at a time...")
    compute_fn = functools.partial(
        travel_time.compute_nearest_facility_routes,
        window_names=list(config.EVENING_TIME_WINDOWS),
        time_windows=config.EVENING_TIME_WINDOWS,
    )
    # Return value discarded: run_sport_types' own return goes through
    # read_all_checkpoints' 4-column default, which would silently drop
    # nearest_facility_id. Re-read explicitly below with the 5-column shape
    # these checkpoints actually have.
    batch_runner.run_sport_types(
        setup.network,
        setup.tract_origins,
        setup.facilities_by_sport_type,
        setup.tract_offsets,
        checkpoint_dir=EVENING_CHECKPOINT_DIR,
        compute_fn=compute_fn,
    )
    nearest_routes = batch_runner.read_all_checkpoints(
        checkpoint_dir=EVENING_CHECKPOINT_DIR, columns=ROUTE_CHECKPOINT_COLUMNS
    )

    print("Building route-line geometries...")
    route_lines = routes.build_route_lines(
        nearest_routes, setup.tract_origins, setup.tract_to_nta, setup.facilities_by_sport_type
    )
    output_path = config.PROCESSED_DIR / "evening_routes.geojson"
    routes.write_routes_geojson(route_lines, output_path)
    print(f"Done. {len(route_lines)} route lines written to {output_path}")


if __name__ == "__main__":
    main()
