import pandas as pd
import pytest

from pipeline import batch_runner


def _fake_result(sport_type, window_names):
    rows = []
    for window_name in window_names:
        for geoid in ["T1", "T2"]:
            rows.append(
                {
                    "GEOID": geoid,
                    "sport_type": sport_type,
                    "window_name": window_name,
                    "travel_time_minutes": 10.0,
                }
            )
    return pd.DataFrame(rows)


def test_sport_type_with_existing_checkpoint_is_skipped(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    # Pre-seed a checkpoint for "basketball" as if a prior run already
    # completed it.
    existing = _fake_result("basketball", ["weekday_morning"])
    existing.to_csv(checkpoint_dir / "basketball.csv", index=False)

    calls = []

    def fake_compute(transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes):
        calls.append(list(facilities_by_sport_type.keys())[0])
        sport_type = list(facilities_by_sport_type.keys())[0]
        return _fake_result(sport_type, ["weekday_morning"])

    result = batch_runner.run_sport_types(
        transport_network=None,
        tract_origins=None,
        facilities_by_sport_type={"basketball": object(), "tennis": object()},
        tract_offsets_minutes={},
        sport_types=["basketball", "tennis"],
        checkpoint_dir=checkpoint_dir,
        compute_fn=fake_compute,
    )

    assert calls == ["tennis"]  # basketball never computed, only tennis
    assert set(result["sport_type"]) == {"basketball", "tennis"}


def test_sport_type_without_checkpoint_is_computed_and_checkpoint_appears(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"

    def fake_compute(transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes):
        sport_type = list(facilities_by_sport_type.keys())[0]
        return _fake_result(sport_type, ["weekday_morning"])

    batch_runner.run_sport_types(
        transport_network=None,
        tract_origins=None,
        facilities_by_sport_type={"tennis": object()},
        tract_offsets_minutes={},
        sport_types=["tennis"],
        checkpoint_dir=checkpoint_dir,
        compute_fn=fake_compute,
    )

    checkpoint_file = checkpoint_dir / "tennis.csv"
    assert checkpoint_file.exists()
    written = pd.read_csv(checkpoint_file)
    assert set(written["sport_type"]) == {"tennis"}
    assert len(written) == 2  # T1, T2


def test_final_concatenated_result_correct_after_partial_then_resumed_run(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()

    # Simulate a prior run that got killed after "basketball" and "tennis"
    # succeeded, but before "hockey" was computed.
    _fake_result("basketball", ["weekday_morning", "weekend_morning"]).to_csv(
        checkpoint_dir / "basketball.csv", index=False
    )
    _fake_result("tennis", ["weekday_morning", "weekend_morning"]).to_csv(
        checkpoint_dir / "tennis.csv", index=False
    )

    calls = []

    def fake_compute(transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes):
        sport_type = list(facilities_by_sport_type.keys())[0]
        calls.append(sport_type)
        return _fake_result(sport_type, ["weekday_morning", "weekend_morning"])

    result = batch_runner.run_sport_types(
        transport_network=None,
        tract_origins=None,
        facilities_by_sport_type={"basketball": object(), "tennis": object(), "hockey": object()},
        tract_offsets_minutes={},
        sport_types=["basketball", "tennis", "hockey"],
        checkpoint_dir=checkpoint_dir,
        compute_fn=fake_compute,
    )

    assert calls == ["hockey"]  # only the missing one gets computed
    assert set(result["sport_type"]) == {"basketball", "tennis", "hockey"}
    # 3 sport types x 2 windows x 2 tracts = 12 rows total
    assert len(result) == 12
    for sport_type in ["basketball", "tennis", "hockey"]:
        assert (checkpoint_dir / f"{sport_type}.csv").exists()


def test_checkpoint_written_atomically_no_tmp_left_behind(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"

    def fake_compute(transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes):
        sport_type = list(facilities_by_sport_type.keys())[0]
        return _fake_result(sport_type, ["weekday_morning"])

    batch_runner.run_sport_types(
        transport_network=None,
        tract_origins=None,
        facilities_by_sport_type={"tennis": object()},
        tract_offsets_minutes={},
        sport_types=["tennis"],
        checkpoint_dir=checkpoint_dir,
        compute_fn=fake_compute,
    )

    files = list(checkpoint_dir.iterdir())
    assert [f.name for f in files] == ["tennis.csv"]  # no leftover .tmp file


def test_has_checkpoint_false_when_only_tmp_file_present(tmp_path):
    # A checkpoint killed mid-write leaves only a .tmp file behind (per the
    # atomic-write contract) -- has_checkpoint must not treat that as done.
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    (checkpoint_dir / "tennis.csv.tmp").write_text("GEOID,sport_type\n")

    assert batch_runner.has_checkpoint("tennis", checkpoint_dir) is False


def test_read_all_checkpoints_concatenates_in_sport_type_order(tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    _fake_result("basketball", ["weekday_morning"]).to_csv(checkpoint_dir / "basketball.csv", index=False)
    _fake_result("tennis", ["weekday_morning"]).to_csv(checkpoint_dir / "tennis.csv", index=False)

    result = batch_runner.read_all_checkpoints(["basketball", "tennis"], checkpoint_dir)

    assert list(result.columns) == ["GEOID", "sport_type", "window_name", "travel_time_minutes"]
    assert list(result["sport_type"]) == ["basketball", "basketball", "tennis", "tennis"]


def test_read_all_checkpoints_preserves_geoid_as_string_for_real_looking_ids(tmp_path):
    # Real NYC GEOIDs are all-digit strings (e.g. "36061000100"). Without an
    # explicit dtype, pd.read_csv infers int64 for an all-digit column,
    # breaking downstream merges against tract_to_nta (which stays string) --
    # this only reproduces with numeric-looking ids, not the "T1"/"T2"
    # fixtures used elsewhere in this file.
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    real_geoid_result = pd.DataFrame(
        [{
            "GEOID": "36061000100",
            "sport_type": "tennis",
            "window_name": "weekday_morning",
            "travel_time_minutes": 12.5,
        }]
    )
    real_geoid_result.to_csv(checkpoint_dir / "tennis.csv", index=False)

    result = batch_runner.read_all_checkpoints(["tennis"], checkpoint_dir)

    assert pd.api.types.is_string_dtype(result["GEOID"])
    assert not pd.api.types.is_integer_dtype(result["GEOID"])
    assert result["GEOID"].iloc[0] == "36061000100"


def test_read_all_checkpoints_accepts_custom_columns(tmp_path):
    # run_evening_windows.py's checkpoints carry a 5th column
    # (nearest_facility_id, from travel_time.compute_nearest_facility_routes)
    # that the 4-column CHECKPOINT_COLUMNS default would silently drop.
    checkpoint_dir = tmp_path / "checkpoints"
    checkpoint_dir.mkdir()
    pd.DataFrame([{
        "GEOID": "T1",
        "sport_type": "tennis",
        "window_name": "weekday_evening",
        "nearest_facility_id": "42",
        "travel_time_minutes": 12.5,
    }]).to_csv(checkpoint_dir / "tennis.csv", index=False)

    result = batch_runner.read_all_checkpoints(
        ["tennis"], checkpoint_dir,
        columns=["GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes"],
    )

    assert list(result.columns) == [
        "GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes",
    ]
    assert result["nearest_facility_id"].iloc[0] == "42"
