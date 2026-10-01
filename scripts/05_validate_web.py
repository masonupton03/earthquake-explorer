"""Check that the website's JavaScript (docs/js/data.js reading docs/data/quakes.bin) gives exactly the same
summary numbers as pandas on earthquakes.csv, for a set of filter combinations. Needs Node.js."""
import json, subprocess, tempfile
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
d = pd.read_csv(ROOT / "data" / "processed" / "earthquakes.csv")
with tempfile.TemporaryDirectory() as tmp:
    out_file = Path(tmp) / "js.json"
    subprocess.run(["node", str(ROOT / "tests" / "web_aggregates.js"), str(out_file)], check=True)
    J = json.loads(out_file.read_text())

MT, MC = ["mb", "Mw", "Other"], ["4.5-4.9", "5.0-5.9", "6.0-6.9", "7.0+"]
DC = ["Shallow (<70 km)", "Intermediate (70-300 km)", "Deep (>300 km)"]
failures = 0
for name, c in J["cases"].items():
    m = d.year.between(c.get("y0", 1990), c.get("y1", 2025))
    if "region" in c: m &= d.country_region_top.isin(c["region"])
    if "macro" in c: m &= d.macro_region.isin(c["macro"])
    if "dclass" in c: m &= d.depth_class.isin([DC[i] for i in c["dclass"]])
    if "mclass" in c: m &= d.mag_class.isin([MC[i] for i in c["mclass"]])
    if "mtype" in c: m &= d.mag_type_group.isin([MT[i] for i in c["mtype"]])
    if "tsu" in c: m &= d.tsunami == int(c["tsu"])
    x, o = d[m], J["out"][name]
    expected = dict(n=len(x), m6=int((x.mag >= 6).sum()), avgMag=x.mag.mean(), medMag=x.mag.median(), medDepth=x.depth_km.median(),
                    energy=x.energy_j.sum(), flagged=int(x.tsunami.sum()), maxMag=x.mag.max())
    ok = all(o[k] is not None and abs(o[k] - v) <= 1e-6 * max(1, abs(v)) for k, v in expected.items())
    top = x.groupby("country_region_top").energy_j.sum().sort_values(ascending=False).head(3).index.tolist()
    ok &= top == o["regionEnergyTop"]
    print(f"{name:12s} rows={len(x):7d}  {'OK' if ok else 'FAIL'}")
    failures += not ok
assert failures == 0, f"{failures} case(s) differ between the website logic and pandas"
print("All cases match.")
