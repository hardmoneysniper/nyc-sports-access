"""One-time setup shared by run_pipeline.py and run_pipeline_batched.py.

Both entry points need the same expensive one-time preparation (geography,
tract origins/offsets, demographics, facility filtering, network build)
before they diverge on how they drive travel_time.compute_nearest_facility_times.
Pulling it out here means the two entry points can't silently drift apart on
setup while still doing whatever they each want with the *travel-time*
computation.
"""
from dataclasses import dataclass

import geopandas as gpd
import pandas as pd

from pipeline import (
    census_client,
    config,
    demographics,
    facilities,
    geography,
    network_acquisition,
    offsets,
    travel_time,
)


@dataclass
class PipelineSetup:
    tracts: gpd.GeoDataFrame
    ntas: gpd.GeoDataFrame
    tract_to_nta: pd.DataFrame
    tract_origins: gpd.GeoDataFrame
    tract_offsets: dict
    nta_demographics: pd.DataFrame
    tract_population: pd.Series
    facilities_by_sport_type: dict
    network: object


def run_setup() -> PipelineSetup:
    network_acquisition.validate_network_files_exist()
    network_acquisition.validate_reference_dates()

    print("Loading geography...")
    tracts = geography.load_census_tracts()
    ntas = geography.load_nta_boundaries()
    geography.validate_tract_nta_join(tracts, ntas)
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    print("Computing tract origin points and intra-tract offsets...")
    # Origin point and offset are computed once in the projected (feet-based)
    # CRS, since compute_walking_offset_minutes assumes feet. The same point
    # geometry is then reprojected (not recomputed) to WGS84 for r5py, so the
    # routing origin and the offset calculation always agree on one point.
    tracts["origin_point"] = tracts.geometry.apply(offsets.compute_origin_point)
    tract_offsets = {
        row.GEOID: offsets.compute_walking_offset_minutes(row.geometry, row.origin_point)
        for row in tracts.itertuples()
    }
    origin_points_geo = gpd.GeoSeries(tracts["origin_point"], crs=config.CRS_PROJECTED).to_crs(
        config.CRS_GEOGRAPHIC
    )
    tract_origins = gpd.GeoDataFrame(
        {"GEOID": tracts["GEOID"], "geometry": origin_points_geo}, crs=config.CRS_GEOGRAPHIC
    )

    print("Fetching demographic data...")
    nta_demographics = demographics.build_nta_demographics(tract_to_nta)
    tract_population = census_client.fetch_acs_group("B02001")
    tract_population = (
        tract_population[tract_population["variable"].str.endswith("_001E")]
        .set_index("GEOID")["estimate"]
    )

    print("Loading and filtering athletic facilities...")
    # Task 9's real smoke-run found two real bugs preparing facility data for
    # r5py: (1) the shapefile's `gispropnum` identifies the parent park/property,
    # not the individual facility, so it is NOT unique per row (r5py requires
    # unique destination ids) -- the GeoDataFrame's own row index is unique and
    # used instead; (2) facility geometries are Polygon/MultiPolygon (court/field
    # footprints), but r5py requires Point geometry for origins and destinations
    # -- converted via representative_point(), mirroring the tract-origin pattern
    # above.
    active_facilities = facilities.load_active_facilities()
    facilities_by_sport_type = {
        sport: facilities.facilities_for_sport_type(active_facilities, sport).assign(
            id=lambda df: df.index.astype(str),
            geometry=lambda df: df.geometry.representative_point(),
        )
        for sport in config.SPORT_TYPE_COLUMNS
    }

    print("Building r5py transport network (this can take several minutes)...")
    network = travel_time.build_transport_network()

    return PipelineSetup(
        tracts=tracts,
        ntas=ntas,
        tract_to_nta=tract_to_nta,
        tract_origins=tract_origins,
        tract_offsets=tract_offsets,
        nta_demographics=nta_demographics,
        tract_population=tract_population,
        facilities_by_sport_type=facilities_by_sport_type,
        network=network,
    )
