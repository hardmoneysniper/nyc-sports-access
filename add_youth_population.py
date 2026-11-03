"""Add youth_population and pct_youth columns to the existing
nta_output.geojson. Same retrofit pattern as add_total_population.py and
add_median_household_income.py -- demographics.build_nta_demographics()
now also returns these two columns (added via ACS table B01001, Sex by
Age), but nta_output.geojson was written before they existed.
"""
import geopandas as gpd
from dotenv import load_dotenv

from pipeline import config, demographics, geography

load_dotenv()


def main():
    tracts = geography.load_census_tracts()
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    print("Fetching demographic data...")
    nta_demographics = demographics.build_nta_demographics(tract_to_nta)
    youth = nta_demographics[["NTA2020", "youth_population", "pct_youth"]]

    output_path = config.PROCESSED_DIR / "nta_output.geojson"
    nta = gpd.read_file(output_path)
    nta = nta.drop(columns=[c for c in ["youth_population", "pct_youth"] if c in nta.columns])
    nta = nta.merge(youth, on="NTA2020", how="left")
    nta.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(nta)} NTAs, youth_population/pct_youth added)")


if __name__ == "__main__":
    main()
