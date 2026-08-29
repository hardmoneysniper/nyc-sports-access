"""Downloading OSM extract and GTFS static feeds for r5py."""
import os
import zipfile
from pathlib import Path

import requests

from pipeline import config


def _download_to_temp(url: str, temp_path: Path) -> Path:
    """Stream ``url`` into ``temp_path``.

    Kept separate from the atomic rename so callers that need to validate
    the downloaded content (e.g. checking it's a real zip) can do so before
    the file ever occupies its final destination path.
    """
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with open(temp_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    return temp_path


def _download(url: str, destination: Path) -> Path:
    """Download ``url`` to ``destination`` atomically.

    The response is streamed into a temporary ``.part`` file alongside the
    final destination. Only once the download completes successfully is the
    temporary file atomically renamed to ``destination``. This guarantees
    that ``destination`` never contains partially-written data: if the
    download fails partway through, ``destination`` is left untouched
    (either absent, or a complete file from a prior successful run).
    """
    temp_path = destination.with_suffix(destination.suffix + ".part")
    _download_to_temp(url, temp_path)
    os.replace(temp_path, destination)
    return destination


def download_gtfs_feeds() -> list[Path]:
    paths = []
    for name, url in config.GTFS_URLS.items():
        destination = config.NETWORK_DIR / f"{name}.zip"
        temp_path = destination.with_suffix(destination.suffix + ".part")
        _download_to_temp(url, temp_path)
        if not zipfile.is_zipfile(temp_path):
            raise ValueError(f"Downloaded file for '{name}' is not a valid zip: {destination}")
        os.replace(temp_path, destination)
        paths.append(destination)
    return paths


def download_osm_extract(url: str) -> Path:
    destination = config.NETWORK_DIR / "new-york.osm.pbf"
    return _download(url, destination)
