"""Derive a single weighted-average travel time per sport type (collapsing the
4 time-window columns) from the existing tract/NTA output tables, and write
reduced spreadsheets alongside them.

Run after run_pipeline_batched.py has produced data/processed/tract_output.csv
and data/processed/nta_output.geojson. Does not touch or recompute anything in
the underlying pipeline -- purely a post-processing step over already-written
output.
"""
import pandas as pd
import geopandas as gpd

from pipeline import build_output, config


def main():
    tract = pd.read_csv(config.PROCESSED_DIR / "tract_output.csv", dtype={"GEOID": str})
    nta = gpd.read_file(config.PROCESSED_DIR / "nta_output.geojson")

    tract_combined = build_output.add_combined_time_columns(tract, config.SPORT_TYPE_COLUMNS)
    nta_combined = build_output.add_combined_time_columns(nta, config.SPORT_TYPE_COLUMNS)

    combined_columns = [f"travel_time_{sport}" for sport in config.SPORT_TYPE_COLUMNS]

    tract_out = tract_combined[["GEOID", "NTA2020"] + combined_columns]
    tract_out_path = config.PROCESSED_DIR / "tract_output_combined_time.csv"
    tract_out.to_csv(tract_out_path, index=False)
    print(f"Wrote {tract_out_path} ({len(tract_out)} rows, {len(combined_columns)} sport-type columns)")

    nta_out = nta_combined[["NTA2020", "NTAName"] + combined_columns]
    nta_out_path = config.PROCESSED_DIR / "nta_output_combined_time.csv"
    nta_out.to_csv(nta_out_path, index=False)
    print(f"Wrote {nta_out_path} ({len(nta_out)} rows, {len(combined_columns)} sport-type columns)")


if __name__ == "__main__":
    main()
