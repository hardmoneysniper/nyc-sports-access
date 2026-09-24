"""r5py-based transit travel-time computation, per sport type per time window."""
import datetime

import geopandas as gpd
import pandas as pd

from pipeline import config


def build_transport_network():
    import r5py  # imported lazily so unit tests don't require a JVM

    gtfs_paths = [str(p) for p in config.NETWORK_DIR.glob("*.zip")]
    osm_path = str(config.NETWORK_DIR / "new-york.osm.pbf")
    return r5py.TransportNetwork(osm_path, gtfs=gtfs_paths)


def _run_matrix(transport_network, origins, destinations, departure, departure_time_window, percentiles):
    import r5py  # imported lazily so unit tests don't require a JVM

    return r5py.TravelTimeMatrix(
        transport_network,
        origins=origins,
        destinations=destinations,
        transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        departure=departure,
        departure_time_window=departure_time_window,
        percentiles=percentiles,
    )


def _matrix_with_offset(transport_network, origins, destinations, departure, duration, tract_offsets_minutes):
    matrix = _run_matrix(
        transport_network,
        origins=origins,
        destinations=destinations[["id", "geometry"]],
        departure=departure,
        departure_time_window=duration,
        percentiles=[50],
    )
    time_column = "travel_time" if "travel_time" in matrix.columns else "travel_time_p50"
    matrix = matrix.rename(columns={time_column: "travel_time"})
    matrix["travel_time"] = matrix["travel_time"] + matrix["from_id"].map(tract_offsets_minutes)
    return matrix


def _iter_od_matrices(
    transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes,
    window_names, time_windows,
):
    origins = tract_origins.rename(columns={"GEOID": "id"})[["id", "geometry"]]
    for window_name in window_names:
        window = time_windows[window_name]
        departure = datetime.datetime.combine(window["date"], window["start_time"])
        for sport_type, destinations in facilities_by_sport_type.items():
            matrix = _matrix_with_offset(
                transport_network, origins, destinations, departure, window["duration"], tract_offsets_minutes
            )
            yield window_name, sport_type, matrix


def compute_nearest_facility_times(
    transport_network,
    tract_origins: gpd.GeoDataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
    tract_offsets_minutes: dict[str, float],
    window_names: list[str] | None = None,
    time_windows: dict | None = None,
) -> pd.DataFrame:
    # time_windows defaults to config.TIME_WINDOWS (the original 4
    # already-checkpointed windows) so every existing caller is unaffected.
    # Pass config.EVENING_TIME_WINDOWS (+ matching window_names) to compute
    # the separate weekday-5pm/Saturday-5pm pair without touching those 4.
    time_windows = time_windows or config.TIME_WINDOWS
    window_names = window_names or list(time_windows)

    all_rows = []
    for window_name, sport_type, matrix in _iter_od_matrices(
        transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes,
        window_names, time_windows,
    ):
        nearest = matrix.groupby("from_id")["travel_time"].min().reset_index()
        nearest = nearest.rename(columns={"from_id": "GEOID", "travel_time": "travel_time_minutes"})
        nearest["sport_type"] = sport_type
        nearest["window_name"] = window_name
        all_rows.append(nearest)

    return pd.concat(all_rows, ignore_index=True)[
        ["GEOID", "sport_type", "window_name", "travel_time_minutes"]
    ]


def compute_nearest_facility_routes(
    transport_network,
    tract_origins: gpd.GeoDataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
    tract_offsets_minutes: dict[str, float],
    window_names: list[str] | None = None,
    time_windows: dict | None = None,
) -> pd.DataFrame:
    """Like compute_nearest_facility_times, but also keeps *which* facility
    was nearest (`nearest_facility_id`), not just the minimum time.

    compute_nearest_facility_times only needs the minimum travel time per
    tract (a scalar for the wide output tables), so it discards which
    destination produced it. Drawing a route line to "the nearest facility"
    needs that destination's id too, to look up its geometry -- see
    pipeline/routes.py.

    A tract can have a from_id group in the matrix that is entirely NaN
    (confirmed against a real run, 2026-09-14: contrary to this function's
    original assumption, r5py does not always omit an unreachable tract's
    rows outright -- at least one destination can still produce a NaN-valued
    row for it). `.min()` (used in compute_nearest_facility_times) tolerates
    an all-NaN group fine via skipna, silently returning NaN; `.idxmin()`
    does not -- it raises ValueError("... encountered all NA values in a
    group"). Dropping NaN rows first makes an all-unreachable tract have NO
    rows for that (sport_type, window) at all, matching
    compute_nearest_facility_times' documented "no row, not a NaN row"
    contract instead of crashing on it.
    """
    time_windows = time_windows or config.TIME_WINDOWS
    window_names = window_names or list(time_windows)

    all_rows = []
    for window_name, sport_type, matrix in _iter_od_matrices(
        transport_network, tract_origins, facilities_by_sport_type, tract_offsets_minutes,
        window_names, time_windows,
    ):
        matrix = matrix.dropna(subset=["travel_time"])
        if matrix.empty:
            continue
        nearest_idx = matrix.groupby("from_id")["travel_time"].idxmin()
        nearest = matrix.loc[nearest_idx, ["from_id", "to_id", "travel_time"]].rename(
            columns={"from_id": "GEOID", "to_id": "nearest_facility_id", "travel_time": "travel_time_minutes"}
        )
        nearest["sport_type"] = sport_type
        nearest["window_name"] = window_name
        all_rows.append(nearest)

    return pd.concat(all_rows, ignore_index=True)[
        ["GEOID", "sport_type", "window_name", "nearest_facility_id", "travel_time_minutes"]
    ]
