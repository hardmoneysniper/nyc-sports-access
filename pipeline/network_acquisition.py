"""Downloading OSM extract and GTFS static feeds for r5py."""
import zipfile
from pathlib import Path

import requests

from pipeline import config


def _download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with open(destination, "wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    return destination


def download_gtfs_feeds() -> list[Path]:
    paths = []
    for name, url in config.GTFS_URLS.items():
        destination = config.NETWORK_DIR / f"{name}.zip"
        _download(url, destination)
        if not zipfile.is_zipfile(destination):
            raise ValueError(f"Downloaded file for '{name}' is not a valid zip: {destination}")
        paths.append(destination)
    return paths


def download_osm_extract(url: str) -> Path:
    destination = config.NETWORK_DIR / "new-york.osm.pbf"
    return _download(url, destination)
