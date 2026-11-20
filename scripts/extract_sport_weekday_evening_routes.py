"""Pre-filters every NTA's route export down to weekday_evening, split into
one file per display-level sport (config.SPORT_TYPE_GROUPS) -- the only
window NtaRouteDetail.tsx renders (frontend/components/explore/
NtaRouteDetail.tsx), one sport at a time as the user selects it -- instead
of shipping the raw per-NTA files (every sport x both time windows x every
route option, tens of KB to >8MB each) which aren't committed to git (see
frontend/.gitignore). Each raw per-NTA file is read once and split into all
21 sport outputs in the same pass, rather than re-reading it per sport.
NTAs with no routes for a given sport get no file for it at all -- the
frontend's readData() already treats a 404 there as "no routes" (passing
allowMissing=true), same as it does for an NTA missing route data entirely.

Supersedes extract_soccer_weekday_evening_routes.py (soccer only), which
itself superseded extract_elmhurst_soccer_routes.py (soccer + Elmhurst
only). Widened to every sport per project owner instruction, 2026-11-19,
after a teammate found only soccer's routes had been committed.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline import config  # noqa: E402

WINDOW = "weekday_evening"
ROUTES_DIR = Path("frontend/public/data/routes")

# raw sport_type -> the one display-level group it belongs to (every raw
# column appears in exactly one group -- see pipeline.config.SPORT_TYPE_GROUPS).
RAW_TO_DISPLAY = {raw: display for display, raws in config.SPORT_TYPE_GROUPS.items() for raw in raws}


def round_coords(geom):
    # Some NTAs' transit segments are MultiLineString, not just LineString.
    if geom["type"] == "MultiLineString":
        geom["coordinates"] = [[[round(lon, 6), round(lat, 6)] for lon, lat in line] for line in geom["coordinates"]]
    else:
        geom["coordinates"] = [[round(lon, 6), round(lat, 6)] for lon, lat in geom["coordinates"]]
    return geom


def main() -> None:
    # Raw per-NTA exports have no underscore in their stem (e.g.
    # "QN0401.geojson"); already-filtered output does ("QN0401_soccer_
    # weekday_evening.geojson") -- excluding those keeps re-runs idempotent.
    raw_files = sorted(f for f in ROUTES_DIR.glob("*.geojson") if "_" not in f.stem)
    for src in raw_files:
        data = json.loads(src.read_text())
        by_sport: dict[str, list] = {display: [] for display in config.SPORT_TYPE_GROUPS}
        for feature in data["features"]:
            props = feature["properties"]
            if props.get("window_name") != WINDOW:
                continue
            display = RAW_TO_DISPLAY.get(props.get("sport_type"))
            if display is None:
                continue
            by_sport[display].append({**feature, "geometry": round_coords(feature["geometry"])})
        written = 0
        for display, features in by_sport.items():
            if not features:
                continue
            out = ROUTES_DIR / f"{src.stem}_{display}_{WINDOW}.geojson"
            out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
            written += 1
        total = sum(len(v) for v in by_sport.values())
        print(f"{src.name} ({len(data['features'])} features) -> {written} sport files ({total} features total)")


if __name__ == "__main__":
    main()
