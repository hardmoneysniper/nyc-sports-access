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


def compute_nearest_facility_times(
    transport_network,
    tract_origins: gpd.GeoDataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
    tract_offsets_minutes: dict[str, float],
    window_names: list[str] | None = None,
) -> pd.DataFrame:
    window_names = window_names or list(config.TIME_WINDOWS)
    origins = tract_origins.rename(columns={"GEOID": "id"})[["id", "geometry"]]

    all_rows = []
    for window_name in window_names:
        window = config.TIME_WINDOWS[window_name]
        departure = datetime.datetime.combine(window["date"], window["start_time"])

        for sport_type, destinations in facilities_by_sport_type.items():
            matrix = _run_matrix(
                transport_network,
                origins=origins,
                destinations=destinations[["id", "geometry"]],
                departure=departure,
                departure_time_window=window["duration"],
                percentiles=[50],
            )
            time_column = "travel_time" if "travel_time" in matrix.columns else "travel_time_p50"
            matrix = matrix.rename(columns={time_column: "travel_time"})
            matrix["travel_time"] = matrix["travel_time"] + matrix["from_id"].map(tract_offsets_minutes)

            nearest = matrix.groupby("from_id")["travel_time"].min().reset_index()
            nearest = nearest.rename(columns={"from_id": "GEOID", "travel_time": "travel_time_minutes"})
            nearest["sport_type"] = sport_type
            nearest["window_name"] = window_name
            all_rows.append(nearest)

    return pd.concat(all_rows, ignore_index=True)[
        ["GEOID", "sport_type", "window_name", "travel_time_minutes"]
    ]
