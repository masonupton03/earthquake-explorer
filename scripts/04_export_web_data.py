"""Export the cleaned dataset to compact files for the static website (docs/data/)."""
import json, shutil
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PROC, WEB = ROOT / "data" / "processed", ROOT / "docs" / "data"
WEB.mkdir(parents=True, exist_ok=True)

d = pd.read_csv(PROC / "earthquakes.csv")
d["time_utc"] = pd.to_datetime(d.time_utc, utc=True)
d = d.sort_values("time_utc", kind="stable").reset_index(drop=True)

regions = [r for r in d.country_region_top.value_counts().index if r != "All other regions"] + ["All other regions"]
macros = list(d.macro_region.value_counts().index)
mtypes = ["mb", "Mw", "Other"]
mclasses = ["4.5-4.9", "5.0-5.9", "6.0-6.9", "7.0+"]
dclasses = ["Shallow (<70 km)", "Intermediate (70-300 km)", "Deep (>300 km)"]
idx = lambda s, names: s.map({n: i for i, n in enumerate(names)}).astype(int)

epoch0 = pd.Timestamp("1990-01-01", tz="UTC")
cols = [  # name, numpy dtype, values, scale (stored = round(value * scale))
    ("t", "<i4", ((d.time_utc - epoch0).dt.total_seconds()).round(), 1),
    ("lat", "<i2", d.latitude, 100), ("lon", "<i2", d.longitude, 100),
    ("depth", "<u2", d.depth_km, 10), ("mag", "<u2", d.mag, 100), ("sig", "<u2", d.sig, 1),
    ("region", "u1", idx(d.country_region_top, regions), 1), ("macro", "u1", idx(d.macro_region, macros), 1),
    ("mtype", "u1", idx(d.mag_type_group, mtypes), 1), ("tsu", "u1", d.tsunami, 1),
    ("year", "u1", d.year - 1990, 1), ("month", "u1", d.month, 1),
]
buf, meta_cols, off = bytearray(), [], 0
for name, dt, vals, scale in cols:
    arr = np.round(np.asarray(vals, dtype="float64") * scale).astype(dt)
    assert np.allclose(arr / scale, np.asarray(vals, dtype="float64"), atol=0.5 / scale + 1e-9), name
    pad = (-len(buf)) % 4
    buf += b"\0" * pad
    meta_cols.append(dict(name=name, dtype=dt, offset=len(buf), scale=scale))
    buf += arr.tobytes()
(WEB / "quakes.bin").write_bytes(bytes(buf))
(WEB / "meta.json").write_text(json.dumps(dict(
    n=len(d), epoch0="1990-01-01T00:00:00Z", columns=meta_cols, regions=regions, macros=macros, mtypes=mtypes,
    mclasses=mclasses, dclasses=dclasses, pulled=json.loads((PROC / "build_info.json").read_text())["pulled"])))
rf_names = list(d.country_region.value_counts().index)          # full 389-value group, for the table / CSV export
(WEB / "details.json").write_text(json.dumps(dict(
    id=d.id.tolist(), place=d.place.tolist(), rf=idx(d.country_region, rf_names).tolist(), rf_names=rf_names), separators=(",", ":")))

stats = json.loads((PROC / "report_stats.json").read_text())
(WEB / "report_stats.json").write_text(json.dumps(stats, separators=(",", ":")))
print({p.name: round(p.stat().st_size / 1e6, 2) for p in WEB.iterdir()}, "MB")
