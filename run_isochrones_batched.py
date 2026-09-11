"""Checkpointed end-to-end run: 5/10/15-minute walking isochrones for every
active athletic facility (~5,847 facilities, one set per physical facility
location -- deliberately not per sport-type, since walking reachability is a
property of where a facility physically is, not what's played there).

Can be killed (power loss, etc.) and re-run: any batch with an existing
checkpoint is skipped, so it resumes instead of restarting the whole
multi-hour computation. See pipeline/isochrones.py for the checkpoint
mechanics and the point_grid_resolution=200 tuning rationale.
"""
from dotenv import load_dotenv

from pipeline import config, facilities, isochrones, travel_time

load_dotenv()


def main():
    print("Loading and preparing facility origins...")
    active_facilities = facilities.load_active_facilities()
    facilities_with_origins = active_facilities.copy()
    facilities_with_origins["id"] = facilities_with_origins.index.astype(str)
    facilities_with_origins["geometry"] = facilities_with_origins.geometry.representative_point()
    facilities_with_origins = facilities_with_origins[["id", "geometry"]]
    print(f"{len(facilities_with_origins)} active facilities to process.")

    print("Building r5py transport network (this can take several minutes)...")
    network = travel_time.build_transport_network()

    print("Computing isochrones in checkpointed batches...")
    result = isochrones.run_facility_batches(network, facilities_with_origins, batch_size=50)

    output_path = config.PROCESSED_DIR / "facility_isochrones.geojson"
    result.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(result)} rows)")
    print("Done.")


if __name__ == "__main__":
    main()
