// Dependency-free SVG charts: single-series line/area with crosshair tooltip, and horizontal bar list.
// Colors come from CSS variables (theme-owned); the series step is validated for the dark surface.

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const seriesColor = () => cssVar('--chart-series', '#2a78d6');
const inkColor = () => cssVar('--chart-ink', '#5b6472');
const gridColor = () => cssVar('--chart-grid', '#e2e8f1');
const strongInk = () => cssVar('--ink', '#10151f');
const registry = new Map();
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => registry.forEach(render => render()), 150); });
const remember = (container, render) => { registry.set(container, render); render(); };

const niceCeil = value => {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
};
const escapeChartText = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

// points: [{label, value}]. Single series - the panel title names it, so no legend.
function lineChart(container, points, { format = value => value.toLocaleString(), height = 220 } = {}) {
  remember(container, () => {
    if (!points.length) { container.innerHTML = '<p class="hint">No data matches these filters yet.</p>'; return; }
    if (points.length === 1) {
      container.innerHTML = `<div class="singlePoint"><small>${escapeChartText(points[0].label)}</small><strong>${format(points[0].value)}</strong><p class="hint">One period so far &mdash; the trend line appears once there are two or more months.</p></div>`;
      return;
    }
    const W = container.clientWidth || 600, H = height;
    const padL = 62, padR = 18, padT = 20, padB = 30;
    const max = niceCeil(Math.max(...points.map(p => p.value)));
    const x = i => padL + (W - padL - padR) * (i / (points.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - v / max);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
    const skip = Math.ceil(points.length / Math.max(3, Math.floor((W - padL - padR) / 70)));
    const xLabels = points.map((p, i) => (i % skip === 0 || i === points.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${inkColor()}">${escapeChartText(p.label)}</text>` : '').join('');
    const last = points[points.length - 1];
    container.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Monthly sales trend">
      ${ticks.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${gridColor()}" stroke-width="1"/><text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${inkColor()}">${t === 0 ? '0' : format(t)}</text>`).join('')}
      <path d="${area}" fill="${seriesColor()}" opacity="0.12" class="areaFill"/>
      <path class="linePath" d="${line}" fill="none" stroke="${seriesColor()}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="#ffffff" stroke="${seriesColor()}" stroke-width="2"/>`).join('')}
      <text x="${x(points.length - 1).toFixed(1)}" y="${(y(last.value) - 12).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="${strongInk()}">${format(last.value)}</text>
      ${xLabels}
      <line id="crosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="${inkColor()}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <circle id="crossdot" r="4.5" fill="${seriesColor()}" opacity="0"/>
    </svg><div class="chartTip" hidden></div>`;
    // Draw the line in once per render - interruptible (pure CSS transition, no JS timers).
    const path = container.querySelector('.linePath');
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    requestAnimationFrame(() => { path.style.transition = 'stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)'; path.style.strokeDashoffset = 0; });
    const svg = container.querySelector('svg');
    const tip = container.querySelector('.chartTip');
    const hair = container.querySelector('#crosshair');
    const dot = container.querySelector('#crossdot');
    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const index = Math.max(0, Math.min(points.length - 1, Math.round((relX - padL) / (W - padL - padR) * (points.length - 1))));
      const px = x(index), py = y(points[index].value);
      hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.setAttribute('opacity', '0.5');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('opacity', '1');
      tip.hidden = false;
      tip.innerHTML = `<b>${escapeChartText(points[index].label)}</b><span>${format(points[index].value)}</span>`;
      const tipX = Math.min(Math.max(px - 60, 4), W - 130);
      tip.style.left = `${tipX}px`;
      tip.style.top = '4px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
  });
}

// items: [{label, value, sub?}] ranked by position; one hue, values direct-labeled (never color-by-rank).
function barList(container, items, { format = value => value.toLocaleString(), max: maxOverride } = {}) {
  remember(container, () => {
    if (!items.length) { container.innerHTML = '<p class="hint">No data matches these filters yet.</p>'; return; }
    const max = maxOverride || Math.max(...items.map(item => item.value), 1);
    container.innerHTML = items.map(item => `
      <div class="barRow" title="${escapeChartText(item.label)} — ${escapeChartText(format(item.value))}${item.sub ? ` (${escapeChartText(item.sub)})` : ''}">
        <span class="barLabel">${escapeChartText(item.label)}</span>
        <div class="barTrack"><i style="width:${Math.max(2, item.value / max * 100).toFixed(1)}%"></i></div>
        <strong class="barValueCell">${escapeChartText(format(item.value))}</strong>
        ${item.sub ? `<small class="barSub">${escapeChartText(item.sub)}</small>` : ''}
      </div>`).join('');
  });
}

window.lineChart = lineChart;
window.barList = barList;
