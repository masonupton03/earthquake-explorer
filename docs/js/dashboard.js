/* Dashboard controller: filters -> selected events -> summary tiles, map, charts, table. */
(async function () {
  'use strict';
  const { COLORS, MEASURES, fmtInt, fmtNum, fmtEnergy, fmtMeasure, fmtTime } = QD;
  const $ = (id) => document.getElementById(id);
  const TEXT = '#aab4c5', GRID = '#222a3a', SURFACE = '#121620';

  const [D, world] = await Promise.all([QD.loadData(), fetch('data/world-110m.json').then((r) => r.json())]);
  const M = D.meta, N = D.n;
  $('pulled').textContent = M.pulled;
  const state = QD.newState();
  const view = { measure: 'count', dim: 'depth', color: 'depth', sort: { k: 'mag', desc: true }, page: 0, tbl: 'events' };
  let idx = new Uint32Array(0), sorted = idx, sumry = null;
  const PAGE = 25;

  // totals per category over the whole dataset (shown beside filter options)
  const totals = (arr, K) => { const t = new Array(K).fill(0); for (let i = 0; i < N; i++) t[arr[i]]++; return t; };
  const tot = { region: totals(D.raw_region, M.regions.length), macro: totals(D.raw_macro, M.macros.length) };

  // ===================================================================== filter controls
  const syncers = [];
  function chips(el, names, key, colors) {
    names.forEach((nm, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = (colors ? `<span class="dot" style="background:${colors[k]}"></span>` : '') + nm;
      b.onclick = () => { const s = state[key]; s.has(k) ? s.delete(k) : s.add(k); schedule(); };
      el.appendChild(b);
    });
    syncers.push(() => [...el.children].forEach((b, k) => b.setAttribute('aria-pressed', state[key].has(k))));
  }
  function dropdown(el, names, key, counts, labelEl, allLabel = 'All') {
    el.innerHTML = `<button type="button" class="dd-btn"><span class="dd-text">${allLabel}</span><span>▾</span></button>
      <div class="dd-panel"><input type="search" placeholder="Search…" aria-label="Search"><div class="dd-list"></div>
      <div class="dd-actions"><button type="button" data-a="clear">Clear</button><button type="button" data-a="close">Done</button></div></div>`;
    const list = el.querySelector('.dd-list'), search = el.querySelector('input'), txt = el.querySelector('.dd-text');
    names.forEach((nm, k) => {
      const row = document.createElement('label'); row.className = 'dd-item'; row.dataset.name = nm.toLowerCase();
      row.innerHTML = `<input type="checkbox"><span>${nm}</span><span class="n">${fmtInt(counts[k])}</span>`;
      row.querySelector('input').onchange = (e) => { e.target.checked ? state[key].add(k) : state[key].delete(k); schedule(); };
      list.appendChild(row);
    });
    el.querySelector('.dd-btn').onclick = () => el.classList.toggle('open');
    el.querySelector('[data-a=clear]').onclick = () => { state[key].clear(); schedule(); };
    el.querySelector('[data-a=close]').onclick = () => el.classList.remove('open');
    search.oninput = () => { const q = search.value.trim().toLowerCase(); [...list.children].forEach((r) => (r.style.display = r.dataset.name.includes(q) ? '' : 'none')); };
    document.addEventListener('click', (e) => { if (!el.contains(e.target)) el.classList.remove('open'); });
    syncers.push(() => {
      const s = state[key];
      [...list.children].forEach((r, k) => (r.querySelector('input').checked = s.has(k)));
      const label = s.size === 0 ? allLabel : s.size === 1 ? names[[...s][0]] : `${s.size} selected`;
      txt.textContent = label; labelEl.textContent = label;
    });
  }
  dropdown($('ddRegion'), M.regions, 'region', tot.region, $('regionVal'));
  dropdown($('ddMacro'), M.macros, 'macro', tot.macro, $('macroVal'));
  chips($('chipsMag'), M.mclasses, 'mclass', COLORS.mag);
  chips($('chipsDepth'), M.dclasses, 'dclass', COLORS.depth);
  chips($('chipsMtype'), QD.MTYPE_LABELS, 'mtype', COLORS.mtype);

  const y0 = $('y0'), y1 = $('y1');
  y0.oninput = () => { if (+y0.value > +y1.value) y0.value = y1.value; state.y0 = +y0.value; schedule(); };
  y1.oninput = () => { if (+y1.value < +y0.value) y1.value = y0.value; state.y1 = +y1.value; schedule(); };
  syncers.push(() => {
    y0.value = state.y0; y1.value = state.y1; $('yearVal').textContent = `${state.y0} – ${state.y1}`;
    const f = $('yearFill'), lo = (state.y0 - 1990) / 35, hi = (state.y1 - 1990) / 35;
    f.style.left = `calc(${lo * 100}% + ${9 - lo * 18}px)`; f.style.width = `calc(${(hi - lo) * 100}% - ${(hi - lo) * 18}px)`;
    y1.style.zIndex = state.y0 >= 2024 ? 1 : 2;
  });
  document.querySelectorAll('#segTsu button').forEach((b) => (b.onclick = () => { state.tsu = b.dataset.v; schedule(); }));
  syncers.push(() => {
    document.querySelectorAll('#segTsu button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.tsu));
    const n = $('tsuNotice');
    if (state.y0 < QD.FLAG_START_YEAR) {
      n.className = 'notice show';
      n.textContent = state.tsu === 'all'
        ? 'The tsunami flag is only recorded for 2013–2025. Events before 2013 in your selection all read “not flagged”.'
        : 'Your selected years include events before 2013, when the tsunami flag was not recorded. Those events all read “not flagged”, so “Not flagged” includes them and “Flagged” can only match 2013–2025.';
    } else n.className = 'notice';
  });

  // view switches
  function seg(el, items, get, set) {
    items.forEach(([v, label]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = label; b.onclick = () => { set(v); renderCharts(); }; el.appendChild(b); });
    return () => [...el.children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === get()));
  }
  const syncMeasure = seg($('segMeasure'), Object.values(MEASURES).map((m) => [m.id, m.label]), () => view.measure, (v) => (view.measure = v));
  const syncBreak = seg($('segBreak'), Object.values(D.dims).map((d) => [d.id, d.label]), () => view.dim, (v) => (view.dim = v));

  $('reset').onclick = () => {
    Object.assign(state, QD.newState()); Object.assign(view, { measure: 'count', dim: 'depth', color: 'depth', sort: { k: 'mag', desc: true }, page: 0 });
    map.setMode('build'); map.speed = 1; setSeg('segMode', 'build'); setSeg('segSpeed', '1'); setSeg('segColor', 'depth'); map.resetView && map.resetView();
    schedule(); renderCharts();
  };

  // ===================================================================== map
  const map = new QuakeMap($('mapbox'), D, world, { zoom: true });
  const setSeg = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
  const regionOf = (i) => (D.details ? D.details.rf_names[D.details.rf[i]] : M.regions[D.raw_region[i]]);
  map.onProgress = (f, playing, fromSeek) => {
    $('play').textContent = playing ? '❚❚ Pause' : (f >= 0.999 ? '▶ Play timeline' : '▶ Resume');
    if (!fromSeek) $('scrub').value = Math.round(f * 1000);
  };
  $('play').onclick = () => map.toggle();
  $('scrub').oninput = (e) => map.seek(e.target.value / 1000);
  document.querySelectorAll('#segMode button').forEach((b) => (b.onclick = () => { map.setMode(b.dataset.v); setSeg('segMode', b.dataset.v); }));
  document.querySelectorAll('#segSpeed button').forEach((b) => (b.onclick = () => { map.speed = +b.dataset.v; setSeg('segSpeed', b.dataset.v); }));
  document.querySelectorAll('#segColor button').forEach((b) => (b.onclick = () => { view.color = b.dataset.v; setSeg('segColor', b.dataset.v); map.setColorBy(view.color); legend(); }));
  function legend() {
    const names = view.color === 'mag' ? M.mclasses : M.dclasses, cols = view.color === 'mag' ? COLORS.mag : COLORS.depth;
    $('mapLegend').innerHTML = names.map((n, k) => `<span><i style="background:${cols[k]}"></i>${n}</span>`).join('');
  }

  // ===================================================================== charts
  const charts = {};
  const mk = (id) => { const c = echarts.init($(id), null, { renderer: 'canvas' }); new ResizeObserver(() => c.resize()).observe($(id)); return (charts[id] = c); };
  const cTime = mk('chTime'), cRank = mk('chRank'), cHist = mk('chHist'), cHeat = mk('chHeat');
  const base = { textStyle: { color: TEXT, fontFamily: 'inherit' }, animationDuration: 250, grid: { left: 54, right: 16, top: 16, bottom: 30, containLabel: false } };
  const axisStyle = { axisLine: { lineStyle: { color: '#33405a' } }, axisTick: { show: false }, axisLabel: { color: TEXT }, splitLine: { lineStyle: { color: GRID } } };
  const tooltipBase = { backgroundColor: 'rgba(12,15,22,.96)', borderColor: '#34405a', textStyle: { color: '#e8ecf3', fontSize: 12.5 }, extraCssText: 'box-shadow:0 8px 30px rgba(0,0,0,.5);border-radius:9px' };
  const abbr = (v) => (Math.abs(v) >= 1e6 ? v / 1e6 + 'M' : Math.abs(v) >= 1e4 ? v / 1e3 + 'k' : v >= 1000 ? fmtInt(v) : v);

  // --- time series (measure x breakdown)
  let timeCtx = null;
  function renderTime() {
    const m = MEASURES[view.measure], dim = D.dims[view.dim], sr = dim.series, S = sr.names.length;
    const monthly = state.y0 === state.y1, K2 = monthly ? 12 : state.y1 - state.y0 + 1;
    const cats = monthly ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : Array.from({ length: K2 }, (_, i) => String(state.y0 + i));
    $('timeTitle').textContent = `${m.label} per ${monthly ? 'month (' + state.y0 + ')' : 'year'}, by ${dim.label.toLowerCase()}`;
    $('timeCap').textContent = monthly ? 'Single year selected — showing months.' : 'Drag across the chart to filter by years.';
    if (!idx.length) { cTime.clear(); $('timeLegend').innerHTML = ''; return; }
    const agg = QD.aggregate(D, idx, view.measure, dim.arr, sr.lookup, S, monthly ? D.raw_month : D.year, K2, monthly ? 1 : state.y0);
    const present = [];
    for (let s = 0; s < S; s++) { let any = 0; for (let k = 0; k < K2; k++) any += agg.count[k * S + s]; if (any) present.push(s); }
    const series = present.map((s) => {
      const data = cats.map((_, k) => { const v = agg.value[k * S + s]; return Number.isFinite(v) ? v : null; });
      return m.additive
        ? { name: sr.names[s], type: 'bar', stack: 'all', data, itemStyle: { color: sr.colors[s], borderColor: SURFACE, borderWidth: 1 }, emphasis: { focus: 'series' }, barCategoryGap: '28%' }
        : { name: sr.names[s], type: 'line', data, connectNulls: false, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color: sr.colors[s] }, itemStyle: { color: sr.colors[s], borderColor: SURFACE, borderWidth: 1.5 }, emphasis: { focus: 'series' } };
    });
    $('timeLegend').innerHTML = present.length > 1 ? present.map((s) => `<span><i style="background:${sr.colors[s]}"></i>${sr.names[s]}</span>`).join('') : '';
    cTime.setOption({
      ...base, grid: { left: 56, right: 16, top: 14, bottom: 30 }, color: present.map((s) => sr.colors[s]),
      tooltip: { ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,.04)' } },
        formatter: (ps) => {
          const rows = ps.filter((p) => p.value != null);
          if (!rows.length) return `<b>${ps[0].axisValue}</b><br>No data`;
          const total = m.additive ? rows.reduce((a, p) => a + p.value, 0) : null;
          return `<b>${ps[0].axisValue}</b>` + (m.additive && rows.length > 1 ? ` — ${fmtMeasure(view.measure, total)}` : '') +
            rows.map((p) => `<br><span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtMeasure(view.measure, p.value)}</b>`).join('');
        } },
      xAxis: { type: 'category', data: cats, ...axisStyle, axisLabel: { color: TEXT, interval: K2 > 18 ? 2 : 0 } },
      yAxis: { type: 'value', name: m.axis, nameTextStyle: { color: TEXT, align: 'left' }, ...axisStyle, axisLabel: { color: TEXT, formatter: abbr }, min: !m.additive && view.measure !== 'count' ? (v) => Math.floor((v.min - (v.max - v.min) * 0.1) * 10) / 10 : 0 },
      toolbox: { show: false },
      brush: monthly ? undefined : { toolbox: [], xAxisIndex: 0, brushType: 'lineX', brushMode: 'single', transformable: false, brushStyle: { color: 'rgba(57,135,229,.2)', borderColor: '#3987e5' }, throttleType: 'debounce', throttleDelay: 120 },
      series,
    }, true);
    timeCtx = { monthly, y0: state.y0 };
    if (!monthly) cTime.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
  }
  cTime.on('brushEnd', (e) => {
    const a = e.areas && e.areas[0]; if (!a || !timeCtx || timeCtx.monthly) return;
    const [s, t] = a.coordRange.map(Math.round), lo = Math.max(0, Math.min(s, t)), hi = Math.max(s, t);
    state.y0 = timeCtx.y0 + lo; state.y1 = Math.min(2025, timeCtx.y0 + hi); schedule();
  });

  // --- ranked bar (measure x breakdown), click to filter
  let rankCtx = null;
  function renderRank() {
    const m = MEASURES[view.measure], dim = D.dims[view.dim];
    $('rankTitle').textContent = `${m.label} by ${dim.label.toLowerCase()}${dim.K > 12 ? ' — top 12' : ''}`;
    $('rankCap').textContent = 'Click a bar to filter to it.' + (m.minN > 1 ? ` Categories with fewer than ${m.minN} events are hidden.` : '') + (dim.rankExclude != null ? ' Pooled “All other regions” not ranked.' : '');
    if (!idx.length) { cRank.clear(); return; }
    const agg = QD.aggregate(D, idx, view.measure, dim.arr, null, dim.K);
    let rows = []; for (let k = 0; k < dim.K; k++) if (Number.isFinite(agg.value[k]) && k !== dim.rankExclude) rows.push({ k, v: agg.value[k], n: agg.count[k] });
    rows.sort((a, b) => b.v - a.v); rows = rows.slice(0, 12);
    rankCtx = rows;
    const fixed = dim.K <= 5 ? dim.series.colors : null;
    cRank.setOption({
      ...base, grid: { left: 8, right: 64, top: 8, bottom: 24, containLabel: true },
      tooltip: { ...tooltipBase, trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${m.label}: <b>${fmtMeasure(view.measure, p.value)}</b><br>${fmtInt(rows[p.dataIndex].n)} events in view` },
      xAxis: { type: 'value', ...axisStyle, axisLabel: { color: TEXT, formatter: abbr }, min: !m.additive && view.measure !== 'count' ? (v) => Math.floor((v.min - (v.max - v.min) * 0.15) * 10) / 10 : 0 },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => dim.names[r.k]), ...axisStyle, splitLine: { show: false }, axisLabel: { color: '#cdd5e3', width: 175, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 22, cursor: 'pointer', data: rows.map((r) => ({ value: r.v, itemStyle: { color: fixed ? fixed[r.k] : '#3987e5', borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: '#cdd5e3', fontSize: 11.5, formatter: (p) => fmtMeasure(view.measure, p.value) }, emphasis: { itemStyle: { opacity: 0.85 } } }],
    }, true);
  }
  cRank.on('click', (p) => {
    if (!rankCtx) return; const dim = D.dims[view.dim], k = rankCtx[p.dataIndex].k, s = state[dim.filter];
    if (s.size === 1 && s.has(k)) s.clear(); else { s.clear(); s.add(k); }
    schedule();
  });

  // --- magnitude histogram (log y)
  function renderHist() {
    const bins = new Array(47).fill(0);
    for (let j = 0; j < idx.length; j++) bins[Math.floor(D.raw_mag[idx[j]] / 10) - 45]++;
    const labels = bins.map((_, b) => (4.5 + b * 0.1).toFixed(1));
    if (!idx.length) { cHist.clear(); return; }
    cHist.setOption({
      ...base, grid: { left: 56, right: 16, top: 12, bottom: 44 },
      tooltip: { ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => `<b>M ${ps[0].axisValue}–${(+ps[0].axisValue + 0.1).toFixed(1)}</b><br>${fmtInt(ps[0].value || 0)} events` },
      xAxis: { type: 'category', data: labels, name: 'Magnitude', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: TEXT }, ...axisStyle, axisLabel: { color: TEXT, interval: 4 } },
      yAxis: { type: 'log', min: 1, ...axisStyle, axisLabel: { color: TEXT, formatter: (v) => abbr(v) } },
      series: [{ type: 'bar', data: bins.map((v) => (v ? v : null)), itemStyle: { color: '#3987e5', borderRadius: [2, 2, 0, 0] }, barCategoryGap: '18%' }],
    }, true);
  }

  // --- magnitude x depth density heatmap
  function renderHeat() {
    const MB = 24, DB = 36, grid = new Uint32Array(MB * DB);
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; grid[Math.min(DB - 1, Math.floor(D.depth[i] / 20)) * MB + Math.min(MB - 1, Math.floor((D.raw_mag[i] - 450) / 20))]++; }
    let mx = 1; for (let g = 0; g < grid.length; g++) if (grid[g] > mx) mx = grid[g];
    const data = []; for (let d = 0; d < DB; d++) for (let b = 0; b < MB; b++) if (grid[d * MB + b]) data.push([b, d, Math.log10(grid[d * MB + b]), grid[d * MB + b]]);
    const xl = Array.from({ length: MB }, (_, b) => (4.5 + b * 0.2).toFixed(1)), yl = Array.from({ length: DB }, (_, d) => `${d * 20}`);
    if (!idx.length) { cHeat.clear(); return; }
    cHeat.setOption({
      ...base, grid: { left: 56, right: 24, top: 30, bottom: 80 },
      tooltip: { ...tooltipBase, trigger: 'item', formatter: (p) => `<b>M ${xl[p.value[0]]}–${(+xl[p.value[0]] + 0.2).toFixed(1)}</b>, ${yl[p.value[1]]}–${+yl[p.value[1]] + 20} km<br><b>${fmtInt(p.value[3])}</b> events` },
      xAxis: { type: 'category', data: xl, name: 'Magnitude', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: TEXT }, ...axisStyle, splitLine: { show: false } },
      yAxis: { type: 'category', data: yl, inverse: true, name: 'Depth (km)', nameLocation: 'start', nameTextStyle: { color: TEXT, align: 'left', padding: [0, 0, 0, -46] }, ...axisStyle, splitLine: { show: false }, axisLabel: { color: TEXT, interval: 4 } },
      visualMap: { type: 'continuous', min: 0, max: Math.max(1, Math.log10(mx)), dimension: 2, orient: 'horizontal', left: 'center', bottom: 4, itemWidth: 14, itemHeight: 220, text: [fmtInt(mx), '1'], textStyle: { color: TEXT }, calculable: false,
        inRange: { color: ['#142038', '#1c5cab', '#3987e5', '#9ec5f4', '#f2f8ff'] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: SURFACE, borderWidth: 1, borderRadius: 2 }, emphasis: { itemStyle: { borderColor: '#fff' } } }],
    }, true);
  }

  // ===================================================================== summary tiles
  function renderTiles() {
    const s = sumry = QD.summarize(D, idx), n = s.n;
    $('selCount').textContent = fmtInt(n);
    const set = (id, v, sub) => { $('t_' + id).textContent = v; $('t_' + id + '_s').textContent = sub; };
    if (!n) { set('n', '0', 'no events match'); set('m6', '–', ''); set('avg', '–', ''); set('max', '–', ''); set('dep', '–', ''); set('en', '–', ''); return; }
    set('n', fmtInt(n), `${fmtNum(n / N * 100, n / N < 0.1 ? 2 : 1)}% of all ${fmtInt(N)}`);
    set('m6', fmtInt(s.m6), `${fmtNum(s.m6 / n * 100, 1)}% of this view`);
    set('avg', fmtNum(s.avgMag, 2), `median ${fmtNum(s.medMag, 2)}`);
    const b = s.strongest;
    set('max', 'M' + fmtNum(D.mag[b], 1), `${fmtTime(D, b).slice(0, 10)} · ${D.details ? D.details.place[b] : regionOf(b)}`);
    set('dep', fmtNum(s.medDepth, 1) + ' km', `${fmtNum(s.shallow / n * 100, 0)}% shallow (<70 km)`);
    set('en', fmtNum(s.energyShare, s.energyShare < 10 ? 1 : 0) + '%', `${fmtEnergy(s.energy / 1e15)} of ${fmtEnergy(D.totalEnergy / 1e15)}`);
  }

  // ===================================================================== table
  const COLS = [
    { k: 'time', label: 'Time (UTC)', key: null }, { k: 'mag', label: 'Mag', r: 1, key: D.raw_mag, max: 910 }, { k: 'depth', label: 'Depth (km)', r: 1, key: D.raw_depth, max: 7100 },
    { k: 'place', label: 'Place' }, { k: 'region', label: 'Country / region', key: D.raw_region, max: 255 }, { k: 'mtype', label: 'Magnitude type', key: D.raw_mtype, max: 3 },
    { k: 'sig', label: 'Signif.', r: 1, key: D.raw_sig, max: 3000 }, { k: 'tsu', label: 'Tsunami flag', key: D.raw_tsu, max: 1 }, { k: 'link', label: '' },
  ];
  function buildEventsHead() {
    $('tbl').querySelector('thead').innerHTML = '<tr>' + COLS.map((c) => `<th data-k="${c.k}" class="${c.r ? 'r' : ''}" ${c.k === 'place' || c.k === 'link' ? 'style="cursor:default"' : ''}></th>`).join('') + '</tr>';
    document.querySelectorAll('#tbl th').forEach((th) => (th.onclick = () => {
      const k = th.dataset.k; if (k === 'place' || k === 'link') return;
      view.sort = view.sort.k === k ? { k, desc: !view.sort.desc } : { k, desc: k !== 'region' && k !== 'mtype' };
      view.page = 0; sortRows(); renderTable();
    }));
  }
  buildEventsHead();
  // Summary view: the numbers behind the charts (one row per category of the current breakdown, for the current measure)
  function summaryRows() {
    const m = MEASURES[view.measure], dim = D.dims[view.dim];
    const cat = QD.aggregate(D, idx, view.measure, dim.arr, null, dim.K), cnt = QD.aggregate(D, idx, 'count', dim.arr, null, dim.K);
    D.zeros = D.zeros || new Uint8Array(N); const all = QD.aggregate(D, idx, view.measure, D.zeros, null, 1);
    const rows = [];
    for (let k = 0; k < dim.K; k++) if (cnt.value[k] > 0) rows.push({ name: dim.names[k], n: cnt.value[k], v: cat.value[k] });
    rows.sort((a, b) => (Number.isFinite(b.v) ? b.v : -Infinity) - (Number.isFinite(a.v) ? a.v : -Infinity));
    return { m, dim, rows, total: { name: 'All events in view', n: idx.length, v: idx.length ? all.value[0] : NaN } };
  }
  function renderSummary() {
    const { m, dim, rows, total } = summaryRows();
    $('tbl').querySelector('thead').innerHTML = `<tr><th style="cursor:default">${dim.label}</th><th class="r" style="cursor:default">Events</th><th class="r" style="cursor:default">% of events in view</th><th class="r" style="cursor:default">${m.label}</th></tr>`;
    const line = (r, bold) => `<tr${bold ? ' style="font-weight:700"' : ''}><td>${r.name}</td><td class="r">${fmtInt(r.n)}</td><td class="r">${idx.length ? fmtNum(r.n / idx.length * 100, 1) + '%' : '–'}</td><td class="r">${fmtMeasure(view.measure, r.v)}</td></tr>`;
    $('tbl').querySelector('tbody').innerHTML = idx.length ? rows.map((r) => line(r)).join('') + line(total, true) : '<tr><td colspan="4" class="empty">No events match the current filters.</td></tr>';
    $('pager').style.display = 'none';
    $('tblCap').textContent = `${m.label} by ${dim.label.toLowerCase()} for the ${fmtInt(idx.length)} events in the current view — the same numbers the charts above draw.` + (m.minN > 1 ? ` “—” = fewer than ${m.minN} events.` : '');
  }
  document.querySelectorAll('#segTbl button').forEach((b) => (b.onclick = () => {
    view.tbl = b.dataset.v; document.querySelectorAll('#segTbl button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (view.tbl === 'events') { buildEventsHead(); $('pager').style.display = ''; }
    renderTable();
  }));
  function sortRows() {
    const c = COLS.find((x) => x.k === view.sort.k);
    sorted = !c.key ? (view.sort.desc ? idx.slice().reverse() : idx) : QD.sortIdx(idx, c.key, c.max, view.sort.desc);
  }
  function renderTable() {
    if (view.tbl === 'summary') return renderSummary();
    document.querySelectorAll('#tbl th').forEach((th) => {
      const c = COLS.find((x) => x.k === th.dataset.k), on = view.sort.k === c.k;
      th.textContent = c.label + (on ? (view.sort.desc ? ' ▼' : ' ▲') : ''); th.classList.toggle('sorted', on);
    });
    const n = sorted.length, pages = Math.max(1, Math.ceil(n / PAGE)); view.page = Math.min(view.page, pages - 1);
    const a = view.page * PAGE, b = Math.min(n, a + PAGE), tb = $('tbl').querySelector('tbody'), det = D.details, rows = [];
    for (let j = a; j < b; j++) {
      const i = sorted[j], y = D.year[i];
      rows.push(`<tr><td>${fmtTime(D, i)}</td><td class="r"><b>${fmtNum(D.mag[i], D.raw_mag[i] % 10 ? 2 : 1)}</b></td><td class="r">${fmtNum(D.depth[i], 1)}</td><td title="${det ? det.place[i] : ''}">${det ? det.place[i] : '<span style="color:var(--muted)">loading…</span>'}</td>` +
        `<td>${regionOf(i)}</td><td>${QD.MTYPE_LABELS[D.raw_mtype[i]]}</td><td class="r">${D.sig[i]}</td><td>${y < QD.FLAG_START_YEAR ? '<span style="color:var(--muted)">n/a</span>' : D.raw_tsu[i] ? 'Flagged' : 'No'}</td>` +
        `<td>${det ? `<a href="https://earthquake.usgs.gov/earthquakes/eventpage/${det.id[i]}" target="_blank" rel="noopener">USGS ↗</a>` : ''}</td></tr>`);
    }
    tb.innerHTML = n ? rows.join('') : '<tr><td colspan="9" class="empty">No events match the current filters.</td></tr>';
    $('pageInfo').textContent = n ? `Rows ${fmtInt(a + 1)}–${fmtInt(b)} of ${fmtInt(n)}` : 'No rows';
    $('tblCap').textContent = `${fmtInt(n)} events in the current view, (tsunami flag: 2013+ only) sorted by ${COLS.find((x) => x.k === view.sort.k).label.toLowerCase()} (${view.sort.desc ? 'high to low' : 'low to high'}).`;
    $('prev').disabled = view.page === 0; $('next').disabled = view.page >= pages - 1;
  }
  $('prev').onclick = () => { view.page--; renderTable(); };
  $('next').onclick = () => { view.page++; renderTable(); };
  $('csv').onclick = async () => {
    if (view.tbl === 'summary') {
      const { m, dim, rows, total } = summaryRows(), q = (s) => `"${String(s).replace(/"/g, '""')}"`;
      const out = [[q(dim.label), 'events', 'pct_of_events_in_view', q(m.label)].join(',')].concat(rows.concat([total]).map((r) => [q(r.name), r.n, idx.length ? (r.n / idx.length * 100).toFixed(2) : '', Number.isFinite(r.v) ? r.v : ''].join(',')));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' })); a.download = 'earthquakes_summary_current_view.csv'; a.click(); URL.revokeObjectURL(a.href); return;
    }
    await QD.loadDetails(D);
    const det = D.details, q = (s) => `"${String(s).replace(/"/g, '""')}"`, out = ['id,time_utc,latitude,longitude,depth_km,magnitude,magnitude_type,significance,tsunami_flag_2013plus,country_region,place'];
    for (let j = 0; j < sorted.length; j++) {
      const i = sorted[j];
      out.push([det.id[i], fmtTime(D, i), D.lat[i], D.lon[i], D.depth[i], D.mag[i], QD.MTYPE_LABELS[D.raw_mtype[i]], D.sig[i], D.year[i] < QD.FLAG_START_YEAR ? '' : D.raw_tsu[i], q(regionOf(i)), q(det.place[i])].join(','));
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' })); a.download = 'earthquakes_current_view.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  // ===================================================================== plain-language summary of the filters
  function describeSelection() {
    const names = (set, arr) => [...set].sort((a, b) => a - b).map((k) => arr[k]);
    const list = (xs, noun) => (xs.length > 3 ? `${xs.length} ${noun}` : xs.join(', '));
    const parts = [`<b>${state.y0 === state.y1 ? state.y0 : state.y0 + '–' + state.y1}</b>`];
    parts.push(state.region.size ? `<b>${list(names(state.region, M.regions), 'regions')}</b>` : 'all countries and regions');
    if (state.macro.size) parts.push(`<b>${list(names(state.macro, M.macros), 'macro-regions')}</b>`);
    if (state.mclass.size) parts.push(`magnitude <b>${list(names(state.mclass, M.mclasses), 'classes')}</b>`);
    if (state.dclass.size) parts.push(`<b>${list(names(state.dclass, M.dclasses), 'depth classes')}</b>`);
    if (state.mtype.size) parts.push(`<b>${list(names(state.mtype, QD.MTYPE_LABELS), 'magnitude types')}</b>`);
    if (state.tsu !== 'all') parts.push(`tsunami flag: <b>${state.tsu === '1' ? 'flagged' : 'not flagged'}</b>`);
    $('selSummary').innerHTML = `Showing <b>${fmtInt(idx.length)}</b> earthquakes · ` + parts.join(' · ');
  }

  // ===================================================================== update loop
  let pending = 0;
  function schedule() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; update(); }); }
  function renderCharts() { syncMeasure(); syncBreak(); renderTime(); renderRank(); if (view.tbl === 'summary') renderTable(); }
  function update() {
    idx = QD.select(D, state);
    syncers.forEach((f) => f());
    renderTiles(); describeSelection();
    map.setEvents(idx, { yearRange: [state.y0, state.y1], colorBy: view.color }); legend();
    renderCharts(); renderHist(); renderHeat();
    sortRows(); view.page = 0; renderTable();
  }

  const filtersBox = $('filters'), mobile = matchMedia('(max-width: 900px)');
  const syncFilters = () => { if (!mobile.matches) filtersBox.open = true; };
  if (mobile.matches) filtersBox.open = false;
  mobile.addEventListener('change', syncFilters);

  update();
  $('loading').classList.add('done');
  QD.loadDetails(D).then(() => { renderTiles(); renderTable(); });
  window.__dash = { D, state, view, map, charts, get idx() { return idx; }, update };
})();
