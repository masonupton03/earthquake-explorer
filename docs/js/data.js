/* Data loading, filtering and aggregation. Pure functions over typed arrays; no DOM here.
   Loaded as a classic script (browser) and also by Node for the validation test. */
(function (root) {
  'use strict';

  // ---- palette (validated for the dark surface; see README) -------------------------------
  const COLORS = {
    cat: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'], // fixed order, slots 1-7
    other: '#6b7686',
    depth: ['#d95926', '#199e70', '#3987e5'],            // shallow, intermediate, deep
    mag: ['#256abf', '#3987e5', '#86b6ef', '#cde2fb'],   // ordinal ramp: bigger = lighter on dark
    mtype: ['#9085e9', '#c98500', '#6b7686'],            // mb, Mw, other
  };
  const EPOCH0_MS = Date.UTC(1990, 0, 1);
  const FLAG_START_YEAR = 2013;

  async function loadData(base = 'data/') {
    const [meta, buf] = await Promise.all([
      fetch(base + 'meta.json').then((r) => r.json()),
      fetch(base + 'quakes.bin').then((r) => r.arrayBuffer()),
    ]);
    return build(meta, buf);
  }

  function build(meta, buf) {
    const Ctor = { '<i4': Int32Array, '<i2': Int16Array, '<u2': Uint16Array, u1: Uint8Array };
    const n = meta.n;
    const D = { meta, n, details: null };
    for (const c of meta.columns) D['raw_' + c.name] = new Ctor[c.dtype](buf, c.offset, n);
    D.t = D.raw_t;                                   // seconds since 1990-01-01 UTC, ascending
    D.year = new Uint16Array(n);
    D.lat = new Float32Array(n); D.lon = new Float32Array(n);
    D.mag = new Float64Array(n); D.depth = new Float64Array(n); D.energy = new Float64Array(n);
    D.magClass = new Uint8Array(n); D.depthClass = new Uint8Array(n);
    D.sig = D.raw_sig;
    for (let i = 0; i < n; i++) {
      D.year[i] = D.raw_year[i] + 1990;
      D.lat[i] = D.raw_lat[i] / 100; D.lon[i] = D.raw_lon[i] / 100;
      const m = D.raw_mag[i] / 100, d = D.raw_depth[i] / 10;
      D.mag[i] = m; D.depth[i] = d;
      D.energy[i] = Math.pow(10, 1.5 * m + 4.8);
      D.magClass[i] = m < 5 ? 0 : m < 6 ? 1 : m < 7 ? 2 : 3;
      D.depthClass[i] = d < 70 ? 0 : d < 300 ? 1 : 2;
    }
    D.totalEnergy = 0; for (let i = 0; i < n; i++) D.totalEnergy += D.energy[i];
    D.dims = buildDims(D);
    return D;
  }

  // Lazy-load place text / ids (10 MB JSON) so the page is interactive first.
  function loadDetails(D, base = 'data/') {
    if (!D.detailsPromise) {
      D.detailsPromise = fetch(base + 'details.json').then((r) => r.json()).then((j) => { D.details = j; return j; });
    }
    return D.detailsPromise;
  }

  // ---- breakdown dimensions ----------------------------------------------------------------
  // series: what the stacked/line charts draw. High-cardinality dims fold everything past the
  // top 7 into "Other" so the categorical palette is never cycled.
  function buildDims(D) {
    const m = D.meta, fold = (names, K, top) => {
      const lookup = new Uint8Array(K); const sn = names.slice(0, top).concat(['Other']);
      for (let k = 0; k < K; k++) lookup[k] = k < top && names[k] !== 'All other regions' ? k : top;
      return { lookup, names: sn, colors: COLORS.cat.slice(0, top).concat([COLORS.other]) };
    };
    const ident = (names, colors) => ({ lookup: Uint8Array.from(names.map((_, i) => i)), names, colors });
    return {
      depth: { id: 'depth', label: 'Depth class', filter: 'dclass', arr: D.depthClass, names: m.dclasses, K: 3, series: ident(m.dclasses, COLORS.depth) },
      mag: { id: 'mag', label: 'Magnitude class', filter: 'mclass', arr: D.magClass, names: m.mclasses, K: 4, series: ident(m.mclasses, COLORS.mag) },
      region: { id: 'region', label: 'Country / region', filter: 'region', arr: D.raw_region, names: m.regions, K: m.regions.length, series: fold(m.regions, m.regions.length, 7), rankExclude: m.regions.length - 1 },
      macro: { id: 'macro', label: 'Macro-region', filter: 'macro', arr: D.raw_macro, names: m.macros, K: m.macros.length, series: fold(m.macros, m.macros.length, 7) },
      mtype: { id: 'mtype', label: 'Magnitude type', filter: 'mtype', arr: D.raw_mtype, names: m.mtypes, K: 3, series: ident(m.mtypes, COLORS.mtype) },
    };
  }

  // ---- filter state --------------------------------------------------------------------------
  function newState() {
    return { y0: 1990, y1: 2025, region: new Set(), macro: new Set(), mclass: new Set(), dclass: new Set(), mtype: new Set(), tsu: 'all' };
  }
  const setMask = (set, K) => { if (!set.size) return null; const m = new Uint8Array(K); set.forEach((k) => (m[k] = 1)); return m; };

  // Returns Uint32Array of selected event indices (ascending time).
  function select(D, s) {
    const out = new Uint32Array(D.n); let k = 0;
    const rg = setMask(s.region, 256), mc = setMask(s.macro, 256), mg = setMask(s.mclass, 4), dc = setMask(s.dclass, 3), mt = setMask(s.mtype, 4);
    const tsu = s.tsu === 'all' ? -1 : +s.tsu;
    const { year, raw_region, raw_macro, magClass, depthClass, raw_mtype, raw_tsu } = D;
    for (let i = 0; i < D.n; i++) {
      const y = year[i];
      if (y < s.y0 || y > s.y1) continue;
      if (rg && !rg[raw_region[i]]) continue;
      if (mc && !mc[raw_macro[i]]) continue;
      if (mg && !mg[magClass[i]]) continue;
      if (dc && !dc[depthClass[i]]) continue;
      if (mt && !mt[raw_mtype[i]]) continue;
      if (tsu >= 0 && raw_tsu[i] !== tsu) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  // ---- measures --------------------------------------------------------------------------------
  // additive measures can be stacked; the others are drawn as one line per category.
  const MEASURES = {
    count: { id: 'count', label: 'Event count', axis: 'Events', additive: true, minN: 1 },
    avgmag: { id: 'avgmag', label: 'Average magnitude', axis: 'Average magnitude', additive: false, minN: 5, dp: 2 },
    maxmag: { id: 'maxmag', label: 'Maximum magnitude', axis: 'Maximum magnitude', additive: false, minN: 1, dp: 1 },
    energy: { id: 'energy', label: 'Total energy', axis: 'Total energy (PJ)', additive: true, minN: 1 },
    avgdepth: { id: 'avgdepth', label: 'Average depth', axis: 'Average depth (km)', additive: false, minN: 5, dp: 1 },
    avgsig: { id: 'avgsig', label: 'Average significance', axis: 'Average significance', additive: false, minN: 5, dp: 0 },
  };

  // Aggregate `measure` over `idx`, grouped by key arrays. Returns {value, count} of length K*K2
  // (cell = k2*K + k). value is NaN for empty cells and for cells below the measure's minimum N.
  function aggregate(D, idx, measure, keyArr, lookup, K, k2Arr, K2, k2Off) {
    const size = K * (K2 || 1);
    const cnt = new Float64Array(size), sum = new Float64Array(size), max = new Float64Array(size).fill(-Infinity);
    const val = { count: null, avgmag: D.mag, maxmag: D.mag, energy: D.energy, avgdepth: D.depth, avgsig: D.sig }[measure];
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j];
      const g = (k2Arr ? (k2Arr[i] - (k2Off || 0)) * K : 0) + (lookup ? lookup[keyArr[i]] : keyArr[i]);
      cnt[g]++;
      if (val) { const v = val[i]; sum[g] += v; if (v > max[g]) max[g] = v; }
    }
    const minN = MEASURES[measure].minN, value = new Float64Array(size);
    for (let g = 0; g < size; g++) {
      if (cnt[g] < minN) { value[g] = NaN; continue; }
      value[g] = measure === 'count' ? cnt[g] : measure === 'energy' ? sum[g] / 1e15 : measure === 'maxmag' ? max[g] : sum[g] / cnt[g];
    }
    return { value, count: cnt };
  }

  // ---- summary numbers ---------------------------------------------------------------------------
  function summarize(D, idx) {
    const n = idx.length;
    const out = { n, m6: 0, avgMag: NaN, medMag: NaN, medDepth: NaN, energy: 0, energyShare: 0, strongest: -1, flagged: 0, shallow: 0 };
    if (!n) return out;
    const magBins = new Uint32Array(1000), depBins = new Uint32Array(7100);
    let sumMag = 0, best = -1, bestMag = -1;
    for (let j = 0; j < n; j++) {
      const i = idx[j], rm = D.raw_mag[i];
      sumMag += D.mag[i]; out.energy += D.energy[i];
      if (rm >= 600) out.m6++;
      if (rm > bestMag) { bestMag = rm; best = i; }          // first (earliest) event wins ties
      magBins[rm]++; depBins[D.raw_depth[i]]++;
      if (D.raw_tsu[i]) out.flagged++;
      if (D.depthClass[i] === 0) out.shallow++;
    }
    out.avgMag = sumMag / n;
    out.medMag = medianFromBins(magBins, n) / 100;
    out.medDepth = medianFromBins(depBins, n) / 10;
    out.energyShare = out.energy / D.totalEnergy * 100;
    out.strongest = best;
    return out;
  }
  // Median of integer-binned values; averages the two middle values for even n (same as pandas).
  function medianFromBins(bins, n) {
    const lo = Math.floor((n - 1) / 2), hi = Math.floor(n / 2);
    let c = 0, a = -1, b = -1;
    for (let v = 0; v < bins.length; v++) {
      c += bins[v];
      if (a < 0 && c > lo) a = v;
      if (c > hi) { b = v; break; }
    }
    return (a + b) / 2;
  }

  // ---- stable counting sort of idx by an integer key (O(n)) ---------------------------------------------
  function sortIdx(idx, keyArr, maxKey, desc) {
    const cnt = new Uint32Array(maxKey + 2);
    for (let j = 0; j < idx.length; j++) cnt[(desc ? maxKey - keyArr[idx[j]] : keyArr[idx[j]]) + 1]++;
    for (let k = 1; k < cnt.length; k++) cnt[k] += cnt[k - 1];
    const out = new Uint32Array(idx.length);
    for (let j = 0; j < idx.length; j++) out[cnt[desc ? maxKey - keyArr[idx[j]] : keyArr[idx[j]]]++] = idx[j];
    return out;
  }

  // ---- formatting ---------------------------------------------------------------------------------------
  const fmtInt = (x) => Math.round(x).toLocaleString('en-US');
  const fmtNum = (x, dp = 1) => (Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—');
  const fmtEnergy = (pj) => (pj >= 1000 ? fmtNum(pj / 1000, 2) + ' EJ' : pj >= 1 ? fmtNum(pj, 1) + ' PJ' : pj > 0 ? fmtNum(pj * 1000, 1) + ' TJ' : '0 PJ');
  const fmtTime = (D, i) => new Date(EPOCH0_MS + D.t[i] * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const fmtMeasure = (id, v) => {
    if (!Number.isFinite(v)) return '—';
    if (id === 'count') return fmtInt(v);
    if (id === 'energy') return fmtEnergy(v);
    return fmtNum(v, MEASURES[id].dp);
  };

  const api = { COLORS, EPOCH0_MS, FLAG_START_YEAR, MEASURES, loadData, loadDetails, build, newState, select, aggregate, summarize, sortIdx, medianFromBins, fmtInt, fmtNum, fmtEnergy, fmtTime, fmtMeasure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QD = api;
})(typeof window !== 'undefined' ? window : globalThis);
