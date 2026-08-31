"""Checkpointed end-to-end orchestration for the full 23-sport-type x
4-window x 2,325-tract run.

Does the same one-time setup as run_pipeline.py (geography, tract origins/
offsets, demographics, facility loading/filtering, network build) exactly
once, then computes travel times one sport type at a time via
pipeline.batch_runner.run_sport_types, which checkpoints each sport type to
data/processed/checkpoints/{sport_type}.csv immediately after it succeeds.

This means the script can be killed (power loss, etc.) at any point and
simply re-run: any sport type with an existing checkpoint file is skipped,
and the run resumes at the first sport type without one. Checkpoints are
written atomically (temp file + rename), so a checkpoint killed mid-write
never looks falsely "complete" to a resumed run.

Once every sport type has a checkpoint, this reads them all back,
concatenates them, and proceeds with the same aggregation/output steps as
run_pipeline.py.
"""
from dotenv import load_dotenv

from pipeline import aggregate_travel_time, batch_runner, build_output, config, pipeline_setup

load_dotenv()


def main():
    setup = pipeline_setup.run_setup()

    print("Computing travel-time matrices one sport type at a time, with per-sport-type checkpoints...")
    tract_times = batch_runner.run_sport_types(
        setup.network,
        setup.tract_origins,
        setup.facilities_by_sport_type,
        setup.tract_offsets,
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
