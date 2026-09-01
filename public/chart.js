// React Bits Pro "Simple Graph" Adaptation
// High-performance SVG line graph with smooth cubic Bezier curves, animated line drawing,
// gradient area fill, glowing cursor tracking, and percentage difference calculations.

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

const niceCeil = value => {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value || 1)));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
};

// Generates smooth cubic Bezier path from a sequence of (x, y) coordinates
function buildBezierPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;

  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function lineChart(container, points, { format = value => value.toLocaleString(), height = 230 } = {}) {
  remember(container, () => {
    if (!points.length) {
      const W = container.clientWidth || 600, H = height;
      const padL = 62, padR = 18, padT = 20, padB = 30;
      container.classList.add('chartAnim');
      container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="No data yet">
        <line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="${gridColor()}" stroke-width="1"/>
        <text x="${padL - 8}" y="${H - padB + 4}" text-anchor="end" font-size="11" fill="${inkColor()}">0</text>
        <line class="lineDraw" pathLength="1" x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="${seriesColor()}" stroke-width="2.5" opacity="0.4"/>
        <text x="${(W + padL) / 2}" y="${(H - padB) / 2}" text-anchor="middle" font-size="13" fill="${inkColor()}">No sales in the current filter &#8212; try Reset in the period picker</text>
      </svg>`;
      return;
    }

    if (points.length === 1) {
      const W = container.clientWidth || 600, H = height;
      const padL = 62, padR = 18, padT = 20, padB = 30;
      const max = Math.max(niceCeil(points[0].value), 10);
      const px = padL + (W - padL - padR) / 2;
      const py = padT + (H - padT - padB) * (1 - points[0].value / max);
      const baseY = H - padB;
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);

      container.classList.add('chartAnim');
      container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Sales trend">
        ${ticks.map((t, ti) => `<g class="gridLine" style="animation-delay:${ti * 60}ms"><line x1="${padL}" x2="${W - padR}" y1="${(H - padB - t / max * (H - padT - padB)).toFixed(1)}" y2="${(H - padB - t / max * (H - padT - padB)).toFixed(1)}" stroke="${gridColor()}" stroke-width="1" stroke-dasharray="3 3"/><text x="${padL - 8}" y="${(H - padB - t / max * (H - padT - padB) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${inkColor()}">${t === 0 ? '0' : format(t)}</text></g>`).join('')}
        <line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${baseY.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${seriesColor()}" stroke-width="2.5" stroke-linecap="round"/>
        <line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="${seriesColor()}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
        <circle class="crossdot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="#fff" stroke="${seriesColor()}" stroke-width="3"/>
        <text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${inkColor()}">${escapeChartText(points[0].label)}</text>
      </svg><div class="simpleGraphTip chartTip"></div>`;

      const svg = container.querySelector('svg');
      const tip = container.querySelector('.chartTip');
      const hair = container.querySelector('.crosshair');

      svg.addEventListener('pointermove', () => {
        hair.setAttribute('x1', px);
        hair.setAttribute('x2', px);
        hair.setAttribute('opacity', '0.65');
        tip.classList.add('show');
        tip.innerHTML = `
          <div class="sgTipHead"><b>${escapeChartText(points[0].label)}</b></div>
          <span class="sgTipVal">${format(points[0].value)}</span>
        `;
        const tipX = Math.min(Math.max(px - 70, 8), W - 150);
        const tipY = py < 70 ? (py + 16) : (py - 68);
        tip.style.left = `${tipX}px`;
        tip.style.top = `${Math.max(4, Math.min(tipY, H - 70))}px`;
      });

      svg.addEventListener('pointerleave', () => {
        tip.classList.remove('show');
        hair.setAttribute('opacity', '0');
      });
      return;
    }

    const W = container.clientWidth || 600, H = height;
    const padL = 62, padR = 18, padT = 52, padB = 32;
    const values = points.map(p => p.value);
    const loRaw = Math.min(...values), hiRaw = Math.max(...values);
    const pad = Math.max((hiRaw - loRaw) * 0.05, hiRaw * 0.05, 1);
    const lo = Math.max(0, loRaw - pad), hi = hiRaw + pad;

    const getX = i => padL + (W - padL - padR) * (i / (points.length - 1));
    const getY = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

    const coordPoints = points.map((p, i) => ({ x: getX(i), y: getY(p.value), value: p.value, label: p.label }));
    const curveD = buildBezierPath(coordPoints);
    const baseline = getY(Math.max(lo, 0));
    const lastX = coordPoints[coordPoints.length - 1].x;
    const firstX = coordPoints[0].x;
    const areaD = `${curveD} L ${lastX.toFixed(1)},${baseline.toFixed(1)} L ${firstX.toFixed(1)},${baseline.toFixed(1)} Z`;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => lo + t * (hi - lo));
    const skip = Math.ceil(points.length / Math.max(3, Math.floor((W - padL - padR) / 88)));
    const xLabels = points.map((p, i) => (i % skip === 0 || i === points.length - 1) ? `<text x="${getX(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${inkColor()}">${escapeChartText(p.label)}</text>` : '').join('');

    const lastPt = coordPoints[coordPoints.length - 1];
    const gradId = `sgGradient_${Math.random().toString(36).substr(2, 9)}`;

    container.classList.add('chartAnim');
    container.innerHTML = `
      <svg width="${W}" height="${H}" role="img" aria-label="Sales trend" style="overflow:visible">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${seriesColor()}" stop-opacity="0.32" />
            <stop offset="60%" stop-color="${seriesColor()}" stop-opacity="0.10" />
            <stop offset="100%" stop-color="${seriesColor()}" stop-opacity="0.0" />
          </linearGradient>
          <filter id="sgGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        ${ticks.map((t, ti) => `<g class="gridLine" style="animation-delay:${ti * 50}ms">
          <line x1="${padL}" x2="${W - padR}" y1="${getY(t).toFixed(1)}" y2="${getY(t).toFixed(1)}" stroke="${gridColor()}" stroke-width="1" stroke-dasharray="3 3"/>
          <text x="${padL - 8}" y="${(getY(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${inkColor()}">${format(Math.round(t))}</text>
        </g>`).join('')}

        <path class="areaFill" d="${areaD}" fill="url(#${gradId})" />
        <path class="lineDraw" pathLength="1" d="${curveD}" fill="none" stroke="${seriesColor()}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />

        ${coordPoints.map(p => `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#fff" stroke="${seriesColor()}" stroke-width="2"/>
        `).join('')}

        <circle class="endPulse" cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="4.5" fill="${seriesColor()}"/>
        <text x="${lastPt.x.toFixed(1)}" y="${(lastPt.y < 44 ? lastPt.y + 20 : lastPt.y - 12).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="${strongInk()}">${format(lastPt.value)}</text>

        ${xLabels}

        <line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" opacity="0" stroke="${seriesColor()}" stroke-width="1.5" stroke-dasharray="4 3"/>
        <circle class="crossdot" r="6" opacity="0" fill="${seriesColor()}" stroke="#fff" stroke-width="2.5" filter="url(#sgGlow)"/>
      </svg>
      <div class="chartTip simpleGraphTip"></div>
    `;

    const svg = container.querySelector('svg');
    const tip = container.querySelector('.chartTip');
    const hair = container.querySelector('.crosshair');
    const dot = container.querySelector('.crossdot');

    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      const relX = (event.clientX - rect.left) * (W / rect.width);
      const index = Math.max(0, Math.min(points.length - 1, Math.round((relX - padL) / (W - padL - padR) * (points.length - 1))));
      const curr = coordPoints[index];

      // Percentage difference calculation vs previous month
      let diffHtml = '';
      if (index > 0) {
        const prev = coordPoints[index - 1];
        if (prev.value > 0) {
          const diffPct = ((curr.value - prev.value) / prev.value) * 100;
          const isUp = diffPct >= 0;
          diffHtml = `<span class="sgDiff ${isUp ? 'up' : 'down'}">${isUp ? '▲ +' : '▼ '}${Math.abs(diffPct).toFixed(1)}%</span>`;
        }
      }

      hair.setAttribute('x1', curr.x);
      hair.setAttribute('x2', curr.x);
      hair.setAttribute('y1', curr.y);
      hair.setAttribute('y2', H - padB);
      hair.setAttribute('opacity', '0.65');

      dot.setAttribute('cx', curr.x);
      dot.setAttribute('cy', curr.y);
      dot.setAttribute('opacity', '1');

      tip.classList.add('show');
      tip.innerHTML = `
        <div class="sgTipHead">
          <b>${escapeChartText(curr.label)}</b>
          ${diffHtml}
        </div>
        <span class="sgTipVal">${format(curr.value)}</span>
      `;

      const tipX = Math.min(Math.max(curr.x - 70, 8), W - 150);
      tip.style.left = `${tipX}px`;
      tip.style.top = '6px';
    });

    svg.addEventListener('pointerleave', () => {
      tip.classList.remove('show');
      hair.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
    });
  });
}

function barList(container, items, { format = value => value.toLocaleString(), max: maxOverride, indexes = false } = {}) {
  remember(container, () => {
    if (!items.length) { container.innerHTML = '<p class="hint">No data matches these filters yet.</p>'; return; }
    const max = maxOverride || Math.max(...items.map(item => item.value), 1);
    container.innerHTML = items.map((item, i) => `
      <div class="barRow${indexes ? ' indexed' : ''}" title="${escapeChartText(item.label)} — ${escapeChartText(format(item.value))}${item.sub ? ` (${escapeChartText(item.sub)})` : ''}">
        <span class="barLabel">${indexes ? `<span class="barIndexInline">${i + 1}</span>` : ''}${escapeChartText(item.label)}</span>
        <div class="barTrack"><i style="width:${Math.max(2, item.value / max * 100).toFixed(1)}%"></i></div>
        <strong class="barValueCell">${escapeChartText(format(item.value))}</strong>
        ${item.sub ? `<small class="barSub${indexes ? ' indentedSub' : ''}">${escapeChartText(item.sub)}</small>` : ''}
      </div>`).join('');
  });
}

window.lineChart = lineChart;
window.barList = barList;
