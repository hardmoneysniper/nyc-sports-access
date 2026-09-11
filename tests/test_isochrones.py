import datetime

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point, LineString, MultiLineString

from pipeline import isochrones


def _fake_isochrones_result(cutoffs_minutes, valid_flags):
    """Mimics r5py.Isochrones' real return shape: one row per cutoff, a
    'travel_time' timedelta column, and a 'geometry' MultiLineString column.
    valid_flags controls which rows get real vs degenerate (empty) geometry,
    matching the real observed behavior where a too-coarse grid produces an
    empty/invalid geometry for a short cutoff.
    """
    rows = []
    for minutes, valid in zip(cutoffs_minutes, valid_flags):
        geom = MultiLineString([LineString([(0, 0), (1, 1)])]) if valid else MultiLineString([])
        rows.append({"travel_time": datetime.timedelta(minutes=minutes), "geometry": geom})
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def test_compute_isochrones_for_facility_drops_invalid_cutoffs():
    def fake_compute_fn(transport_network, origins):
        return _fake_isochrones_result([5, 10, 15], [True, True, False])

    result = isochrones.compute_isochrones_for_facility(
        transport_network=None, facility_id="F1", origin_point=Point(0, 0), compute_fn=fake_compute_fn
    )
    assert list(result["cutoff_minutes"]) == [5.0, 10.0]
    assert (result["facility_id"] == "F1").all()


def test_run_facility_batches_skips_existing_checkpoint(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    existing = gpd.GeoDataFrame(
        {"facility_id": ["F1"], "cutoff_minutes": [5.0]},
        geometry=[Point(0, 0)], crs="EPSG:4326",
    )
    isochrones.write_batch_checkpoint_atomic(existing, 0, checkpoint_dir)

    calls = []

    def fake_compute_fn(transport_network, origins):
        calls.append(origins["id"].iloc[0])
        return _fake_isochrones_result([5, 10, 15], [True, True, True])

    facilities_with_origins = gpd.GeoDataFrame(
        {"id": ["F1"]}, geometry=[Point(0, 0)], crs="EPSG:4326"
    )
    isochrones.run_facility_batches(
        transport_network=None, facilities_with_origins=facilities_with_origins,
        batch_size=50, checkpoint_dir=checkpoint_dir, compute_fn=fake_compute_fn,
    )
    assert calls == [], "F1's batch already had a checkpoint; compute_fn must not be called"


def test_run_facility_batches_computes_missing_batch_and_concatenates(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"

    def fake_compute_fn(transport_network, origins):
        return _fake_isochrones_result([5, 10, 15], [True, True, True])

    facilities_with_origins = gpd.GeoDataFrame(
        {"id": ["F1", "F2"]}, geometry=[Point(0, 0), Point(1, 1)], crs="EPSG:4326"
    )
    result = isochrones.run_facility_batches(
        transport_network=None, facilities_with_origins=facilities_with_origins,
        batch_size=50, checkpoint_dir=checkpoint_dir, compute_fn=fake_compute_fn,
    )
    assert set(result["facility_id"]) == {"F1", "F2"}
    assert len(result) == 6  # 2 facilities x 3 valid cutoffs each
    assert isochrones.has_batch_checkpoint(0, checkpoint_dir)


def test_run_facility_batches_splits_into_multiple_batches(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"

    def fake_compute_fn(transport_network, origins):
        return _fake_isochrones_result([5, 10, 15], [True, True, True])

    facilities_with_origins = gpd.GeoDataFrame(
        {"id": [f"F{i}" for i in range(5)]},
        geometry=[Point(i, i) for i in range(5)], crs="EPSG:4326",
    )
    result = isochrones.run_facility_batches(
        transport_network=None, facilities_with_origins=facilities_with_origins,
        batch_size=2, checkpoint_dir=checkpoint_dir, compute_fn=fake_compute_fn,
    )
    # batch_size=2 over 5 facilities -> 3 batches (2, 2, 1)
    assert isochrones.has_batch_checkpoint(0, checkpoint_dir)
    assert isochrones.has_batch_checkpoint(1, checkpoint_dir)
    assert isochrones.has_batch_checkpoint(2, checkpoint_dir)
    assert not isochrones.has_batch_checkpoint(3, checkpoint_dir)
    assert set(result["facility_id"]) == {"F0", "F1", "F2", "F3", "F4"}


def test_atomic_checkpoint_write_leaves_no_tmp_file(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    gdf = gpd.GeoDataFrame(
        {"facility_id": ["F1"], "cutoff_minutes": [5.0]},
        geometry=[Point(0, 0)], crs="EPSG:4326",
    )
    path = isochrones.write_batch_checkpoint_atomic(gdf, 0, checkpoint_dir)
    assert path.exists()
    assert not path.with_suffix(path.suffix + ".tmp").exists()
