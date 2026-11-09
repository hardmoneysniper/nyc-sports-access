"""Add pct_poverty, pct_no_vehicle, senior_population, and pct_senior
columns to the existing nta_output.geojson.

Same retrofit pattern as add_youth_population.py and
add_median_household_income.py -- demographics.build_nta_demographics()
now also returns these four columns (added via ACS tables B17001 and
B25044, plus the senior brackets of the already-pulled B01001), but
nta_output.geojson was written before they existed. Per project owner
instruction, 2026-11-09 (narrowing the selectable demographic set down to
immigrant/foreign-born plus poverty, income, vehicle access, youth, and
seniors).
"""
import geopandas as gpd
from dotenv import load_dotenv

from pipeline import config, demographics, geography

load_dotenv()

NEW_COLUMNS = ["pct_poverty", "pct_no_vehicle", "senior_population", "pct_senior"]


def main():
    tracts = geography.load_census_tracts()
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    print("Fetching demographic data...")
    nta_demographics = demographics.build_nta_demographics(tract_to_nta)
    new_cols = nta_demographics[["NTA2020"] + NEW_COLUMNS]

    output_path = config.PROCESSED_DIR / "nta_output.geojson"
    nta = gpd.read_file(output_path)
    nta = nta.drop(columns=[c for c in NEW_COLUMNS if c in nta.columns])
    nta = nta.merge(new_cols, on="NTA2020", how="left")
    nta.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(nta)} NTAs, {', '.join(NEW_COLUMNS)} added)")


if __name__ == "__main__":
    main()
