/* Small "i" help tooltips. Any element with a data-tip attribute gets one tooltip (event delegation, so elements added later work too).
   Mouse: hover shows it. Touch / keyboard: tap or Enter toggles it; tapping elsewhere or pressing Escape closes it. */
(function () {
  'use strict';
  const tip = document.createElement('div');
  tip.id = 'infotip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  let current = null, pinned = false;

  function show(el) {
    current = el; tip.textContent = el.dataset.tip; tip.hidden = false;
    el.setAttribute('aria-describedby', 'infotip');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    const top = r.bottom + 8 + h > innerHeight && r.top - h - 8 > 0 ? r.top - h - 8 : r.bottom + 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    el.setAttribute('aria-expanded', 'true');
  }
  function hide() {
    if (current) { current.removeAttribute('aria-describedby'); current.setAttribute('aria-expanded', 'false'); }
    tip.hidden = true; current = null; pinned = false;
  }
  const target = (e) => (e.target.closest ? e.target.closest('[data-tip]') : null);

  document.addEventListener('mouseover', (e) => { const el = target(e); if (el && !pinned) show(el); });
  document.addEventListener('mouseout', (e) => { const el = target(e); if (el && !pinned && !el.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el && !pinned) show(el); });
  document.addEventListener('focusout', (e) => { const el = target(e); if (el && !pinned) hide(); });
  document.addEventListener('click', (e) => {
    const el = target(e);
    if (!el) { if (current) hide(); return; }
    e.preventDefault(); e.stopPropagation();                // an info button inside a clickable control must not trigger that control
    if (pinned && current === el) hide(); else { if (current !== el) show(el); pinned = true; }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) hide(); });
  addEventListener('scroll', () => { if (current) hide(); }, { passive: true });
  addEventListener('resize', hide);
})();
