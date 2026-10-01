"""Clean the raw USGS pulls, derive the country/region group and other columns, validate,
and write data/processed/earthquakes.csv."""
import json, re
from pathlib import Path
import numpy as np, pandas as pd, shapely
from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
RAW, LOOKUP, OUT = ROOT / "data" / "raw", ROOT / "data" / "lookup", ROOT / "data" / "processed"
TOP_MIN_EVENTS = 500        # regions with fewer events are pooled as "All other regions" in group_top
OFFSHORE_KM = 300           # geometry fallback: nearest country counts only within this distance

# Small, explicit fixes for USGS place names that do not match a Natural Earth name.
ALIAS_OVERRIDES = {
    "burma myanmar": "Myanmar", "mx": "Mexico", "timor leste": "Timor-Leste", "east timor": "Timor-Leste",
    "russia": "Russia", "us virgin islands": "U.S. Virgin Is.", "virgin islands": "U.S. Virgin Is.",
    "sumatra": "Indonesia", "java": "Indonesia", "sulawesi": "Indonesia", "halmahera": "Indonesia",
    "mindanao": "Philippines", "luzon": "Philippines", "kamchatka": "Russia",
    "wharton basin": "Indonesia", "palestinian territory": "Palestine", "reunion": "Reunion", "xizang": "China",
    "north island of new zealand": "New Zealand", "the north island of new zealand": "New Zealand",
    "south island of new zealand": "New Zealand",
}
FEATURE_RENAMES = {"Africa": "South of Africa"}   # "south of Africa" / "southwest of Africa" are ocean events
US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
    "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
    "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
    "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]
US_POSTAL = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower().replace(".", "").replace("-", " ").replace("&", "and")).strip()


def load_raw():
    rows = []
    for f in sorted(RAW.glob("eq_*.geojson")):
        for ft in json.loads(f.read_text())["features"]:
            p, (lon, lat, depth) = ft["properties"], ft["geometry"]["coordinates"]
            rows.append(dict(id=ft["id"], time=p["time"], lat=lat, lon=lon, depth=depth, mag=p["mag"],
                             magType=p["magType"], sig=p["sig"], tsunami=p["tsunami"], type=p["type"],
                             place=p["place"]))
    df = pd.DataFrame(rows)
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    return df


def build_alias(countries):
    alias = {}
    for f in countries:
        p = f["properties"]
        for k in ["NAME", "NAME_LONG", "FORMAL_EN", "ADMIN", "ABBREV", "NAME_SORT", "BRK_NAME"]:
            if p.get(k):
                alias[norm(p[k])] = p["NAME"]
    for s in US_STATES + US_POSTAL:
        alias[norm(s)] = "United States of America"
    alias.update({k: v for k, v in ALIAS_OVERRIDES.items()})
    return alias


ADJ = r"(northern|southern|eastern|western|central|northeastern|northwestern|southeastern|southwestern)"


def clean_feature(place):
    s = re.sub(r"^\d+ km [NSEW]+ of ", "", place)
    s = re.sub(r"^(off the (?:[a-z ]+ )?coast of|(north|south|east|west|northeast|northwest|southeast|southwest) of( the)?)\s+", "", s, flags=re.I)
    s = re.sub(r"^" + ADJ + r"\s+", "", s, flags=re.I)
    s = re.sub(r"\s+(region|earthquake)$", "", s.strip(), flags=re.I)
    s = s[:1].upper() + s[1:]
    return FEATURE_RENAMES.get(s, s)


def assign_group(place, alias):
    """Returns (group, method). method: place_suffix | named_event | place_feature_country | place_feature | geometry"""
    if re.match(r"^\d{4} ", place):                      # named events, e.g. "2004 Sumatra - Andaman Islands Earthquake"
        name = re.sub(r"\s+(earthquake|aftershock)$", "", re.sub(r"^\d{4} ", "", place), flags=re.I)
        hit = alias.get(norm(name.split(",")[-1].strip()))     # "2010 Maule, Chile" -> Chile
        return (hit, "named_event") if hit else (None, "geometry")
    m = re.search(r",\s*([^,]+)$", place)
    if m:
        sfx = re.sub(r"\s+(region|earthquake)$", "", m.group(1).strip(), flags=re.I)
        hit = alias.get(norm(sfx))
        return (hit, "place_suffix") if hit else (sfx, "place_suffix")
    c = clean_feature(place)
    hit = alias.get(norm(c)) or alias.get(norm(re.sub(r"\s+islands?$", "", c, flags=re.I)))
    return (hit, "place_feature_country") if hit else (c, "place_feature")


def geometry_lookup(df, countries, marine):
    """Country (land, else nearest within OFFSHORE_KM) or ocean-basin for every event."""
    cg = [shape(f["geometry"]) for f in countries]
    tree = STRtree(cg)
    pts = shapely.points(df.lon.values, df.lat.values)
    pair = tree.query(pts, predicate="within")
    idx = np.full(len(df), -1)
    idx[pair[0]] = pair[1]
    rest = np.where(idx < 0)[0]
    nn, dist = tree.query_nearest(pts[rest], return_distance=True, all_matches=False)
    near = np.full(len(df), -1)
    d = np.full(len(df), np.inf)
    near[rest[nn[0]]], d[rest[nn[0]]] = nn[1], dist * 111.0       # degrees -> km (approx.)
    idx = np.where(idx >= 0, idx, np.where(d <= OFFSHORE_KM, near, -1))
    mg = [shape(f["geometry"]) for f in marine]
    mt = STRtree(mg)
    ocean = np.where(idx < 0)[0]
    pair = mt.query(pts[ocean], predicate="within")
    mname = np.full(len(df), "", dtype=object)
    mname[ocean[pair[0]]] = [marine[i]["properties"]["name"] for i in pair[1]]
    return idx, mname


def basin(name, lon, lat):
    n = (name or "").lower()
    if lat < -60 or "southern" in n or "ross" in n: return "Southern/Arctic Ocean"
    if "arctic" in n or "laptev" in n or "baffin" in n or "davis" in n: return "Southern/Arctic Ocean"
    if any(k in n for k in ["pacific", "philippine", "okhotsk", "alaska", "tasman", "coral", "bering", "south china", "japan"]): return "Pacific Ocean"
    if any(k in n for k in ["atlantic", "sargasso", "greenland", "norwegian", "labrador", "north sea", "mexico"]): return "Atlantic Ocean"
    if any(k in n for k in ["indian", "arabian", "bengal", "mozambique", "australian"]): return "Indian Ocean"
    if -70 <= lon < 20: return "Atlantic Ocean"            # generic "open ocean" polygon: split by longitude
    if 20 <= lon < 147: return "Indian Ocean"
    return "Pacific Ocean"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_raw()
    n_raw = len(df)
    assert df.id.is_unique
    # --- filters
    df = df[(df.type == "earthquake") & (df.mag >= 4.5)].copy()
    n_removed_type = n_raw - len(df)
    df = df.sort_values("time").reset_index(drop=True)

    # --- cleaning
    n_neg_depth = int((df.depth < 0).sum())
    df["mag"] = df.mag.round(2)                       # USGS magnitudes carry at most 2 decimals (2 events had float noise)
    df["depth_km"] = df.depth.clip(lower=0).round(1)
    df["magType"] = df.magType.str.lower()
    df["mag_type_group"] = np.where(df.magType == "mb", "mb", np.where(df.magType.str.startswith("mw"), "Mw", "Other"))

    # --- derived columns
    df["year"], df["month"] = df.time.dt.year, df.time.dt.month
    df["mag_class"] = pd.cut(df.mag, [0, 5, 6, 7, 10], right=False, labels=["4.5-4.9", "5.0-5.9", "6.0-6.9", "7.0+"]).astype(str)
    df["depth_class"] = pd.cut(df.depth_km, [-1, 70, 300, 1000], right=False, labels=["Shallow (<70 km)", "Intermediate (70-300 km)", "Deep (>300 km)"]).astype(str)
    df["energy_j"] = 10 ** (1.5 * df.mag + 4.8)

    # --- country / region group
    countries = json.loads((LOOKUP / "ne_50m_admin_0_countries.geojson").read_text())["features"]
    marine = json.loads((LOOKUP / "ne_50m_geography_marine_polys.geojson").read_text())["features"]
    alias = build_alias(countries)
    res = [assign_group(p, alias) for p in df.place]
    df["country_region"], df["region_method"] = [r[0] for r in res], [r[1] for r in res]

    idx, mname = geometry_lookup(df, countries, marine)
    cont = np.array([f["properties"]["CONTINENT"] for f in countries])
    names = np.array([f["properties"]["NAME"] for f in countries])
    macro = np.where(idx >= 0, cont[np.maximum(idx, 0)], "")
    macro = np.where((macro == "Europe") & (df.lon.values >= 60) & (np.array([n == "Russia" for n in names[np.maximum(idx, 0)]])), "Asia", macro)
    macro = np.where(macro == "Seven seas (open ocean)", "", macro)
    ocean_idx = np.where(macro == "")[0]
    macro = macro.astype(object)
    for i in ocean_idx:
        macro[i] = basin(mname[i], df.lon.values[i], df.lat.values[i])
    df["macro_region"] = macro
    # named events with no usable place text: use the polygon country, else the ocean basin
    g = df.region_method == "geometry"
    geo_country = np.where(idx >= 0, names[np.maximum(idx, 0)], None)
    df.loc[g, "country_region"] = [gc if gc else m for gc, m in zip(geo_country[g], df.macro_region[g])]

    vc = df.country_region.value_counts()
    top = set(vc[vc >= TOP_MIN_EVENTS].index)
    df["country_region_top"] = np.where(df.country_region.isin(top), df.country_region, "All other regions")
    df["url"] = "https://earthquake.usgs.gov/earthquakes/eventpage/" + df.id

    cols = ["id", "time", "year", "month", "lat", "lon", "depth_km", "depth_class", "mag", "mag_class", "magType",
            "mag_type_group", "sig", "tsunami", "energy_j", "place", "country_region", "country_region_top",
            "region_method", "macro_region", "url"]
    out = df[cols].rename(columns={"time": "time_utc", "lat": "latitude", "lon": "longitude", "magType": "mag_type"})
    out["time_utc"] = out.time_utc.dt.strftime("%Y-%m-%d %H:%M:%S")

    # --- validation
    assert out.id.is_unique and out.country_region.notna().all() and (out.country_region != "").all()
    assert out.macro_region.notna().all() and out.year.between(1990, 2025).all() and out.year.nunique() == 36
    assert out.isna().sum()[["mag", "depth_km", "sig", "tsunami", "latitude", "longitude"]].sum() == 0
    out.to_csv(OUT / "earthquakes.csv", index=False)
    (OUT / "build_info.json").write_text(json.dumps(dict(
        raw_rows=n_raw, removed_non_earthquake_or_below_4_5=n_removed_type, final_rows=len(out),
        negative_depth_clipped_to_zero=n_neg_depth, top_min_events=TOP_MIN_EVENTS, offshore_km=OFFSHORE_KM,
        pulled=json.loads((RAW / "pull_info.json").read_text())["pulled"]), indent=1))
    print(open(OUT / "build_info.json").read())


if __name__ == "__main__":
    main()
