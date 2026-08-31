"""Checkpointed per-sport-type driver for travel_time.compute_nearest_facility_times.

The full computation (23 sport types x 4 windows x 2,325 tracts) is a very
long-running batch job. Rather than one monolithic call that must be
restarted from scratch after any crash/power loss, this module drives the
computation one sport type at a time and writes an atomic checkpoint file
after each sport type fully succeeds. A subsequent run skips any sport type
that already has a checkpoint file, so it resumes instead of restarting.

Checkpoint files are written atomically (temp path, then os.replace) so a
process killed mid-write leaves no misleadingly "complete" checkpoint --
mirrors the atomic-download pattern already used in network_acquisition.py.
"""
import os
from pathlib import Path

import pandas as pd

from pipeline import config, travel_time

CHECKPOINT_COLUMNS = ["GEOID", "sport_type", "window_name", "travel_time_minutes"]


def default_checkpoint_dir() -> Path:
    return config.PROCESSED_DIR / "checkpoints"


def checkpoint_path(sport_type: str, checkpoint_dir: Path | None = None) -> Path:
    checkpoint_dir = checkpoint_dir or default_checkpoint_dir()
    return checkpoint_dir / f"{sport_type}.csv"


def has_checkpoint(sport_type: str, checkpoint_dir: Path | None = None) -> bool:
    return checkpoint_path(sport_type, checkpoint_dir).exists()


def write_checkpoint_atomic(
    result: pd.DataFrame, sport_type: str, checkpoint_dir: Path | None = None
) -> Path:
    """Write ``result`` to this sport type's checkpoint file atomically.

    Writes to a ``.tmp`` sibling first, then ``os.replace``s it into place.
    ``os.replace`` is atomic on both POSIX and Windows, so a process killed
    mid-write leaves either the old checkpoint (absent, on a first attempt)
    or nothing at all under the final name -- never a truncated/partial file
    that a resumed run's ``has_checkpoint`` check would mistake for complete.
    """
    path = checkpoint_path(sport_type, checkpoint_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    result.to_csv(tmp_path, index=False)
    os.replace(tmp_path, path)
    return path


def read_all_checkpoints(sport_types=None, checkpoint_dir: Path | None = None) -> pd.DataFrame:
    sport_types = sport_types or list(config.SPORT_TYPE_COLUMNS)
    frames = [
        pd.read_csv(checkpoint_path(sport_type, checkpoint_dir), dtype={"GEOID": str})
        for sport_type in sport_types
    ]
    return pd.concat(frames, ignore_index=True)[CHECKPOINT_COLUMNS]


def run_sport_types(
    transport_network,
    tract_origins,
    facilities_by_sport_type: dict,
    tract_offsets_minutes: dict,
    sport_types=None,
    checkpoint_dir: Path | None = None,
    compute_fn=None,
) -> pd.DataFrame:
    """Compute (or skip, if already checkpointed) travel times one sport
    type at a time and return the full concatenated result across every
    requested sport type.

    ``compute_fn`` defaults to travel_time.compute_nearest_facility_times but
    is injectable so tests can exercise the checkpoint/resume/concatenate
    logic without a JVM or real network -- the existing pattern in
    tests/test_travel_time.py, which monkeypatches travel_time._run_matrix
    for the same reason, targets a layer below this one; this module needs
    its own seam one level up so its own orchestration (skip vs. compute vs.
    checkpoint) can be tested in isolation.
    """
    sport_types = sport_types or list(config.SPORT_TYPE_COLUMNS)
    compute_fn = compute_fn or travel_time.compute_nearest_facility_times

    for sport_type in sport_types:
        if has_checkpoint(sport_type, checkpoint_dir):
            print(f"[{sport_type}] checkpoint already exists, skipping")
            continue

        print(f"[{sport_type}] computing travel times for all windows/tracts...")
        result = compute_fn(
            transport_network,
            tract_origins,
            {sport_type: facilities_by_sport_type[sport_type]},
            tract_offsets_minutes,
        )
        write_checkpoint_atomic(result, sport_type, checkpoint_dir)
        print(f"[{sport_type}] checkpoint written")

    return read_all_checkpoints(sport_types, checkpoint_dir)
