/* Report page: hero map animation, text bindings and the eight finding charts (all numbers come from report_stats.json). */
(async function () {
  'use strict';
  const { COLORS, fmtInt, fmtNum } = QD;
  const TEXT = '#aab4c5', GRID = '#222a3a', SURFACE = '#121620', BLUE = '#3987e5', ORANGE = '#d95926';
  const $ = (id) => document.getElementById(id);

  const [D, world, S] = await Promise.all([QD.loadData(), fetch('data/world-110m.json').then((r) => r.json()), fetch('data/report_stats.json').then((r) => r.json())]);

  // ---------- text bindings: data-s="a.b.c" (keys may contain dots), data-f = int | pct0 ----------
  function resolve(obj, parts) {
    if (!parts.length) return obj;
    if (obj == null) return undefined;
    for (let n = parts.length; n >= 1; n--) {
      const key = parts.slice(0, n).join('.');
      if (key in Object(obj)) return resolve(obj[key], parts.slice(n));
    }
    return undefined;
  }
  document.querySelectorAll('[data-s]').forEach((el) => {
    const v = resolve(S, el.dataset.s.split('.'));
    if (v === undefined) { console.warn('missing stat', el.dataset.s); el.textContent = '?'; return; }
    el.textContent = el.dataset.f === 'raw' ? String(v) : el.dataset.f === 'int' ? fmtInt(v) : el.dataset.f === 'pct0' ? fmtNum(v * 100, 0) + '%' : typeof v === 'number' ? v.toLocaleString('en-US') : v;
  });

  // ---------- hero map ----------
  const hero = new QuakeMap($('heroMap'), D, world, { zoom: false });
  const all = new Uint32Array(D.n); for (let i = 0; i < D.n; i++) all[i] = i;
  hero.speed = 1; hero.setMode('build');
  hero.setEvents(all, { yearRange: [1990, 2025], colorBy: 'depth' });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('replay').onclick = () => hero.restart();   // restart from 1990 every time, even while the opening animation is still running
  $('loading').classList.add('done');
  if (!reduce) setTimeout(() => hero.play(), 500);

  // ---------- chart helpers ----------
  const mk = (id) => { const c = echarts.init($(id)); new ResizeObserver(() => c.resize()).observe($(id)); return c; };
  const tip = { backgroundColor: 'rgba(12,15,22,.96)', borderColor: '#34405a', textStyle: { color: '#e8ecf3', fontSize: 12.5 }, extraCssText: 'border-radius:9px;box-shadow:0 8px 30px rgba(0,0,0,.5)' };
  const ax = { axisLine: { lineStyle: { color: '#33405a' } }, axisTick: { show: false }, axisLabel: { color: TEXT }, splitLine: { lineStyle: { color: GRID } } };
  const base = { textStyle: { color: TEXT, fontFamily: 'inherit' }, animationDuration: 500 };
  const abbr = (v) => (v >= 1e6 ? v / 1e6 + 'M' : v >= 1e4 ? v / 1e3 + 'k' : v >= 1000 ? fmtInt(v) : v);
  const legendOpt = { top: 0, right: 0, textStyle: { color: TEXT }, itemWidth: 12, itemHeight: 12, icon: 'roundRect' };
  const render = (id, opt) => mk(id).setOption({ ...base, ...opt });

  // ---------- 1. yearly activity ----------
  const years = Object.keys(S.f1_yearly.counts);
  render('c1a', {
    grid: { left: 54, right: 16, top: 16, bottom: 30 },
    tooltip: { ...tip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `<b>${p[0].axisValue}</b><br>${fmtInt(p[0].value)} events` },
    xAxis: { type: 'category', data: years, ...ax, axisLabel: { color: TEXT, interval: 4 } }, yAxis: { type: 'value', ...ax, axisLabel: { color: TEXT, formatter: abbr } },
    series: [{ type: 'bar', data: years.map((y) => ({ value: S.f1_yearly.counts[y], itemStyle: { color: y == S.f1_yearly.max_year || y == S.f1_yearly.min_year ? ORANGE : BLUE, borderRadius: [3, 3, 0, 0] } })), barCategoryGap: '25%',
      markLine: { symbol: 'none', silent: true, lineStyle: { color: '#cdd5e3', type: 'dashed', width: 1 }, label: { color: TEXT, formatter: 'mean ' + fmtInt(S.f1_yearly.mean), position: 'insideEndTop' }, data: [{ yAxis: S.f1_yearly.mean }] } }],
  });
  render('c1b', {
    grid: { left: 44, right: 16, top: 16, bottom: 30 },
    tooltip: { ...tip, trigger: 'axis', formatter: (p) => `<b>${p[0].axisValue}</b><br>${p[0].value} M6+ events` },
    xAxis: { type: 'category', data: years, ...ax, axisLabel: { color: TEXT, interval: 4 } }, yAxis: { type: 'value', min: 0, ...ax },
    series: [{ type: 'line', data: years.map((y) => S.f1_yearly.m6plus[y]), symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: ORANGE }, itemStyle: { color: ORANGE, borderColor: SURFACE, borderWidth: 1.5 },
      markLine: { symbol: 'none', silent: true, lineStyle: { color: '#cdd5e3', type: 'dashed', width: 1 }, label: { color: TEXT, formatter: 'mean ' + S.f1_yearly.m6plus_mean, position: 'insideEndTop' }, data: [{ yAxis: S.f1_yearly.m6plus_mean }] } }],
  });

  // ---------- 2. magnitude classes ----------
  const mc = ['4.5-4.9', '5.0-5.9', '6.0-6.9', '7.0+'], mcCols = COLORS.mag;
  render('c2a', {
    grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>M${p.name}</b><br>${fmtInt(p.value)} events (${S.f2_magnitude.share[p.name]}%)` },
    xAxis: { type: 'log', min: 100, show: false }, yAxis: { type: 'category', inverse: true, data: mc, ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3', fontSize: 13, formatter: (v) => 'M' + v } },
    series: [{ type: 'bar', barMaxWidth: 34, data: mc.map((k, i) => ({ value: S.f2_magnitude.counts[k], itemStyle: { color: mcCols[i], borderRadius: [0, 5, 5, 0] } })),
      label: { show: true, position: 'right', color: '#cdd5e3', formatter: (p) => `${fmtInt(p.value)}  (${S.f2_magnitude.share[mc[p.dataIndex]]}%)` } }],
  });
  const bins = Object.entries(S.f2_magnitude.per_0_1_bin);
  render('c2b', {
    grid: { left: 50, right: 16, top: 12, bottom: 44 },
    tooltip: { ...tip, trigger: 'axis', formatter: (p) => `<b>M${p[0].axisValue}–${(+p[0].axisValue + 0.1).toFixed(1)}</b><br>${fmtInt(p[0].value || 0)} events` },
    xAxis: { type: 'category', data: bins.map((b) => b[0]), name: 'Magnitude', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: TEXT }, ...ax, axisLabel: { color: TEXT, interval: 4 } },
    yAxis: { type: 'log', min: 1, ...ax, axisLabel: { color: TEXT, formatter: abbr } },
    series: [{ type: 'bar', data: bins.map((b) => b[1] || null), barCategoryGap: '15%', itemStyle: { color: BLUE, borderRadius: [2, 2, 0, 0] } }],
  });

  // ---------- 3. concentration ----------
  const t15 = S.f3_concentration.top15;
  render('c3a', {
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${fmtInt(p.value)} events (${t15[p.dataIndex].share}%)` },
    xAxis: { type: 'value', ...ax, axisLabel: { color: TEXT, formatter: abbr } }, yAxis: { type: 'category', inverse: true, data: t15.map((r) => r.region.replace('United States of America', 'USA')), ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3' } },
    series: [{ type: 'bar', barMaxWidth: 20, data: t15.map((r) => r.events), itemStyle: { color: BLUE, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#cdd5e3', formatter: (p) => t15[p.dataIndex].share + '%' } }],
  });
  const mr = Object.entries(S.f3_concentration.macro_region);
  render('c3b', {
    grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${fmtInt(mr[p.dataIndex][1].events)} events (${mr[p.dataIndex][1].share}%)` },
    xAxis: { type: 'value', ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } }, yAxis: { type: 'category', inverse: true, data: mr.map((r) => r[0]), ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3' } },
    series: [{ type: 'bar', barMaxWidth: 20, data: mr.map((r) => r[1].share), itemStyle: { color: BLUE, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#cdd5e3', formatter: (p) => p.value + '%' } }],
  });

  // ---------- 4. events vs energy ----------
  const e15 = S.f4_energy.top15_by_energy, short = (n) => n.replace('United States of America', 'USA');
  render('c4a', {
    grid: { left: 8, right: 56, top: 34, bottom: 8, containLabel: true },
    legend: { ...legendOpt, data: ['Share of events', 'Share of energy'] },
    tooltip: { ...tip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `<b>${p[0].axisValue}</b>` + p.map((s) => `<br>${s.marker} ${s.seriesName}: <b>${s.value}%</b>`).join('') },
    xAxis: { type: 'value', ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } }, yAxis: { type: 'category', inverse: true, data: e15.map((r) => short(r.region)), ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3' } },
    series: [
      { name: 'Share of events', type: 'bar', barMaxWidth: 12, itemStyle: { color: BLUE, borderRadius: [0, 3, 3, 0] }, data: e15.map((r) => r.event_share) },
      { name: 'Share of energy', type: 'bar', barMaxWidth: 12, itemStyle: { color: ORANGE, borderRadius: [0, 3, 3, 0] }, data: e15.map((r) => r.energy_share), label: { show: true, position: 'right', color: '#cdd5e3', fontSize: 11, formatter: (p) => p.value + '%' } },
    ],
  });
  $('t4').querySelector('tbody').innerHTML = e15.map((r) => {
    const d = r.count_rank - r.energy_rank, arrow = d >= 3 ? '<span style="color:#e8a46f">▲</span>' : d <= -3 ? '<span style="color:#7db4f5">▼</span>' : '';
    return `<tr><td>${short(r.region)}</td><td class="r">${r.count_rank}</td><td class="r">${r.energy_rank} ${arrow}</td><td class="r">${r.energy_share}%</td></tr>`;
  }).join('');

  // ---------- 5. Pareto ----------
  const cv = S.f5_pareto.curve;
  render('c5a', {
    grid: { left: 54, right: 24, top: 20, bottom: 44 },
    tooltip: { ...tip, trigger: 'axis', formatter: (p) => `<b>Top ${fmtInt(p[0].value[0])} events</b><br>${p[0].value[1]}% of all energy` },
    xAxis: { type: 'log', min: 1, max: D.n, name: 'Number of events (largest first)', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: TEXT }, ...ax, axisLabel: { color: TEXT, formatter: abbr } },
    yAxis: { type: 'value', min: 0, max: 100, ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } },
    series: [{ type: 'line', smooth: 0.2, data: cv.map((c) => [c.n, c.share]), symbol: 'circle', symbolSize: 7, lineStyle: { width: 3, color: ORANGE }, itemStyle: { color: ORANGE, borderColor: SURFACE, borderWidth: 1.5 },
      areaStyle: { color: 'rgba(217,89,38,.12)' },
      label: { show: true, color: '#cdd5e3', fontSize: 11, position: 'top', formatter: (p) => ([1, 10, 100, 1000, 10000].includes(p.value[0]) ? `${p.value[1]}%` : '') } }],
  });
  $('t5').querySelector('tbody').innerHTML = S.f5_pareto.top10.map((r) => `<tr><td>${r.time}</td><td class="r"><b>${r.mag.toFixed(1)}</b></td><td>${short(r.region)}</td><td class="r">${r.share}%</td></tr>`).join('');

  // ---------- 6. depth mix ----------
  const dnames = ['Shallow (<70 km)', 'Intermediate (70-300 km)', 'Deep (>300 km)'], dkeys = ['shallow', 'intermediate', 'deep'];
  const stack = (id, rows, label) => render(id, {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: { ...legendOpt, data: dnames },
    tooltip: { ...tip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `<b>${p[0].axisValue}</b>` + p.map((s) => `<br>${s.marker} ${s.seriesName}: <b>${s.value}%</b>`).join('') },
    xAxis: { type: 'value', max: 100, ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => short(r.name)), ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3' } },
    series: dkeys.map((k, i) => ({ name: dnames[i], type: 'bar', stack: 'd', barMaxWidth: 20, data: rows.map((r) => r[k]), itemStyle: { color: COLORS.depth[i], borderColor: SURFACE, borderWidth: 1 } })),
  });
  const reg20 = S.f6_depth.regions_1000plus.slice().sort((a, b) => b.events - a.events).slice(0, 20).sort((a, b) => a.shallow - b.shallow).map((r) => ({ name: r.region, ...r }));
  stack('c6a', reg20);
  const macro = Object.entries(S.f6_depth.macro_region).map(([name, v]) => ({ name, shallow: v.shallow, intermediate: Math.round((100 - v.shallow - v.deep) * 10) / 10, deep: v.deep })).sort((a, b) => a.shallow - b.shallow);
  stack('c6b', macro);

  // ---------- 7. magnitude vs depth ----------
  const g = S.f7_mag_depth.grid, me = g.mag_edges, de = g.depth_edges, heat = [];
  let mx = 1;
  g.counts.forEach((row, mi) => row.forEach((c, di) => { if (c) { heat.push([mi, di, Math.log10(c), c]); mx = Math.max(mx, c); } }));
  render('c7a', {
    grid: { left: 54, right: 24, top: 30, bottom: 84 },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>M${me[p.value[0]].toFixed(1)}–${me[p.value[0] + 1].toFixed(1)}</b>, ${de[p.value[1]]}–${de[p.value[1] + 1]} km<br><b>${fmtInt(p.value[3])}</b> events` },
    xAxis: { type: 'category', data: me.slice(0, -1).map((m) => m.toFixed(1)), name: 'Magnitude', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: TEXT }, ...ax, splitLine: { show: false } },
    yAxis: { type: 'category', data: de.slice(0, -1).map(String), inverse: true, name: 'Depth (km)', nameLocation: 'start', nameTextStyle: { color: TEXT, align: 'left', padding: [0, 0, 0, -46] }, ...ax, splitLine: { show: false }, axisLabel: { color: TEXT, interval: 4 } },
    visualMap: { type: 'continuous', min: 0, max: Math.log10(mx), dimension: 2, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 14, itemHeight: 220, text: [fmtInt(mx), '1'], textStyle: { color: TEXT }, calculable: false, inRange: { color: ['#142038', '#1c5cab', '#3987e5', '#9ec5f4', '#f2f8ff'] } },
    series: [{ type: 'heatmap', data: heat, itemStyle: { borderColor: SURFACE, borderWidth: 1, borderRadius: 2 } }],
  });
  const bands = S.f7_mag_depth.by_depth_band;
  render('c7b', {
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>${p.name} km</b><br>${p.value}% are M6+<br>${fmtInt(bands[p.dataIndex].events)} events · mean M${bands[p.dataIndex].mean_mag}` },
    xAxis: { type: 'value', min: 0, ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } },
    yAxis: { type: 'category', inverse: true, data: bands.map((b) => b.band), ...ax, splitLine: { show: false }, axisLabel: { color: '#cdd5e3' } },
    series: [{ type: 'bar', barMaxWidth: 26, data: bands.map((b) => b.pct_m6plus), itemStyle: { color: BLUE, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#cdd5e3', formatter: (p) => p.value + '%' } }],
  });

  // ---------- 8. tsunami flag ----------
  const rate = (id, keys, labels, cols, obj, counts) => render(id, {
    grid: { left: 52, right: 16, top: 24, bottom: 36 },
    tooltip: { ...tip, trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${p.value}% flagged<br>${fmtInt(counts[keys[p.dataIndex]])} flagged events` },
    xAxis: { type: 'category', data: labels, ...ax, axisLabel: { color: '#cdd5e3' } }, yAxis: { type: 'value', min: 0, ...ax, axisLabel: { color: TEXT, formatter: (v) => v + '%' } },
    series: [{ type: 'bar', barMaxWidth: 64, data: keys.map((k, i) => ({ value: obj[k], itemStyle: { color: cols[i], borderRadius: [5, 5, 0, 0] } })), label: { show: true, position: 'top', color: '#e8ecf3', fontWeight: 600, formatter: (p) => p.value + '%' } }],
  });
  rate('c8a', mc, mc.map((m) => 'M' + m), mcCols, S.f8_tsunami.rate_by_mag_class, S.f8_tsunami.flagged_by_mag_class);
  rate('c8b', dnames, ['Shallow', 'Intermediate', 'Deep'], COLORS.depth, S.f8_tsunami.rate_by_depth_class, S.f8_tsunami.flagged_by_depth_class);

  // ---------- methods: group table ----------
  $('tGroups').querySelector('tbody').innerHTML = S.group_table.rows.map((r) =>
    `<tr><td>${short(r.region)}</td><td>${r.macro_region}</td><td class="r">${fmtInt(r.events)}</td><td class="r">${r.pct_of_events}</td><td class="r">${r.pct_of_energy}</td><td class="r">${r.median_depth_km}</td><td class="r">${r.max_mag}</td><td class="r">${r.rank_by_events}</td><td class="r">${r.rank_by_energy}</td></tr>`).join('');
})();
