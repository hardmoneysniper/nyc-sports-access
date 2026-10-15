"""One-off extraction of Elmhurst's (QN0401) single NTA-level outer boundary
polygon, for the methodology page's Travel Time tab -- the route-reveal
scene shows this single outer edge instead of each tract's own internal
boundary line. Not part of the regular data pipeline -- this is a single
illustrative worked example tied to one hardcoded neighborhood, so a
one-off script producing one small static file is simpler than wiring a
new pipeline stage (matches scripts/extract_elmhurst_roads.py's own
reasoning). Per project owner instruction, 2026-10-14 ("only show the
outer boundary of the nta").

Source: frontend/public/data/nta_boundaries.geojson (all 262 NTAs,
~5MB) -- this tab only ever needs Elmhurst's one feature out of it.
"""
import json
from pathlib import Path

SRC_PATH = Path("frontend/public/data/nta_boundaries.geojson")
OUT_PATH = Path("frontend/public/data/tracts/QN0401_boundary.geojson")
ELMHURST_ID = "QN0401"


def main() -> None:
    data = json.loads(SRC_PATH.read_text())
    feature = next(f for f in data["features"] if f["properties"]["NTA2020"] == ELMHURST_ID)
    out = {"type": "FeatureCollection", "features": [feature]}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
