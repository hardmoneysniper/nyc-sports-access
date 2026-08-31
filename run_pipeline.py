"""End-to-end orchestration: run once after Tasks 1-11 are all committed.

For a full 23-sport-type x 4-window x 2,325-tract run, prefer
run_pipeline_batched.py instead: it does the same one-time setup and the
same final aggregation/output steps, but computes travel times one sport
type at a time with a checkpoint file per sport type, so a killed/crashed
run can resume instead of restarting from scratch. This script computes
all sport types in one call and is best suited to smaller runs (fewer
sport types, a smoke test, etc.) where restart-from-scratch is cheap enough
not to need checkpointing.
"""
from dotenv import load_dotenv

from pipeline import aggregate_travel_time, build_output, config, pipeline_setup, travel_time

load_dotenv()


def main():
    setup = pipeline_setup.run_setup()

    print("Computing travel-time matrices (this can take hours for the full dataset)...")
    tract_times = travel_time.compute_nearest_facility_times(
        setup.network, setup.tract_origins, setup.facilities_by_sport_type, setup.tract_offsets
    )

    print("Aggregating travel times to NTA level...")
    nta_times = aggregate_travel_time.aggregate_to_nta(
        tract_times, setup.tract_to_nta, setup.tract_population
    )

    print("Writing output tables...")
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    build_output.write_tract_output(
        tract_times, setup.tract_to_nta, config.PROCESSED_DIR / "tract_output.csv"
    )
    build_output.write_nta_output(
        setup.nta_demographics,
        nta_times,
        setup.ntas.to_crs(config.CRS_GEOGRAPHIC),
        config.PROCESSED_DIR / "nta_output.geojson",
    )
    print("Done.")


if __name__ == "__main__":
    main()
