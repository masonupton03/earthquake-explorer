/* QuakeMap: canvas world map (D3 projection) that draws up to ~225k events, with time animation,
   pan/zoom, and hover lookup. Three stacked canvases: background (land), dots, effects (rings/hover). */
(function (root) {
  'use strict';
  const { COLORS } = root.QD;

  const radius = (mag, k) => (0.8 + (mag - 4.5) * 0.9) * (1 + Math.min(k - 1, 8) * 0.12);

  class QuakeMap {
    constructor(el, D, world, opts = {}) {
      this.el = el; this.D = D; this.opts = opts; el.classList.add('qmap');
      this.idx = new Uint32Array(0); this.colorBy = 'depth';
      this.cursor = 0; this.range = [0, 1]; this.simT = 0; this.mode = 'build'; this.playing = false;
      this.speed = 1; this.tf = { k: 1, x: 0, y: 0 }; this.rings = []; this.hover = -1; this.onProgress = null; this.onHover = null;
      this.land = topojson.feature(world, world.objects.countries);
      this.borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
      this.bg = this._canvas(); this.dots = this._canvas(); this.fx = this._canvas();
      if (opts.hud !== false) {
        this.hud = document.createElement('div'); this.hud.className = 'hud';
        this.hud.innerHTML = '<div class="yr"></div><div class="ct"></div>'; el.appendChild(this.hud);
      }
      if (opts.zoom) this._initZoom();
      this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(el);
      this.pinned = -1; this._mkInfo();
      this.fx.addEventListener('mousemove', (e) => this._move(e));
      this.fx.addEventListener('mouseleave', () => { this.hover = -1; this._drawFx(); this._showTip(-1); });
      this.fx.addEventListener('click', (e) => this._click(e));
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.unpin(); });
      this.resize();
    }

    _canvas() { const c = document.createElement('canvas'); this.el.appendChild(c); return c; }

    resize() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h; this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [this.bg, this.dots, this.fx]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); }
      this.proj = d3.geoEqualEarth().fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
      const D = this.D, n = D.n;
      if (!this.px || this.px.length !== n) { this.px = new Float32Array(n); this.py = new Float32Array(n); }
      for (let i = 0; i < n; i++) { const p = this.proj([D.lon[i], D.lat[i]]); this.px[i] = p[0]; this.py[i] = p[1]; }
      if (this._zoom) this._zoom.extent([[0, 0], [w, h]]).translateExtent([[0, 0], [w, h]]);
      this.redraw();
    }

    // ---- data -------------------------------------------------------------------------------
    setEvents(idx, { yearRange, colorBy } = {}) {
      this.pause(); this.unpin();
      this.idx = idx; if (colorBy) this.colorBy = colorBy;
      if (yearRange) this.range = [(Date.UTC(yearRange[0], 0, 1) - QD.EPOCH0_MS) / 1000, (Date.UTC(yearRange[1] + 1, 0, 1) - QD.EPOCH0_MS) / 1000];
      this.showAll();
    }
    setColorBy(c) { this.colorBy = c; this.redraw(); }
    setMode(m) { this.mode = m; }

    // ---- drawing --------------------------------------------------------------------------------
    _colors() { return this.colorBy === 'mag' ? COLORS.mag : COLORS.depth; }
    _cls(i) { return this.colorBy === 'mag' ? this.D.magClass[i] : this.D.depthClass[i]; }

    redraw() { if (!this.w) return; this._drawBg(); this._drawDotsTo(this.cursor); this._drawFx(); this._hud(); }

    _drawBg() {
      const ctx = this.bg.getContext('2d'), { k, x, y } = this.tf, d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
      ctx.setTransform(d * k, 0, 0, d * k, d * x, d * y);
      const path = d3.geoPath(this.proj, ctx), sph = { type: 'Sphere' };
      const g = ctx.createLinearGradient(0, 0, 0, this.h); g.addColorStop(0, '#0f1626'); g.addColorStop(1, '#0a0f1b');
      ctx.beginPath(); path(sph); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = 'rgba(120,150,200,.07)'; ctx.lineWidth = 0.6 / k; ctx.stroke();
      ctx.beginPath(); path(this.land); ctx.fillStyle = '#1b2336'; ctx.fill();
      ctx.beginPath(); path(this.borders); ctx.strokeStyle = 'rgba(140,165,210,.16)'; ctx.lineWidth = 0.5 / k; ctx.stroke();
      ctx.beginPath(); path(this.land); ctx.strokeStyle = 'rgba(150,175,220,.28)'; ctx.lineWidth = 0.6 / k; ctx.stroke();
      ctx.beginPath(); path(sph); ctx.strokeStyle = 'rgba(150,175,220,.25)'; ctx.lineWidth = 1 / k; ctx.stroke();
    }

    _prep(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; }

    _drawDotsTo(cursor) {
      const ctx = this.dots.getContext('2d'); this._prep(ctx); ctx.clearRect(0, 0, this.w, this.h);
      const cols = this._colors(), idx = this.idx, a = idx.length > 60000 ? 0.5 : 0.7;
      const cls = this.colorBy === 'mag' ? this.D.magClass : this.D.depthClass, D = this.D, nc = this.colorBy === 'mag' ? 4 : 3;
      for (const big of [false, true]) {                      // small events first, M6+ on top; within a pass the rarer classes go on top
        for (let c = 0; c < nc; c++) for (let j = 0; j < cursor; j++) { const i = idx[j]; if (cls[i] === c && (D.mag[i] >= 6) === big) this._dotc(ctx, i, a, cols); }
      }
      ctx.globalAlpha = 1;
    }
    _dotc(ctx, i, alpha, cols) {
      const { k, x, y } = this.tf, D = this.D;
      const px = this.px[i] * k + x, py = this.py[i] * k + y;
      if (px < -8 || py < -8 || px > this.w + 8 || py > this.h + 8) return;
      const m = D.mag[i], r = radius(m, k);
      ctx.fillStyle = cols[this._cls(i)];
      if (m >= 6) {
        ctx.globalAlpha = Math.min(1, alpha + 0.3);
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill();
        if (m >= 7) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke(); }
      } else {
        ctx.globalAlpha = alpha;
        if (r < 1.7) ctx.fillRect(px - r, py - r, 2 * r, 2 * r); else { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill(); }
      }
    }

    _drawFx(now) {
      const ctx = this.fx.getContext('2d'); this._prep(ctx); ctx.clearRect(0, 0, this.w, this.h);
      const { k, x, y } = this.tf; now = now || performance.now();
      this.rings = this.rings.filter((r) => now - r.born < 1400);
      for (const r of this.rings) {
        const age = (now - r.born) / 1400, rad = 4 + age * (10 + (r.mag - 5.5) * 16), px = this.px[r.i] * k + x, py = this.py[r.i] * k + y;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, 6.2832);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - age)})`; ctx.lineWidth = 1.6 * (1 - age) + 0.4; ctx.stroke();
      }
      if (this.pinned >= 0) {
        const i = this.pinned, px = this.px[i] * k + x, py = this.py[i] * k + y, r = radius(this.D.mag[i], k) + 5;
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.strokeStyle = '#d95926'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      if (this.hover >= 0) {
        const i = this.hover, px = this.px[i] * k + x, py = this.py[i] * k + y;
        ctx.beginPath(); ctx.arc(px, py, radius(this.D.mag[i], k) + 4, 0, 6.2832); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    _hud() {
      if (!this.hud) return;
      const ms = QD.EPOCH0_MS + this.simT * 1000, dt = new Date(ms);
      const atEnd = this.cursor >= this.idx.length && !this.playing;
      const yEnd = new Date(QD.EPOCH0_MS + this.range[1] * 1000 - 1000).getUTCFullYear();
      this.hud.querySelector('.yr').textContent = atEnd ? (this._yr0 === yEnd ? yEnd : `${this._yr0}–${yEnd}`) : dt.getUTCFullYear();
      this.hud.querySelector('.ct').textContent = `${this.cursor.toLocaleString('en-US')} of ${this.idx.length.toLocaleString('en-US')} events`;
    }

    // ---- animation -------------------------------------------------------------------------------------
    showAll() {
      this.cursor = this.idx.length; this.simT = this.range[1]; this._yr0 = new Date(QD.EPOCH0_MS + this.range[0] * 1000).getUTCFullYear();
      this.rings = []; this.redraw(); this._progress();
    }
    seek(f) {
      this.pause(); this.simT = this.range[0] + f * (this.range[1] - this.range[0]);
      this.cursor = this._upper(this.simT); this.rings = []; this.redraw(); this._progress(true);
    }
    _upper(t) { let lo = 0, hi = this.idx.length; const T = this.D.t, idx = this.idx; while (lo < hi) { const m = (lo + hi) >> 1; if (T[idx[m]] <= t) lo = m + 1; else hi = m; } return lo; }
    _progress(fromSeek) { this.onProgress && this.onProgress((this.simT - this.range[0]) / (this.range[1] - this.range[0] || 1), this.playing, fromSeek); }

    play() {
      if (!this.idx.length || this.playing) return;
      if (this.cursor >= this.idx.length || this.simT >= this.range[1]) { this.simT = this.range[0]; this.cursor = 0; this.rings = []; this._drawDotsTo(0); }
      this.playing = true; this._last = performance.now();
      const spanYears = (this.range[1] - this.range[0]) / 31557600;
      this._rate = (this.range[1] - this.range[0]) / Math.min(26, Math.max(6, spanYears * 0.75));    // sim seconds per real second at 1x
      cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame((t) => this._tick(t)); this._progress();
    }
    restart() {                                              // always begins again from the first year, even mid-animation
      this.pause(); this.simT = this.range[0]; this.cursor = 0; this.rings = []; this._drawDotsTo(0); this.hover = -1; this.unpin(); this.play();
    }
    pause() { this.playing = false; cancelAnimationFrame(this._raf); this._progress(); }
    toggle() { this.playing ? this.pause() : this.play(); }

    _tick(now) {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
      this.simT = Math.min(this.range[1], this.simT + this._rate * this.speed * dt);
      const end = this._upper(this.simT), ctx = this.dots.getContext('2d'), cols = this._colors(), a = this.mode === 'pulse' ? 0.9 : (this.idx.length > 60000 ? 0.5 : 0.7);
      this._prep(ctx);
      if (this.mode === 'pulse') {                            // fade older events so only recent activity glows
        ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / 0.7)})`; ctx.fillRect(0, 0, this.w, this.h); ctx.globalCompositeOperation = 'source-over';
      }
      const D = this.D;
      for (let j = this.cursor; j < end; j++) {
        const i = this.idx[j]; this._dotc(ctx, i, a, cols);
        if (D.mag[i] >= (this.mode === 'pulse' ? 6 : 7) && this.rings.length < 80) this.rings.push({ i, mag: D.mag[i], born: now });
      }
      ctx.globalAlpha = 1; this.cursor = end;
      this._drawFx(now); this._hud(); this._progress();
      if (this.simT >= this.range[1]) { this.playing = false; this.showAll(); return; }
      this._raf = requestAnimationFrame((t) => this._tick(t));
    }

    // ---- hover / zoom ----------------------------------------------------------------------------------------
    // nearest drawn event to a pointer position (px = CSS pixels inside the map), or -1
    _hit(mx, my, tol) {
      const { k, x, y } = this.tf, D = this.D, idx = this.idx; let best = -1, bd = 1e9;
      for (let j = 0; j < this.cursor; j++) {
        const i = idx[j], dx = this.px[i] * k + x - mx; if (dx > tol || dx < -tol) continue;
        const dy = this.py[i] * k + y - my; if (dy > tol || dy < -tol) continue;
        const d = dx * dx + dy * dy - D.mag[i] * 3; if (d < bd) { bd = d; best = i; }
      }
      return bd > tol * tol + 20 ? -1 : best;
    }
    _local(e) { const r = this.fx.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    _move(e) {
      if (!this._warm) { this._warm = true; QD.loadDetails(this.D).then(() => { if (this.hover >= 0) this._showTip(this.hover, this._lx, this._ly); if (this.pinned >= 0) this._card(this.pinned); }); }
      const [mx, my] = this._local(e); this._lx = mx; this._ly = my;
      if (this._raf2) return;
      this._raf2 = requestAnimationFrame(() => {
        this._raf2 = 0; const i = this._hit(this._lx, this._ly, 9);
        if (i !== this.hover) { this.hover = i; this._drawFx(); }
        this.fx.style.cursor = i >= 0 ? 'pointer' : '';
        this._showTip(i, this._lx, this._ly);
      });
    }
    _click(e) {
      const [mx, my] = this._local(e), i = this._hit(mx, my, 14);
      if (i >= 0) this.pin(i); else this.unpin();
    }

    // ---- event information: hover tooltip + click-to-pin card (shared by both pages) ----------------
    _mkInfo() {
      this.tip = document.createElement('div'); this.tip.className = 'qtip'; this.el.appendChild(this.tip);
      this.card = document.createElement('div'); this.card.className = 'qcard'; this.el.appendChild(this.card);
      this.card.addEventListener('click', (e) => { if (e.target.closest('.x')) this.unpin(); e.stopPropagation(); });
    }
    _info(i) {
      const D = this.D, det = D.details, esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const region = det ? det.rf_names[det.rf[i]] : D.meta.regions[D.raw_region[i]];
      return { title: `M${QD.fmtNum(D.mag[i], D.raw_mag[i] % 10 ? 2 : 1)} · ${QD.fmtNum(D.depth[i], 1)} km deep`, place: det ? esc(det.place[i]) : esc(region), time: QD.fmtTime(D, i) + ' UTC',
        region: esc(region), type: QD.MTYPE_LABELS[D.raw_mtype[i]], url: det ? `https://earthquake.usgs.gov/earthquakes/eventpage/${det.id[i]}` : null };
    }
    _showTip(i, mx, my) {
      const t = this.tip;
      if (i < 0 || i === this.pinned) { t.style.display = 'none'; return; }
      const f = this._info(i);
      t.innerHTML = `<b>${f.title}</b><span>${f.place}</span><span>${f.time}</span><em>Click for details</em>`;
      t.style.display = 'block';
      const tw = t.offsetWidth, th = t.offsetHeight;
      t.style.left = Math.max(6, Math.min(mx + 14, this.w - tw - 6)) + 'px';
      t.style.top = (my + 16 + th > this.h ? Math.max(6, my - th - 12) : my + 16) + 'px';
    }
    _card(i) {
      const f = this._info(i), c = this.card;
      c.innerHTML = `<button type="button" class="x" aria-label="Close">×</button><b>${f.title}</b><span>${f.place}</span><span>${f.time}</span><span>${f.region} · ${f.type}</span>` +
        (f.url ? `<a href="${f.url}" target="_blank" rel="noopener">Open USGS event page ↗</a>` : '<em>Loading event details…</em>');
      c.style.display = 'block';
    }
    pin(i) { this.pinned = i; this.hover = -1; this._showTip(-1); this._card(i); this._drawFx(); QD.loadDetails(this.D).then(() => { if (this.pinned === i) this._card(i); }); }
    unpin() { if (this.pinned < 0 && this.card.style.display !== 'block') return; this.pinned = -1; this.card.style.display = 'none'; this._drawFx(); }

    _initZoom() {
      const z = document.createElement('div'); z.className = 'zoom';
      z.innerHTML = '<button type="button" title="Zoom in" aria-label="Zoom in">+</button><button type="button" title="Zoom out" aria-label="Zoom out">−</button><button type="button" title="Reset view" aria-label="Reset view">⟲</button>';
      this.el.appendChild(z);
      this._zoom = d3.zoom().scaleExtent([1, 14]).filter((e) => (e.type !== 'wheel' || e.ctrlKey) && !e.button)
        .on('zoom', (e) => { this.tf = { k: e.transform.k, x: e.transform.x, y: e.transform.y }; if (!this._zr) this._zr = requestAnimationFrame(() => { this._zr = 0; this.redraw(); }); });
      const sel = d3.select(this.fx); sel.call(this._zoom).on('dblclick.zoom', null);
      const b = z.querySelectorAll('button');
      b[0].onclick = () => sel.transition().duration(250).call(this._zoom.scaleBy, 1.8);
      b[1].onclick = () => sel.transition().duration(250).call(this._zoom.scaleBy, 1 / 1.8);
      b[2].onclick = () => sel.transition().duration(250).call(this._zoom.transform, d3.zoomIdentity);
    }
  }
  root.QuakeMap = QuakeMap;
})(window);
