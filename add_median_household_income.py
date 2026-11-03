"""Add a median_household_income column to the existing nta_output.geojson.

Same retrofit pattern as add_total_population.py: re-fetches only the one
new ACS table (B19001, via pipeline/income.py) and merges it into the
already-written output in place, instead of re-running the full pipeline
(which would mean rebuilding the r5py transport network for no reason).
"""
import geopandas as gpd
from dotenv import load_dotenv

from pipeline import config, geography, income

load_dotenv()


def main():
    tracts = geography.load_census_tracts()
    tract_to_nta = tracts[["GEOID", "NTA2020"]]

    print("Fetching household income data...")
    nta_income = income.build_nta_median_household_income(tract_to_nta)

    output_path = config.PROCESSED_DIR / "nta_output.geojson"
    nta = gpd.read_file(output_path)
    if "median_household_income" in nta.columns:
        nta = nta.drop(columns=["median_household_income"])
    nta = nta.merge(nta_income, on="NTA2020", how="left")
    nta.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(nta)} NTAs, median_household_income added)")


if __name__ == "__main__":
    main()
