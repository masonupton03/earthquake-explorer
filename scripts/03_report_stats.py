"""Compute every number used on the report page and save to data/processed/report_stats.json."""
import json
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "processed"
d = pd.read_csv(OUT / "earthquakes.csv")
N = len(d)
r = lambda x, k=3: round(float(x), k)
S = {}

# 1. Year-to-year variation
yr = d.groupby("year").size()
big = d[d.mag >= 6].groupby("year").size().reindex(range(1990, 2026), fill_value=0)
S["f1_yearly"] = dict(
    counts={int(k): int(v) for k, v in yr.items()}, m6plus={int(k): int(v) for k, v in big.items()},
    mean=r(yr.mean(), 1), min_year=int(yr.idxmin()), min=int(yr.min()), max_year=int(yr.idxmax()), max=int(yr.max()),
    cv=r(yr.std() / yr.mean()), max_over_min=r(yr.max() / yr.min(), 2),
    avg_1990_2003=r(yr.loc[1990:2003].mean(), 0), avg_2004_2025=r(yr.loc[2004:2025].mean(), 0),
    m6plus_mean=r(big.mean(), 1), m6plus_min=int(big.min()), m6plus_max=int(big.max()), m6plus_cv=r(big.std() / big.mean()))

def region_year(name, y):
    return int(((d.country_region == name) & (d.year == y)).sum())
S["f1_yearly"]["context"] = dict(
    japan_2011=region_year("Japan", 2011), japan_avg_per_year=r((d.country_region == "Japan").sum() / 36, 0),
    indonesia_2004=region_year("Indonesia", 2004), indonesia_2005=region_year("Indonesia", 2005),
    indonesia_avg_per_year=r((d.country_region == "Indonesia").sum() / 36, 0),
    m5plus_1990_2003=r(d[(d.mag >= 5) & (d.year <= 2003)].groupby("year").size().mean(), 0),
    m5plus_2004_2025=r(d[(d.mag >= 5) & (d.year >= 2004)].groupby("year").size().mean(), 0))

# 2. Large vs small earthquakes
mc = d.mag_class.value_counts().reindex(["4.5-4.9", "5.0-5.9", "6.0-6.9", "7.0+"])
m = d.mag.values
b = np.log10(np.e) / (m.mean() - (4.5 - 0.05))        # Aki maximum-likelihood b-value, 0.1 magnitude bins
S["f2_magnitude"] = dict(
    counts={k: int(v) for k, v in mc.items()}, share={k: r(v / N * 100, 2) for k, v in mc.items()},
    m6plus=int((m >= 6).sum()), m6plus_share=r((m >= 6).mean() * 100, 2), m7plus=int((m >= 7).sum()),
    m8plus=int((m >= 8).sum()), m7plus_per_year=r((m >= 7).sum() / 36, 1), m6plus_per_year=r((m >= 6).sum() / 36, 1),
    ratio_small_to_m7=r(mc.iloc[:2].sum() / mc.iloc[3], 0), b_value=r(b, 2),
    per_0_1_bin={f"{x:.1f}": int(((m >= x - 1e-9) & (m < x + 0.1 - 1e-9)).sum()) for x in np.arange(4.5, 9.2, 0.1)})

# 3. Geographic concentration
cr = d.country_region.value_counts()
cum = cr.cumsum() / N
S["f3_concentration"] = dict(
    n_regions=int(len(cr)), top15=[dict(region=k, events=int(v), share=r(v / N * 100, 2)) for k, v in cr.head(15).items()],
    top5_share=r(cr.head(5).sum() / N * 100, 1), top10_share=r(cr.head(10).sum() / N * 100, 1),
    top20_share=r(cr.head(20).sum() / N * 100, 1), regions_for_50pct=int((cum < 0.5).sum() + 1),
    regions_for_80pct=int((cum < 0.8).sum() + 1), regions_with_500plus=int((cr >= 500).sum()),
    regions_with_under_100=int((cr < 100).sum()), median_events_per_region=int(cr.median()),
    macro_region={k: dict(events=int(v), share=r(v / N * 100, 1)) for k, v in d.macro_region.value_counts().items()})

# 4. Event count vs energy by region
g = d.groupby("country_region").agg(events=("id", "size"), energy=("energy_j", "sum"), max_mag=("mag", "max"))
g["energy_share"] = g.energy / g.energy.sum() * 100
g["event_share"] = g.events / N * 100
g["count_rank"] = g.events.rank(ascending=False, method="first").astype(int)
g["energy_rank"] = g.energy.rank(ascending=False, method="first").astype(int)
big_g = g[g.events >= 100]
rho = spearmanr(big_g.events, big_g.energy)[0]
t = g.sort_values("energy", ascending=False).head(15)
S["f4_energy"] = dict(
    total_energy_j=float(g.energy.sum()), spearman_events_vs_energy_regions100=r(rho), regions_in_correlation=int(len(big_g)),
    top15_by_energy=[dict(region=k, energy_share=r(v.energy_share, 2), event_share=r(v.event_share, 2),
                          count_rank=int(v.count_rank), energy_rank=int(v.energy_rank), max_mag=r(v.max_mag, 1)) for k, v in t.iterrows()],
    top10_count_set_in_top10_energy=len(set(g.sort_values("events", ascending=False).head(10).index) & set(g.sort_values("energy", ascending=False).head(10).index)),
    energy_per_event_top=[dict(region=k, mean_energy_vs_overall=r(v, 2)) for k, v in
                          (g[g.events >= 500].assign(x=lambda z: z.energy / z.events / (g.energy.sum() / N)).x.sort_values(ascending=False).head(5)).items()],
    energy_per_event_bottom=[dict(region=k, mean_energy_vs_overall=r(v, 2)) for k, v in
                             (g[g.events >= 500].assign(x=lambda z: z.energy / z.events / (g.energy.sum() / N)).x.sort_values().head(5)).items()])

# 5. Energy concentration in a few events
e = d.sort_values("energy_j", ascending=False).reset_index(drop=True)
ce = e.energy_j.cumsum() / e.energy_j.sum()
S["f5_pareto"] = dict(
    top1_share=r(ce[0] * 100, 1), top10_share=r(ce[9] * 100, 1), top50_share=r(ce[49] * 100, 1), top100_share=r(ce[99] * 100, 1),
    top1pct_events=int(N * 0.01), top1pct_share=r(ce[int(N * 0.01) - 1] * 100, 1),
    events_for_50pct=int((ce < 0.5).sum() + 1), events_for_90pct=int((ce < 0.9).sum() + 1),
    events_for_50pct_share_of_all=r(((ce < 0.5).sum() + 1) / N * 100, 3), m7plus_energy_share=r(d[d.mag >= 7].energy_j.sum() / d.energy_j.sum() * 100, 1),
    m8plus_energy_share=r(d[d.mag >= 8].energy_j.sum() / d.energy_j.sum() * 100, 1),
    m45_59_energy_share=r(d[d.mag < 6].energy_j.sum() / d.energy_j.sum() * 100, 2),
    top10=[dict(time=row.time_utc[:10], mag=row.mag, place=row.place, region=row.country_region, share=r(row.energy_j / e.energy_j.sum() * 100, 1)) for row in e.head(10).itertuples()],
    curve=[dict(n=int(n), share=r(ce[n - 1] * 100, 2)) for n in [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 50000, N]])

# 6. Depth: mostly shallow, but varies by region
dc = d.depth_class.value_counts()
macro = d.groupby("macro_region").agg(events=("id", "size"), median_depth=("depth_km", "median"),
                                      shallow=("depth_class", lambda s: (s.str.startswith("Shallow")).mean() * 100),
                                      deep=("depth_class", lambda s: (s.str.startswith("Deep")).mean() * 100))
reg = d[d.country_region.isin(cr[cr >= 1000].index)].groupby("country_region").agg(
    events=("id", "size"), median_depth=("depth_km", "median"),
    shallow=("depth_class", lambda s: s.str.startswith("Shallow").mean() * 100),
    intermediate=("depth_class", lambda s: s.str.startswith("Inter").mean() * 100),
    deep=("depth_class", lambda s: s.str.startswith("Deep").mean() * 100))
S["f6_depth"] = dict(
    overall={k: dict(events=int(v), share=r(v / N * 100, 1)) for k, v in dc.items()}, median_depth=r(d.depth_km.median(), 1),
    mean_depth=r(d.depth_km.mean(), 1), max_depth=r(d.depth_km.max(), 1), pct_under_35km=r((d.depth_km < 35).mean() * 100, 1),
    macro_region={k: {c: r(x, 1) for c, x in v.items()} for k, v in macro.round(1).iterrows()},
    regions_1000plus=[dict(region=k, **{c: r(x, 1) for c, x in v.items()}) for k, v in reg.sort_values("shallow").iterrows()],
    most_shallow_region=reg.shallow.idxmax(), least_shallow_region=reg.shallow.idxmin(), shallow_range_pct=[r(reg.shallow.min(), 1), r(reg.shallow.max(), 1)])

# 7. Magnitude vs depth
bands = pd.cut(d.depth_km, [-1, 35, 70, 150, 300, 500, 1000], labels=["0-35", "35-70", "70-150", "150-300", "300-500", "500+"])
bm = d.groupby(bands, observed=True).mag.agg(["size", "mean", "median", lambda s: (s >= 6).mean() * 100, "max"])
S["f7_mag_depth"] = dict(
    spearman_mag_depth=r(spearmanr(d.mag, d.depth_km)[0]), pearson_mag_depth=r(np.corrcoef(d.mag, d.depth_km)[0, 1]),
    by_depth_band=[dict(band=str(k), events=int(v["size"]), mean_mag=r(v["mean"], 2), median_mag=r(v["median"], 2),
                        pct_m6plus=r(v["<lambda_0>"], 2), max_mag=r(v["max"], 1)) for k, v in bm.iterrows()],
    mag_class_mix_by_depth_class={k: {c: r(x, 1) for c, x in v.items()} for k, v in
                                  (pd.crosstab(d.depth_class, d.mag_class, normalize="index") * 100).iterrows()},
    deepest_m7plus=dict(depth=r(d[d.mag >= 7].depth_km.max(), 0)),
    pct_m7plus_shallow=r((d[d.mag >= 7].depth_km < 70).mean() * 100, 1),
    pct_m45_49_shallow=r((d[d.mag < 5].depth_km < 70).mean() * 100, 1),
    heatmap_counts=pd.crosstab(pd.cut(d.depth_km, [-1, 35, 70, 150, 300, 500, 1000], labels=["0-35", "35-70", "70-150", "150-300", "300-500", "500+"]),
                               d.mag_class).astype(int).to_dict("index"))

# 8. Tsunami flag. The flag is 0 for EVERY event before 2013 (even 2004 Sumatra and 2011 Tohoku), so it is only
# analysed for 2013-2025.
FLAG_START = int(d[d.tsunami == 1].year.min())
x = d[d.year >= FLAG_START]
ts = x[x.tsunami == 1]
XN = len(x)
rate = lambda z: r(z.tsunami.mean() * 100, 2)
S["f8_tsunami"] = dict(
    flag_start_year=FLAG_START, events_in_scope=XN, flagged_all_years=int(d.tsunami.sum()), flagged_before_start=int(d[d.year < FLAG_START].tsunami.sum()),
    flagged=int(len(ts)), flagged_share_of_scope=r(len(ts) / XN * 100, 2),
    rate_by_mag_class={k: rate(v) for k, v in x.groupby("mag_class")},
    flagged_by_mag_class={k: int(v) for k, v in ts.mag_class.value_counts().items()},
    rate_by_depth_class={k: rate(v) for k, v in x.groupby("depth_class")},
    flagged_by_depth_class={k: int(v) for k, v in ts.depth_class.value_counts().items()},
    share_of_scope_by_depth_class={k: r(v / XN * 100, 1) for k, v in x.depth_class.value_counts().items()},
    pct_flagged_m6plus=r((ts.mag >= 6).mean() * 100, 1), pct_scope_m6plus=r((x.mag >= 6).mean() * 100, 1),
    pct_flagged_shallow=r((ts.depth_km < 70).mean() * 100, 1), pct_scope_shallow=r((x.depth_km < 70).mean() * 100, 1),
    pct_flagged_shallow_and_m6plus=r(((ts.mag >= 6) & (ts.depth_km < 70)).mean() * 100, 1),
    pct_flagged_m7plus=r((ts.mag >= 7).mean() * 100, 1), median_mag_flagged=r(ts.mag.median(), 2), median_mag_unflagged=r(x[x.tsunami == 0].mag.median(), 2),
    median_depth_flagged=r(ts.depth_km.median(), 1), median_depth_unflagged=r(x[x.tsunami == 0].depth_km.median(), 1),
    rate_matrix_pct={mcl: {dcl: r(v.tsunami.mean() * 100, 1) for dcl, v in grp.groupby("depth_class")} for mcl, grp in x.groupby("mag_class")},
    count_matrix={mcl: {dcl: int(len(v)) for dcl, v in grp.groupby("depth_class")} for mcl, grp in x.groupby("mag_class")},
    flagged_matrix={mcl: {dcl: int(v.tsunami.sum()) for dcl, v in grp.groupby("depth_class")} for mcl, grp in x.groupby("mag_class")},
    rate_m6plus_by_depth_band={k: r(v.tsunami.mean() * 100, 1) for k, v in x[x.mag >= 6].groupby(pd.cut(x[x.mag >= 6].depth_km, [-1, 35, 70, 300, 1000], labels=["0-35", "35-70", "70-300", "300+"]), observed=True)},
    rate_shallow_by_mag_class={k: rate(v) for k, v in x[x.depth_km < 70].groupby("mag_class")},
    flagged_by_year={int(k): int(v) for k, v in ts.groupby("year").size().items()})

# 7b. Magnitude x depth density grid (report chart)
mb_edges = np.round(np.arange(4.5, 9.3, 0.2), 1)
db_edges = list(range(0, 721, 20))
grid, _, _ = np.histogram2d(d.mag, d.depth_km, bins=[mb_edges, db_edges])
S["f7_mag_depth"]["grid"] = dict(mag_edges=[float(x) for x in mb_edges], depth_edges=db_edges, counts=grid.astype(int).tolist())

# Group table (the 61 regions with >= 500 events, plus the pooled remainder)
gt = d.groupby("country_region").agg(
    events=("id", "size"), median_mag=("mag", "median"), max_mag=("mag", "max"), median_depth_km=("depth_km", "median"),
    pct_shallow=("depth_class", lambda s: s.str.startswith("Shallow").mean() * 100), energy=("energy_j", "sum"),
    macro_region=("macro_region", lambda s: s.mode().iat[0]))
gt["pct_of_events"] = gt.events / N * 100
gt["pct_of_energy"] = gt.energy / gt.energy.sum() * 100
gt["rank_by_events"] = gt.events.rank(ascending=False, method="first").astype(int)
gt["rank_by_energy"] = gt.energy.rank(ascending=False, method="first").astype(int)
top_names = d[d.country_region_top != "All other regions"].country_region.unique()
gt = gt.loc[top_names].sort_values("events", ascending=False).drop(columns="energy").round(2)
assert len(gt) == 61
gt.reset_index().rename(columns={"country_region": "region"}).to_csv(OUT / "group_table.csv", index=False)
S["group_table"] = dict(rows=gt.reset_index().rename(columns={"country_region": "region"}).to_dict("records"),
                        other=dict(regions=int(d.country_region.nunique() - 61), events=int((d.country_region_top == "All other regions").sum())))

# data-quality facts for the methodology / caveats section
S["quality"] = dict(
    rows=N, columns=int(d.shape[1]), regions=int(len(cr)),
    region_method={k: dict(events=int(v), share=r(v / N * 100, 1)) for k, v in d.region_method.value_counts().items()},
    mag_type_group={k: int(v) for k, v in d.mag_type_group.value_counts().items()},
    mag_type_by_decade={f"{y}s": {k: int(v) for k, v in grp.mag_type_group.value_counts().items()} for y, grp in d.groupby(d.year // 10 * 10)},
    mean_mag_by_period={f"{a}-{b}": r(d[d.year.between(a, b)].mag.mean(), 3) for a, b in [(1990, 1999), (2000, 2009), (2010, 2019), (2020, 2025)]},
    depth_exactly_10_33_or_35km_pct=r(d.depth_km.isin([10.0, 33.0, 35.0]).mean() * 100, 1), depth_exactly_10km_pct=r((d.depth_km == 10).mean() * 100, 1),
    depth_default_share_m6plus_pct=r(d[d.mag >= 6].depth_km.isin([10.0, 33.0, 35.0]).mean() * 100, 1),
    sig_corr_with_mag=r(d.sig.corr(d.mag)), sig_min=int(d.sig.min()), sig_median=int(d.sig.median()), sig_max=int(d.sig.max()),
    depth_negative_clipped=json.loads((OUT / "build_info.json").read_text())["negative_depth_clipped_to_zero"],
    time_min=d.time_utc.min(), time_max=d.time_utc.max())

_bi = json.loads((OUT / "build_info.json").read_text())
S["meta"] = dict(pulled=_bi["pulled"], raw=_bi["raw_rows"])
(OUT / "report_stats.json").write_text(json.dumps(S, indent=1))
print("wrote report_stats.json")
