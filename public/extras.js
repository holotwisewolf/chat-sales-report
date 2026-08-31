// Chart carousel and quick-action dock - vanilla ports of the React Bits patterns (no build step).
const $extra = selector => document.querySelector(selector);

// Carousel: horizontal panes you can drag or click through, with dot indicators.
(function carousel() {
  const track = $extra('#carouselTrack');
  const dots = $extra('#carouselDots');
  if (!track || !dots) return;
  const panes = () => [...track.children];
  let index = 0;
  let dragStart = null;
  let dragDelta = 0;

  const render = () => {
    track.style.transform = `translateX(${-index * 100}%)`;
    dots.innerHTML = panes().map((_, i) => `<button type="button" class="carouselDot ${i === index ? 'on' : ''}" data-pane="${i}" aria-label="Show graph ${i + 1}"></button>`).join('');
  };
  dots.onclick = event => { const pane = event.target.dataset?.pane; if (pane !== undefined) { index = Number(pane); render(); } };

  track.addEventListener('pointerdown', event => {
    dragStart = event.clientX;
    dragDelta = 0;
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener('pointermove', event => {
    if (dragStart === null) return;
    dragDelta = event.clientX - dragStart;
    track.style.transform = `translateX(calc(${-index * 100}% + ${dragDelta}px))`;
  });
  const release = () => {
    if (dragStart === null) return;
    const width = track.clientWidth || 1;
    if (dragDelta < -width / 5 && index < panes().length - 1) index++;
    else if (dragDelta > width / 5 && index > 0) index--;
    dragStart = null;
    track.style.transition = 'transform .35s cubic-bezier(.2,.8,.2,1)';
    render();
    setTimeout(() => { track.style.transition = ''; }, 380);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  render();
})();

// Dock: floating glass quick-action bar with hover magnification and labels.
// It hides below the screen edge and slides up when the pointer nears the bottom.
(function dock() {
  const dockEl = $extra('.dock');
  if (!dockEl) return;
  const zone = document.createElement('div');
  zone.className = 'dockZone';
  // The dock lives INSIDE the zone: hovering the dock itself must count as hovering the zone,
  // otherwise the dock pops up, steals the pointer, "leaves" the zone, and flickers forever.
  document.body.appendChild(zone);
  zone.appendChild(dockEl);
  let hideTimer;
  zone.addEventListener('pointerenter', () => { clearTimeout(hideTimer); dockEl.classList.add('show'); });
  zone.addEventListener('pointerleave', () => { hideTimer = setTimeout(() => dockEl.classList.remove('show'), 250); });
  const actions = {
    upload: () => window.openUpload?.(),
    ask: () => window.openChat?.(),
    charts: () => {
      const section = $extra('#collCharts');
      if (!section) return;
      section.classList.remove('closed');
      localStorage.setItem('collapsible-collCharts', 'open');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    manual: () => window.openManual?.(),
    undo: () => window.undo?.()
  };

  let autoHideTimer = null;
  window.revealDock = (duration = 4500) => {
    clearTimeout(hideTimer);
    clearTimeout(autoHideTimer);
    dockEl.classList.add('show');
    if (duration > 0) {
      autoHideTimer = setTimeout(() => {
        // Only hide if pointer is not hovering the zone
        if (!zone.matches(':hover')) dockEl.classList.remove('show');
      }, duration);
    }
  };

  // The dock's Undo item is greyed out with nothing to undo - it teaches that undo exists.
  window.updateUndoDock = () => {
    const item = dockEl.querySelector('[data-action="undo"]');
    if (item) {
      const count = window.undoCount ? window.undoCount() : 0;
      if (count > 0) {
        item.removeAttribute('data-disabled');
      } else {
        item.setAttribute('data-disabled', '1');
      }
      item.querySelector('.dockLabel').textContent = count ? `Undo (${count})` : 'Undo';
    }
  };
  window.updateUndoDock();
  dockEl.addEventListener('click', event => {
    const item = event.target.closest('.dockItem');
    if (item && !item.hasAttribute('data-disabled')) actions[item.dataset.action]?.();
  });
  // Proximity magnification: nearest items grow as the pointer sweeps across the dock.
  dockEl.addEventListener('pointermove', event => {
    dockEl.querySelectorAll('.dockItem').forEach(item => {
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
      const grow = Math.max(0, 1 - distance / 130);
      item.style.transform = `scale(${1 + grow * 0.28}) translateY(${-grow * 7}px)`;
    });
  });
  dockEl.addEventListener('pointerleave', () => {
    dockEl.querySelectorAll('.dockItem').forEach(item => { item.style.transform = ''; });
  });
})();
