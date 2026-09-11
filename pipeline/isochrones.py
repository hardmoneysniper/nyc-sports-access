"""Checkpointed per-facility walking-isochrone computation via r5py.Isochrones.

r5py.Isochrones has a critical quirk (verified empirically): passing multiple
origins in one call combines them into ONE shared isochrone rather than one
per origin. So this module calls it once per facility, one at a time, and
checkpoints in batches (not one file per facility -- 5,847 tiny files would
be excessive filesystem overhead) so a killed/crashed run can resume instead
of restarting.

Only the 15-minute cutoff is computed (per project owner decision -- runtime
is not a constraint, so this uses r5py's default, finer point_grid_resolution
(100m) rather than a coarser/faster one: at resolution=200m, empirical
testing across 6 real facilities found the shorter cutoffs were frequently
missing/invalid (grid spacing relative to a short walking distance is
inconsistent depending on how the grid happens to align with each origin) --
dropping to a single, longer (15-minute) cutoff sidesteps that reliability
problem entirely, since 15 minutes of walking distance comfortably exceeds
the grid spacing regardless of alignment.
"""
import datetime
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd

from pipeline import config

CUTOFFS = [datetime.timedelta(minutes=15)]
ISOCHRONE_COLUMNS = ["facility_id", "cutoff_minutes", "geometry"]


def default_checkpoint_dir() -> Path:
    return config.PROCESSED_DIR / "isochrone_checkpoints"


def batch_checkpoint_path(batch_index: int, checkpoint_dir: Path | None = None) -> Path:
    checkpoint_dir = checkpoint_dir or default_checkpoint_dir()
    return checkpoint_dir / f"batch_{batch_index:04d}.geojson"


def has_batch_checkpoint(batch_index: int, checkpoint_dir: Path | None = None) -> bool:
    return batch_checkpoint_path(batch_index, checkpoint_dir).exists()


def write_batch_checkpoint_atomic(
    result: gpd.GeoDataFrame, batch_index: int, checkpoint_dir: Path | None = None
) -> Path:
    """Write atomically: temp file + os.replace, mirroring
    pipeline.batch_runner's atomic-checkpoint pattern so a process killed
    mid-write never leaves a checkpoint that looks falsely complete.
    """
    path = batch_checkpoint_path(batch_index, checkpoint_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    result.to_file(tmp_path, driver="GeoJSON")
    os.replace(tmp_path, path)
    return path


def compute_isochrones_for_facility(transport_network, facility_id: str, origin_point, compute_fn=None) -> gpd.GeoDataFrame:
    """One facility, one r5py.Isochrones call. Returns a GeoDataFrame with
    columns facility_id, cutoff_minutes, geometry -- one row per cutoff that
    produced valid geometry (an invalid/degenerate cutoff, e.g. a grid too
    coarse relative to the cutoff distance, is dropped rather than stored as
    a misleading empty shape).
    """
    if compute_fn is None:
        import r5py  # imported lazily so unit tests don't require a JVM

        def compute_fn(transport_network, origins):
            return r5py.Isochrones(
                transport_network,
                origins=origins,
                isochrones=CUTOFFS,
                transport_modes=[r5py.TransportMode.WALK],
                departure=datetime.datetime.combine(
                    config.REFERENCE_WEEKDAY, datetime.time(7, 0)
                ),
                # No point_grid_resolution override -- uses r5py's default
                # (100m, finer than the 200m tried and rejected above).
            )

    origins = gpd.GeoDataFrame({"id": [facility_id]}, geometry=[origin_point], crs=config.CRS_GEOGRAPHIC)
    raw = compute_fn(transport_network, origins)
    valid = raw[raw.geometry.is_valid & ~raw.geometry.is_empty].copy()
    valid["facility_id"] = facility_id
    valid["cutoff_minutes"] = valid["travel_time"].dt.total_seconds() / 60
    return valid[ISOCHRONE_COLUMNS]


def run_facility_batches(
    transport_network,
    facilities_with_origins: gpd.GeoDataFrame,
    batch_size: int = 50,
    checkpoint_dir: Path | None = None,
    compute_fn=None,
) -> gpd.GeoDataFrame:
    """facilities_with_origins must have an 'id' column (unique facility id)
    and a 'geometry' column (the origin Point, already representative_point()
    -converted and reprojected to CRS_GEOGRAPHIC). Splits into batches of
    batch_size, skips any batch that already has a checkpoint, computes and
    checkpoints the rest, then returns the full concatenated result read
    back from all batch checkpoints.
    """
    facilities_with_origins = facilities_with_origins.reset_index(drop=True)
    n_batches = (len(facilities_with_origins) + batch_size - 1) // batch_size

    for batch_index in range(n_batches):
        if has_batch_checkpoint(batch_index, checkpoint_dir):
            print(f"[batch {batch_index}/{n_batches - 1}] checkpoint already exists, skipping")
            continue

        start = batch_index * batch_size
        end = start + batch_size
        batch_facilities = facilities_with_origins.iloc[start:end]

        print(f"[batch {batch_index}/{n_batches - 1}] computing {len(batch_facilities)} facilities...")
        batch_results = []
        for row in batch_facilities.itertuples():
            result = compute_isochrones_for_facility(
                transport_network, row.id, row.geometry, compute_fn=compute_fn
            )
            batch_results.append(result)
        batch_gdf = gpd.GeoDataFrame(
            pd.concat(batch_results, ignore_index=True), crs=config.CRS_GEOGRAPHIC
        )
        write_batch_checkpoint_atomic(batch_gdf, batch_index, checkpoint_dir)
        print(f"[batch {batch_index}/{n_batches - 1}] checkpoint written")

    all_batches = [
        gpd.read_file(batch_checkpoint_path(i, checkpoint_dir)) for i in range(n_batches)
    ]
    return gpd.GeoDataFrame(pd.concat(all_batches, ignore_index=True), crs=config.CRS_GEOGRAPHIC)
