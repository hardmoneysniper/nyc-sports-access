import zipfile
from unittest.mock import patch, MagicMock

from pipeline import network_acquisition


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
