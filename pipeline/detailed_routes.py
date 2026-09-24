"""Real transit-path geometry for already-known nearest-facility pairs.

Unlike r5py.TravelTimeMatrix (used everywhere else in this pipeline -- see
pipeline/travel_time.py), which computes an entire many-to-many matrix via
one profile-routing sweep per origin, r5py.DetailedItineraries runs one full
point-to-point trip search per OD pair (r5py's own source,
r5/detailed_itineraries.py, loops `for _, (from_id, to_id) in
self.od_pairs.iterrows()`). It's the only r5py API that returns actual path
geometry -- which streets are walked, which transit routes are ridden -- but
its cost scales with the number of OD pairs requested, not with origin
count, and is expected to be substantially slower per unit than the batched
matrix approach used to find the nearest facility in the first place.

This module is therefore deliberately scoped to route ONLY the
already-known nearest-facility pairs (one destination per
tract/sport_type/window, from travel_time.compute_nearest_facility_routes'
output) via one-to-one routing, never an all-to-all matrix.

Two non-obvious correctness details, both confirmed against r5py 1.1.7's
actual source rather than assumed from the docs:

1. r5py.DetailedItineraries does NOT sort its route alternatives
   ("options") by travel time. TripPlanner.trips returns `direct_paths +
   transit_paths`: a direct walk-the-whole-way option is unconditionally
   listed first whenever WALK is a requested transport mode (regardless of
   whether it's actually faster), and the transit alternatives after it are
   in McRaptorSuboptimalPathProfileRouter's discovery order, not
   time-sorted. "Option 0" is therefore not reliably the fastest route --
   see _select_fastest_option below.

2. r5py.DetailedItineraries' one-to-one mode filters each OD pair by *id
   value*, not row position (`self.destinations[self.destinations.id ==
   to_id]`, then `.geometry.item()`). Many tracts routing to the same few
   facilities (e.g. only 9 active netball facilities citywide) means the
   same facility id would appear on multiple destination rows in one batch
   call; `.item()` requires exactly one match and raises otherwise. Working
   around this needs each row's origin/destination id to be unique *within
   that call*, not the real GEOID/facility id -- see the synthetic
   `route_ordinal` id in compute_nearest_facility_paths below.
"""
import datetime

import geopandas as gpd
import pandas as pd

from pipeline import config

DETAILED_ROUTE_COLUMNS = [
    "GEOID", "nearest_facility_id", "sport_type", "window_name", "option", "segment",
    "transport_mode", "departure_time", "distance", "travel_time", "wait_time",
    "feed", "agency_id", "route_id", "start_stop_id", "end_stop_id", "geometry",
]


def _run_detailed_itineraries(transport_network, origins, destinations, departure, departure_time_window):
    import r5py  # imported lazily so unit tests don't require a JVM

    return r5py.DetailedItineraries(
        transport_network,
        origins=origins,
        destinations=destinations,
        force_all_to_all=False,
        transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        departure=departure,
        departure_time_window=departure_time_window,
    )


def _select_fastest_option(itineraries: pd.DataFrame) -> pd.DataFrame:
    """Keep only the minimum-total-travel-time option per (from_id, to_id).

    See this module's docstring point 1: option order is discovery order,
    not time order, so this cannot just take option 0.
    """
    option_totals = (
        itineraries.groupby(["from_id", "to_id", "option"])["travel_time"]
        .sum()
        .reset_index()
    )
    best_option_idx = option_totals.groupby(["from_id", "to_id"])["travel_time"].idxmin()
    best_option = option_totals.loc[best_option_idx, ["from_id", "to_id", "option"]]
    return itineraries.merge(best_option, on=["from_id", "to_id", "option"], how="inner")


def compute_nearest_facility_paths(
    transport_network,
    nearest_routes: pd.DataFrame,
    tract_origins: gpd.GeoDataFrame,
    facilities_by_sport_type: dict[str, gpd.GeoDataFrame],
    time_windows: dict | None = None,
    detailed_itineraries_fn=None,
) -> gpd.GeoDataFrame:
    """Compute real route-segment geometry for each row of ``nearest_routes``.

    nearest_routes: GEOID, sport_type, window_name, nearest_facility_id,
    travel_time_minutes -- travel_time.compute_nearest_facility_routes'
    output (e.g. read back from a checkpoint directory). Routed one-to-one:
    row i's origin is that row's tract, row i's destination is that row's
    already-known nearest facility -- this function never asks r5py for an
    all-to-all matrix.

    Grouped by (sport_type, window_name): each needs its own departure time,
    and facility ids are only meaningful within their own sport type's
    facilities GeoDataFrame (see pipeline/routes.py for the same rule
    applied to desire lines).
    """
    time_windows = time_windows or config.TIME_WINDOWS
    detailed_itineraries_fn = detailed_itineraries_fn or _run_detailed_itineraries
    origin_points = tract_origins.set_index("GEOID")["geometry"]

    pieces = []
    for (sport_type, window_name), group in nearest_routes.groupby(["sport_type", "window_name"]):
        window = time_windows[window_name]
        departure = datetime.datetime.combine(window["date"], window["start_time"])

        group = group.reset_index(drop=True)
        # Synthetic per-row ordinal id, NOT the real GEOID/facility id: see
        # this module's docstring point 2. Origins and destinations share
        # the same ordinal sequence so r5py's one-to-one pairing lines row i
        # of origins up with row i of destinations.
        route_ordinal = group.index.astype(str)

        dest_geometry = facilities_by_sport_type[sport_type].set_index("id")["geometry"]
        origins = gpd.GeoDataFrame(
            {"id": route_ordinal, "geometry": origin_points.loc[group["GEOID"]].values},
            crs=config.CRS_GEOGRAPHIC,
        )
        destinations = gpd.GeoDataFrame(
            {"id": route_ordinal, "geometry": dest_geometry.loc[group["nearest_facility_id"]].values},
            crs=config.CRS_GEOGRAPHIC,
        )

        itineraries = pd.DataFrame(
            detailed_itineraries_fn(transport_network, origins, destinations, departure, window["duration"])
        )
        best = _select_fastest_option(itineraries)

        # Map the synthetic ordinal id (shared by from_id/to_id, since it's
        # a one-to-one pairing) back to this route's real GEOID/facility id.
        best["route_ordinal"] = best["from_id"].astype(int)
        best = best.merge(
            group[["GEOID", "nearest_facility_id"]].reset_index().rename(columns={"index": "route_ordinal"}),
            on="route_ordinal",
            how="left",
        )
        best["sport_type"] = sport_type
        best["window_name"] = window_name
        pieces.append(best)

    result = pd.concat(pieces, ignore_index=True)
    # r5py returns travel_time/wait_time as datetime.timedelta (pandas
    # stores this as timedelta64), which pyogrio's GeoJSON writer cannot
    # serialize at all (NotImplementedError, confirmed against a real run --
    # every checkpoint write would crash after the slow routing work is
    # already done). Converted to plain seconds (float) here, the single
    # producer of this GeoDataFrame, so every caller that writes it to disk
    # (per-sport-type checkpoints and the final combined file) is safe.
    result["travel_time"] = result["travel_time"].dt.total_seconds()
    result["wait_time"] = result["wait_time"].dt.total_seconds()
    return gpd.GeoDataFrame(result[DETAILED_ROUTE_COLUMNS], geometry="geometry", crs=config.CRS_GEOGRAPHIC)


def write_detailed_routes_geojson(routes: gpd.GeoDataFrame, output_path) -> None:
    routes.to_file(output_path, driver="GeoJSON")
