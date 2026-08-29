import pytest
from pipeline import geography


def test_load_nta_boundaries_has_expected_shape():
    ntas = geography.load_nta_boundaries()
    assert len(ntas) == 262
    assert {"NTA2020", "NTAName", "geometry"}.issubset(ntas.columns)
    assert ntas.crs.to_string() == "EPSG:2263"


def test_load_census_tracts_has_expected_shape():
    tracts = geography.load_census_tracts()
    assert len(tracts) == 2325
    assert {"GEOID", "NTA2020", "geometry"}.issubset(tracts.columns)
    assert tracts.crs.to_string() == "EPSG:2263"


def test_validate_tract_nta_join_passes_on_real_data():
    tracts = geography.load_census_tracts()
    ntas = geography.load_nta_boundaries()
    geography.validate_tract_nta_join(tracts, ntas)  # must not raise


def test_validate_tract_nta_join_raises_on_orphan_tract():
    tracts = geography.load_census_tracts().copy()
    ntas = geography.load_nta_boundaries()
    tracts.loc[tracts.index[0], "NTA2020"] = "NOT_A_REAL_NTA_CODE"
    with pytest.raises(ValueError, match="NOT_A_REAL_NTA_CODE"):
        geography.validate_tract_nta_join(tracts, ntas)
