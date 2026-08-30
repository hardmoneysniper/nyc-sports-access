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


def validate_reference_dates() -> None:
    """Check config.REFERENCE_WEEKDAY/REFERENCE_WEEKEND_DAY against every
    downloaded GTFS feed's calendar.txt validity window, not just one feed.

    NYC bus GTFS feeds are published with short rolling validity windows, so
    a reference date that is valid against (e.g.) the subway feed can easily
    fall outside a bus feed's window by the time the full pipeline actually
    runs. Raises loudly (rather than silently routing around a feed with no
    active service on the reference date) so config.py's reference dates get
    fixed before the expensive real run, not discovered as an unexplained gap
    in the output.
    """
    import zipfile
    import pandas as pd

    for gtfs_path in config.NETWORK_DIR.glob("*.zip"):
        with zipfile.ZipFile(gtfs_path) as z:
            if "calendar.txt" not in z.namelist():
                continue  # some feeds (e.g. ferry) may only use calendar_dates.txt
            with z.open("calendar.txt") as f:
                calendar = pd.read_csv(f, dtype=str)
        for reference_date, label in [
            (config.REFERENCE_WEEKDAY, "REFERENCE_WEEKDAY"),
            (config.REFERENCE_WEEKEND_DAY, "REFERENCE_WEEKEND_DAY"),
        ]:
            date_int = int(reference_date.strftime("%Y%m%d"))
            in_range = (
                (calendar["start_date"].astype(int) <= date_int)
                & (calendar["end_date"].astype(int) >= date_int)
            )
            if not in_range.any():
                raise ValueError(
                    f"{label} ({reference_date}) is outside {gtfs_path.name}'s "
                    f"calendar.txt validity window (min start_date="
                    f"{calendar['start_date'].min()}, max end_date="
                    f"{calendar['end_date'].max()}). Update config.REFERENCE_WEEKDAY/"
                    f"REFERENCE_WEEKEND_DAY to dates within every downloaded feed's "
                    f"validity window before running the full pipeline."
                )
