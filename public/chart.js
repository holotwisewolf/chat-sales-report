// Dependency-free SVG charts following the house chart system: CSS-keyframe draw-on (pathLength),
// staged timeline (grid -> line -> area -> endpoint pulse), hairline grid, ~6 x-labels, dark sharp
// tooltip, relative y-domain. Series color is a validated step for the light glass surface.

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const seriesColor = () => cssVar('--chart-series', '#2a78d6');
const inkColor = () => cssVar('--chart-ink', '#545e6e');
const gridColor = () => cssVar('--chart-grid', '#d3dbe7');
const strongInk = () => cssVar('--ink', '#10151f');
const registry = new Map();
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => registry.forEach(render => render()), 150); });
const remember = (container, render) => { registry.set(container, render); render(); };

const escapeChartText = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

// Round an axis maximum up to a pleasant number (1/2/2.5/5 x powers of ten).
const niceCeil = value => {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value || 1)));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
};

// points: [{label, value}]. Single series - the panel title names it, so no legend.
function lineChart(container, points, { format = value => value.toLocaleString(), height = 220 } = {}) {
  remember(container, () => {
    if (!points.length) {
      // No data still gets a real chart: empty axes with a flat line drawn along the baseline.
      const W = container.clientWidth || 600, H = height;
      const padL = 62, padR = 18, padT = 20, padB = 30;
      container.classList.add('chartAnim');
      container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="No data yet">
        <line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="${gridColor()}" stroke-width="1"/>
        <text x="${padL - 8}" y="${H - padB + 4}" text-anchor="end" font-size="11" fill="${inkColor()}">0</text>
        <line class="lineDraw" pathLength="1" x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="${seriesColor()}" stroke-width="2" opacity="0.4"/>
        <text x="${(W + padL) / 2}" y="${(H - padB) / 2}" text-anchor="middle" font-size="13" fill="${inkColor()}">No data for these filters yet</text>
      </svg>`;
      return;
    }
    if (points.length === 1) {
      // One month still gets a real chart: full axes with the value plotted as a point.
      const W = container.clientWidth || 600, H = height;
      const padL = 62, padR = 18, padT = 20, padB = 30;
      const max = niceCeil(points[0].value);
      const px = padL + (W - padL - padR) / 2;
      const py = padT + (H - padT - padB) * (1 - points[0].value / max);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
      container.classList.add('chartAnim');
      container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly sales">
        ${ticks.map((t, ti) => `<g class="gridLine" style="animation-delay:${ti * 60}ms"><line x1="${padL}" x2="${W - padR}" y1="${(H - padB - t / max * (H - padT - padB)).toFixed(1)}" y2="${(H - padB - t / max * (H - padT - padB)).toFixed(1)}" stroke="${gridColor()}" stroke-width="1"/><text x="${padL - 8}" y="${(H - padB - t / max * (H - padT - padB) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${inkColor()}">${t === 0 ? '0' : format(t)}</text></g>`).join('')}
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="#fff" stroke="${seriesColor()}" stroke-width="2.5"/>
        <circle class="endPulse" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${seriesColor()}"/>
        <text x="${px.toFixed(1)}" y="${(py - 14).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${strongInk()}">${format(points[0].value)}</text>
        <text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${inkColor()}">${escapeChartText(points[0].label)}</text>
        <text x="${(W - padR + padL) / 2}" y="${padT + 10}" text-anchor="middle" font-size="11" fill="${inkColor()}">One month so far &#8212; the line appears with two or more months</text>
      </svg>`;
      return;
    }
    const W = container.clientWidth || 600, H = height;
    const padL = 62, padR = 18, padT = 20, padB = 30;
    const values = points.map(p => p.value);
    // Relative domain: data min/max padded 2%, floored at zero (sales magnitude stays readable).
    const loRaw = Math.min(...values), hiRaw = Math.max(...values);
    const pad = Math.max((hiRaw - loRaw) * 0.02, hiRaw * 0.02, 1);
    const lo = Math.max(0, loRaw - pad), hi = hiRaw + pad;
    const x = i => padL + (W - padL - padR) * (i / (points.length - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const baseline = y(Math.max(lo, 0));
    const area = `${line} L${x(points.length - 1).toFixed(1)},${baseline.toFixed(1)} L${x(0).toFixed(1)},${baseline.toFixed(1)} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => lo + t * (hi - lo));
    const skip = Math.ceil(points.length / Math.max(3, Math.floor((W - padL - padR) / 92)));
    const xLabels = points.map((p, i) => (i % skip === 0 || i === points.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${inkColor()}">${escapeChartText(p.label)}</text>` : '').join('');
    const last = points[points.length - 1];
    container.classList.add('chartAnim');
    container.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Sales trend">
      ${ticks.map((t, ti) => `<g class="gridLine" style="animation-delay:${ti * 60}ms"><line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${gridColor()}" stroke-width="1"/><text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${inkColor()}">${t.toFixed(0) === t ? format(t) : ''}</text></g>`).join('')}
      <path class="areaFill" d="${area}" fill="${seriesColor()}" fill-opacity="0.18"/>
      <path class="lineDraw" pathLength="1" d="${line}" fill="none" stroke="${seriesColor()}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="#fff" stroke="${seriesColor()}" stroke-width="1.5"/>`).join('')}
      <circle class="endPulse" cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4" fill="${seriesColor()}"/>
      <text x="${x(points.length - 1).toFixed(1)}" y="${(y(last.value) - 12).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="${strongInk()}">${format(last.value)}</text>
      ${xLabels}
      <line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" opacity="0"/>
      <circle class="crossdot" r="4.5" opacity="0"/>
    </svg><div class="chartTip"></div>`;
    const svg = container.querySelector('svg');
    const tip = container.querySelector('.chartTip');
    const hair = container.querySelector('.crosshair');
    const dot = container.querySelector('.crossdot');
    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      // The SVG scales to its pane; map the on-screen x into the coordinate space it was drawn with.
      const relX = (event.clientX - rect.left) * (W / rect.width);
      const index = Math.max(0, Math.min(points.length - 1, Math.round((relX - padL) / (W - padL - padR) * (points.length - 1))));
      const px = x(index), py = y(points[index].value);
      hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.setAttribute('opacity', '0.55');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('opacity', '1');
      tip.classList.add('show');
      tip.innerHTML = `<b>${escapeChartText(points[index].label)}</b><span>${format(points[index].value)}</span>`;
      tip.style.left = `${Math.min(Math.max(px - 62, 4), W - 140)}px`;
      tip.style.top = '4px';
    });
    svg.addEventListener('pointerleave', () => { tip.classList.remove('show'); hair.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
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
