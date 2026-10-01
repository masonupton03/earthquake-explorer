"""Download M4.5+ earthquakes 1990-2025 from the USGS FDSN API, one year per request,
and download the Natural Earth lookup files. Safe to re-run (skips files that exist)."""
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW, LOOKUP = ROOT / "data" / "raw", ROOT / "data" / "lookup"
API = "https://earthquake.usgs.gov/fdsnws/event/1"
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
YEARS, MIN_MAG = range(1990, 2026), 4.5   # end date is exclusive: Jan 1 of the next year


def get(url, params=None):
    r = requests.get(url, params=params, timeout=120)
    r.raise_for_status()
    return r


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    LOOKUP.mkdir(parents=True, exist_ok=True)
    total = 0
    for y in YEARS:
        q = dict(starttime=f"{y}-01-01", endtime=f"{y + 1}-01-01", minmagnitude=MIN_MAG)
        expected = int(get(f"{API}/count", q).text)
        f = RAW / f"eq_{y}.geojson"
        if not f.exists():
            r = get(f"{API}/query", dict(q, format="geojson", orderby="time-asc", limit=20000))
            f.write_bytes(r.content)
        got = len(json.loads(f.read_text())["features"])
        assert got == expected, f"{y}: API count {expected} != downloaded {got}"
        total += got
        print(y, got)
    print("total downloaded:", total)
    for name in ["ne_50m_admin_0_countries", "ne_50m_geography_marine_polys"]:
        f = LOOKUP / f"{name}.geojson"
        if not f.exists():
            f.write_bytes(get(f"{NE}/{name}.geojson").content)
    (RAW / "pull_info.json").write_text(json.dumps(
        {"min_magnitude": MIN_MAG, "years": [YEARS[0], YEARS[-1]], "downloaded_rows": total,
         "pulled": __import__("datetime").date.today().isoformat()}))


if __name__ == "__main__":
    main()
