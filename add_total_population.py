"""Add a total_population column to the existing nta_output.geojson.

demographics.build_nta_demographics() now returns total_population
alongside the pct_* columns, but nta_output.geojson was written before
that column existed. Re-running the full pipeline just to pick up one new
column would mean rebuilding the r5py transport network (several minutes)
for no reason -- this script instead re-fetches only the ACS demographic
data (a handful of Census API calls) and merges total_population into the
already-written output in place.
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
    population = nta_demographics[["NTA2020", "total_population"]]

    output_path = config.PROCESSED_DIR / "nta_output.geojson"
    nta = gpd.read_file(output_path)
    if "total_population" in nta.columns:
        nta = nta.drop(columns=["total_population"])
    nta = nta.merge(population, on="NTA2020", how="left")
    nta.to_file(output_path, driver="GeoJSON")
    print(f"Wrote {output_path} ({len(nta)} NTAs, total_population added)")


if __name__ == "__main__":
    main()
