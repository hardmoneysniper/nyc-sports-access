"""Loading and validating the NTA and census tract boundary shapefiles."""
import geopandas as gpd

from pipeline import config

NTA_SHAPEFILE = "data/nynta2020_26c/nynta2020_26c/nynta2020.shp"
TRACT_SHAPEFILE = "data/nyct2020_26c/nyct2020.shp"


def load_nta_boundaries() -> gpd.GeoDataFrame:
    ntas = gpd.read_file(NTA_SHAPEFILE)
    return ntas.to_crs(config.CRS_PROJECTED)


def load_census_tracts() -> gpd.GeoDataFrame:
    tracts = gpd.read_file(TRACT_SHAPEFILE)
    return tracts.to_crs(config.CRS_PROJECTED)


def validate_tract_nta_join(tracts: gpd.GeoDataFrame, ntas: gpd.GeoDataFrame) -> None:
    valid_nta_codes = set(ntas["NTA2020"])
    tract_nta_codes = tracts["NTA2020"]
    if tract_nta_codes.isna().any():
        missing_geoids = tracts.loc[tract_nta_codes.isna(), "GEOID"].tolist()
        raise ValueError(f"Tracts with missing NTA2020: {missing_geoids}")
    orphans = set(tract_nta_codes) - valid_nta_codes
    if orphans:
        raise ValueError(f"Tract NTA2020 codes not found in NTA layer: {orphans}")
