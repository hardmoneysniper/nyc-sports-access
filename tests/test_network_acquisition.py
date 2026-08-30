import datetime
import zipfile
from unittest.mock import patch, MagicMock

import pytest

from pipeline import network_acquisition


def _write_gtfs_zip(path, start_date, end_date, include_calendar=True):
    with zipfile.ZipFile(path, "w") as z:
        if include_calendar:
            z.writestr(
                "calendar.txt",
                "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                f"Weekday,1,1,1,1,1,0,0,{start_date},{end_date}\n",
            )
        else:
            z.writestr("calendar_dates.txt", "service_id,date,exception_type\n")


def test_download_gtfs_feeds_writes_valid_zip_files(tmp_path, monkeypatch):
    monkeypatch.setattr(network_acquisition.config, "NETWORK_DIR", tmp_path)
    monkeypatch.setattr(
        network_acquisition.config, "GTFS_URLS", {"subway": "http://example.com/gtfs_subway.zip"}
    )

    fake_response = MagicMock()
    fake_response.iter_content.return_value = [b"PK\x03\x04fakezipbytes"]
    fake_response.raise_for_status.return_value = None

    with patch("pipeline.network_acquisition.requests.get", return_value=fake_response):
        with patch("pipeline.network_acquisition.zipfile.is_zipfile", return_value=True):
            paths = network_acquisition.download_gtfs_feeds()

    assert len(paths) == 1
    assert paths[0].name == "subway.zip"
    assert paths[0].exists()


def test_download_gtfs_feeds_raises_on_invalid_zip(tmp_path, monkeypatch):
    monkeypatch.setattr(network_acquisition.config, "NETWORK_DIR", tmp_path)
    monkeypatch.setattr(
        network_acquisition.config,
        "GTFS_URLS",
        {"subway": "http://example.com/gtfs_subway.zip"},
    )

    fake_response = MagicMock()
    fake_response.iter_content.return_value = [b"not actually a zip"]
    fake_response.raise_for_status.return_value = None

    with patch("pipeline.network_acquisition.requests.get", return_value=fake_response):
        with patch("pipeline.network_acquisition.zipfile.is_zipfile", return_value=False):
            with pytest.raises(ValueError, match="subway"):
                network_acquisition.download_gtfs_feeds()

    # The corrupt download must never occupy the final destination path.
    assert not (tmp_path / "subway.zip").exists()


def test_validate_reference_dates_passes_when_all_feeds_cover_both_dates(tmp_path, monkeypatch):
    monkeypatch.setattr(network_acquisition.config, "NETWORK_DIR", tmp_path)
    monkeypatch.setattr(network_acquisition.config, "REFERENCE_WEEKDAY", datetime.date(2026, 9, 15))
    monkeypatch.setattr(network_acquisition.config, "REFERENCE_WEEKEND_DAY", datetime.date(2026, 9, 19))

    _write_gtfs_zip(tmp_path / "subway.zip", "20260526", "20261031")
    _write_gtfs_zip(tmp_path / "bus_manhattan.zip", "20260901", "20261001")
    # A calendar_dates.txt-only feed (e.g. ferry) must be skipped, not treated
    # as a failure to validate.
    _write_gtfs_zip(tmp_path / "ferry.zip", "20260101", "20261231", include_calendar=False)

    network_acquisition.validate_reference_dates()  # must not raise


def test_validate_reference_dates_raises_when_a_feed_expires_before_reference_date(tmp_path, monkeypatch):
    monkeypatch.setattr(network_acquisition.config, "NETWORK_DIR", tmp_path)
    monkeypatch.setattr(network_acquisition.config, "REFERENCE_WEEKDAY", datetime.date(2026, 9, 15))
    monkeypatch.setattr(network_acquisition.config, "REFERENCE_WEEKEND_DAY", datetime.date(2026, 9, 19))

    _write_gtfs_zip(tmp_path / "subway.zip", "20260526", "20261031")
    # This bus feed's window ends before REFERENCE_WEEKDAY.
    _write_gtfs_zip(tmp_path / "bus_manhattan.zip", "20260701", "20260904")

    with pytest.raises(ValueError, match="REFERENCE_WEEKDAY"):
        network_acquisition.validate_reference_dates()
