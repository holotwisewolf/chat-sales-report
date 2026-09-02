// TimesFM AI Sales Forecasting & Trend Intelligence Frontend
(function() {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => document.querySelectorAll(selector);

  // State
  let currentHorizon = 6;
  let currentScenario = 'baseline';
  let currentConfidence = 0.90;
  let lastData = null;

  // Formatting helpers
  const money = n => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(n || 0);
  const money2 = n => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const formatNum = n => Number(n || 0).toLocaleString();
  const escapeHtml = value => String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

  // Switch between Dashboard and Forecast views
  window.switchView = function(viewName) {
    const dashboardView = $('#dashboardView');
    const forecastView = $('#forecastView');
    const navBtn = $('#navForecastBtn');
    const navLabel = $('#navForecastLabel');
    const pageTitle = $('#pageTitle');
    const brandEyebrow = $('#brandEyebrow');

    if (viewName === 'forecast') {
      dashboardView.hidden = true;
      forecastView.hidden = false;
      if (navBtn) {
        navBtn.classList.remove('secondary');
        navBtn.classList.add('on');
      }
      if (navLabel) navLabel.textContent = 'Back to Dashboard';
      if (pageTitle) pageTitle.textContent = 'Sales Forecast';
      if (brandEyebrow) brandEyebrow.textContent = 'TIMESFM PREDICTIONS';
      location.hash = 'forecast';

      // Update active dock item
      $$('.dockItem').forEach(b => b.classList.toggle('active', b.dataset.action === 'forecast'));

      // Populate filter dropdowns from main options if empty
      populateForecastFilters();
      loadForecastData();
    } else {
      forecastView.hidden = true;
      dashboardView.hidden = false;
      if (navBtn) {
        navBtn.classList.add('secondary');
        navBtn.classList.remove('on');
      }
      if (navLabel) navLabel.textContent = 'Sales Forecast';
      if (pageTitle) pageTitle.textContent = 'Sales dashboard';
      if (brandEyebrow) brandEyebrow.textContent = 'SALES REPORTS';
      location.hash = 'dashboard';

      // Update active dock item
      $$('.dockItem').forEach(b => b.classList.toggle('active', b.dataset.action === 'charts'));
    }
  };

  // Name shortener helper for clean dropdown layout
  function formatCompactName(name, maxLength = 26) {
    if (!name) return '';
    let clean = String(name)
      .replace(/\s+/g, ' ')
      .replace(/HYPERMARKET/gi, 'HYPER')
      .replace(/DEPARTMENT STORE/gi, 'DEPT')
      .replace(/GROUND FLOOR/gi, 'GF')
      .replace(/SHOPPING CENTRE|SHOPPING CENTER/gi, 'SC')
      .replace(/SHOPPING MALL/gi, 'MALL')
      .trim();
    if (clean.length > maxLength) {
      return clean.slice(0, maxLength - 1) + '…';
    }
    return clean;
  }

  // Custom Animated Select Helper for Forecast Dropdowns
  function setupForecastSelect(selectId, wrapId, btnId, menuId, defaultLabel, onChangeCallback) {
    const select = document.querySelector(selectId);
    const wrap = document.querySelector(wrapId);
    const btn = document.querySelector(btnId);
    const menu = document.querySelector(menuId);
    if (!select || !wrap || !btn || !menu) return;

    const updateDisplay = () => {
      const selectedOption = select.options[select.selectedIndex];
      const label = selectedOption && selectedOption.value ? formatCompactName(selectedOption.text, 22) : defaultLabel;
      const labelSpan = btn.querySelector('.customSelectLabel');
      if (labelSpan) labelSpan.textContent = label;
    };

    const syncMenuOptions = () => {
      menu.innerHTML = [...select.options].map(opt => `
        <button type="button" class="customSelectItem ${opt.selected ? 'active' : ''}" data-value="${escapeHtml(opt.value)}" title="${escapeHtml(opt.text)}">
          <span>${escapeHtml(formatCompactName(opt.text, 30))}</span>
          ${opt.selected ? '<span class="customSelectCheck">&#10003;</span>' : ''}
        </button>
      `).join('');
    };

    // Close on outside click
    document.addEventListener('pointerdown', e => {
      if (!wrap.contains(e.target) && !menu.hidden) {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('open');
        wrap.classList.remove('open');
      }
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      // Close other dropdowns
      document.querySelectorAll('.customSelectMenu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.customSelectBtn').forEach(b => { b.setAttribute('aria-expanded', 'false'); b.classList.remove('open'); });
      document.querySelectorAll('.customSelectWrap').forEach(w => { w.classList.remove('open'); });

      if (willOpen) {
        syncMenuOptions();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('open');
        wrap.classList.add('open');
      }
    });

    menu.addEventListener('click', e => {
      const item = e.target.closest('.customSelectItem');
      if (!item) return;
      const val = item.dataset.value;
      select.value = val;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateDisplay();
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('open');
      wrap.classList.remove('open');
      if (typeof onChangeCallback === 'function') {
        onChangeCallback(val);
      }
    });

    // Observe changes to underlying select element
    select.addEventListener('change', updateDisplay);
    const observer = new MutationObserver(() => {
      updateDisplay();
      syncMenuOptions();
    });
    observer.observe(select, { childList: true, subtree: true });
    updateDisplay();
  }

  // Populate forecast filters directly from API
  async function populateForecastFilters() {
    const retailerSel = $('#fRetailer');
    const categorySel = $('#fCategory');
    const counterSel = $('#fCounter');

    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) return;
      const data = await res.json();
      const options = data.options || {};

      if (retailerSel && options.retailers) {
        const cur = retailerSel.value;
        retailerSel.innerHTML = '<option value="">All retailers</option>' + 
          options.retailers.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
        if (cur) retailerSel.value = cur;
        retailerSel.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (categorySel && options.categories) {
        const cur = categorySel.value;
        categorySel.innerHTML = '<option value="">All categories</option>' + 
          options.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (cur) categorySel.value = cur;
        categorySel.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (counterSel && options.counters) {
        const cur = counterSel.value;
        counterSel.innerHTML = '<option value="">All counters</option>' + 
          options.counters.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (cur) counterSel.value = cur;
        counterSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      console.warn('Failed to populate forecast filters:', e);
    }
  }

  // In-memory client-side forecast cache
  const forecastCache = new Map();
  window.clearForecastCache = () => {
    forecastCache.clear();
  };

  function syncTargetEvaluation(data) {
    const targetInput = $('#targetAmountInput');
    if (targetInput && (!targetInput.value || Number(targetInput.value) <= 0)) {
      const defaultTarget = Math.round((data.summary?.total_projected_sales || 100000) * 1.1 / 1000) * 1000;
      targetInput.value = defaultTarget;
      evaluateTargetGap(defaultTarget);
    } else if (targetInput && targetInput.value) {
      evaluateTargetGap(Number(targetInput.value));
    }
  }

  // Load forecast data from API (cached on client to prevent redundant requests)
  async function loadForecastData() {
    const retailer = $('#fRetailer')?.value || '';
    const counter = $('#fCounter')?.value || '';
    const category = $('#fCategory')?.value || '';

    const params = new URLSearchParams({
      retailer,
      counter,
      category,
      horizon: currentHorizon,
      confidence: currentConfidence,
      scenario: currentScenario
    });

    const cacheKey = params.toString();

    // Check memory cache first
    if (forecastCache.has(cacheKey)) {
      const data = forecastCache.get(cacheKey);
      lastData = data;
      renderForecastKPIs(data);
      renderForecastChart(data);
      renderChannelContributions(data);
      renderAnomalies(data);
      renderForecastTable(data);
      syncTargetEvaluation(data);
      return;
    }

    try {
      const res = await fetch(`/api/forecast?${params}`);
      if (!res.ok) throw new Error('Forecast API returned status ' + res.status);
      const data = await res.json();
      
      forecastCache.set(cacheKey, data);
      lastData = data;

      renderForecastKPIs(data);
      renderForecastChart(data);
      renderChannelContributions(data);
      renderAnomalies(data);
      renderForecastTable(data);
      syncTargetEvaluation(data);
    } catch (err) {
      console.error('Failed to load forecast:', err);
    }
  }

  // Render KPI Bento Cards with explicit date timeframe
  function renderForecastKPIs(data) {
    const summary = data.summary || {};
    const forecastSeries = data.forecast || [];
    const startPeriod = forecastSeries[0]?.period || '';
    const endPeriod = forecastSeries[forecastSeries.length - 1]?.period || '';
    const horizonCount = forecastSeries.length || currentHorizon;
    const timeframeLabel = startPeriod && endPeriod ? `${startPeriod} – ${endPeriod}` : `Next ${horizonCount} Months`;

    $('#fStatSales').textContent = money(summary.total_projected_sales);
    
    const growthEl = $('#fStatGrowth');
    const growth = summary.growth_rate_pct || 0;
    growthEl.innerHTML = `
      <span class="${growth >= 0 ? 'badgeOk' : 'badgeWarn'}">${growth >= 0 ? '+' : ''}${growth}% vs previous</span>
      <span class="timeframeBadge">${timeframeLabel}</span>
    `;

    $('#fStatUnits').textContent = formatNum(summary.total_projected_units);
    $('#fStatAvgMonthly').textContent = `Avg ${money(summary.average_monthly_sales)} / mo (${timeframeLabel})`;

    const peakMonth = summary.peak_month || '—';
    $('#fStatPeak').textContent = peakMonth;
    $('#fStatPeakSales').textContent = `Projected ${money(summary.peak_sales)}`;

    const volatility = summary.volatility_index || 0;
    $('#fStatVolatility').textContent = `±${volatility}% Volatility`;
    const confidencePct = Math.round((summary.confidence_level || 0.9) * 100);
    $('#fStatRange').textContent = `${confidencePct}% Confidence Band`;

    if (data.model && $('#fModelBadge')) {
      $('#fModelBadge').textContent = data.model;
    }
  }

  // Smooth Cubic Bezier Path Builder
  function buildSmoothBezier(points) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    if (points.length === 2) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;

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

  // Bezier path generator for connecting two bezier curves (like confidence band envelope)
  function buildBandEnvelopePath(topPoints, bottomPoints) {
    if (!topPoints || !topPoints.length || !bottomPoints || !bottomPoints.length) return '';
    const topPathD = buildSmoothBezier(topPoints);
    
    // Bottom points in reverse
    const revBottom = [...bottomPoints].reverse();
    if (revBottom.length === 1) {
      return `${topPathD} L ${revBottom[0].x.toFixed(1)},${revBottom[0].y.toFixed(1)} Z`;
    }

    let bottomD = ` L ${revBottom[0].x.toFixed(1)},${revBottom[0].y.toFixed(1)}`;
    for (let i = 0; i < revBottom.length - 1; i++) {
      const p0 = revBottom[i === 0 ? i : i - 1];
      const p1 = revBottom[i];
      const p2 = revBottom[i + 1];
      const p3 = revBottom[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      bottomD += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return `${topPathD} ${bottomD} Z`;
  }

  // Render Interactive Forecast SVG Chart with Smooth Bezier Confidence Envelope
  function renderForecastChart(data) {
    const container = $('#forecastSvgContainer');
    if (!container) return;

    const hist = data.historical || [];
    const pred = data.forecast || [];

    if (!hist.length && !pred.length) {
      container.innerHTML = '<div class="chartEmpty">No forecast series data available</div>';
      return;
    }

    const W = container.clientWidth || 860;
    const H = 340;
    const padL = 60, padR = 40, padT = 30, padB = 40;

    // Combine points for timeline
    const allPoints = [];
    hist.forEach(h => allPoints.push({ period: h.period, sales: Number(h.sales) || 0, isForecast: false, units: h.units }));
    pred.forEach(p => allPoints.push({ 
      period: p.period, 
      sales: Number(p.display_sales || p.sales || p.p50) || 0, 
      p10: Number(p.p10) || 0,
      p50: Number(p.p50) || 0,
      p90: Number(p.p90) || 0,
      growth_pct: p.growth_pct,
      isForecast: true, 
      units: p.units 
    }));

    // Find max value including upper confidence bounds
    const maxVal = Math.max(
      ...allPoints.map(p => p.p90 || p.sales),
      1000
    ) * 1.15;

    const numPoints = allPoints.length;
    const stepX = (W - padL - padR) / Math.max(1, numPoints - 1);

    const getX = i => padL + i * stepX;
    const getY = val => padT + (H - padT - padB) * (1 - Math.max(0, val) / maxVal);

    // Build historical coordinates
    const histPoints = [];
    for (let i = 0; i < hist.length; i++) {
      histPoints.push({ x: getX(i), y: getY(allPoints[i].sales), p: allPoints[i] });
    }

    // Build forecast coordinates (starts at last historical point for smooth continuous curve)
    const forecastPoints = [];
    if (hist.length > 0) {
      forecastPoints.push({ x: getX(hist.length - 1), y: getY(allPoints[hist.length - 1].sales), p: allPoints[hist.length - 1] });
    }
    for (let i = hist.length; i < numPoints; i++) {
      forecastPoints.push({ x: getX(i), y: getY(allPoints[i].sales), p: allPoints[i] });
    }

    // Build smooth confidence interval envelope (P10 to P90)
    let bandPathD = '';
    if (pred.length > 0) {
      const bandTopPoints = [];
      const bandBottomPoints = [];
      
      // Start band at last historical point
      if (hist.length > 0) {
        const lastHistX = getX(hist.length - 1);
        const lastHistY = getY(allPoints[hist.length - 1].sales);
        bandTopPoints.push({ x: lastHistX, y: lastHistY });
        bandBottomPoints.push({ x: lastHistX, y: lastHistY });
      }

      for (let i = hist.length; i < numPoints; i++) {
        const pt = allPoints[i];
        const x = getX(i);
        bandTopPoints.push({ x, y: getY(pt.p90) });
        bandBottomPoints.push({ x, y: getY(pt.p10) });
      }

      bandPathD = buildBandEnvelopePath(bandTopPoints, bandBottomPoints);
    }

    // Smooth Bezier Line Paths
    const histPathD = buildSmoothBezier(histPoints);
    const forecastPathD = buildSmoothBezier(forecastPoints);

    // Y Grid Ticks
    const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(t => t * maxVal);

    // Vertical Divider X for "Today / Forecast Horizon"
    const splitX = hist.length > 0 ? getX(hist.length - 1) : padL;

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" class="forecastSvg">
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.32"/>
            <stop offset="50%" stop-color="#8b5cf6" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0.06"/>
          </linearGradient>
          <filter id="forecastGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <!-- Y Axis Grid Lines -->
        ${ticks.map(t => `
          <g class="fGridLine">
            <line x1="${padL}" x2="${W - padR}" y1="${getY(t).toFixed(1)}" y2="${getY(t).toFixed(1)}" stroke="var(--hair)" stroke-width="1" stroke-dasharray="4 4"/>
            <text x="${padL - 10}" y="${(getY(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink2)">${t === 0 ? 'RM 0' : money(t)}</text>
          </g>
        `).join('')}

        <!-- Vertical Boundary: Historical vs Forecast -->
        <line x1="${splitX.toFixed(1)}" x2="${splitX.toFixed(1)}" y1="${padT}" y2="${H - padB}" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.6"/>
        <text x="${splitX.toFixed(1)}" y="${padT - 8}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#8b5cf6" letter-spacing="0.05em">PROJECTION START</text>

        <!-- Shaded Smooth Confidence Interval Envelope (P10 - P90) -->
        ${bandPathD ? `<path d="${bandPathD}" fill="url(#bandGrad)" class="forecastBandAnim" />` : ''}

        <!-- Historical Smooth Bezier Line -->
        ${histPathD ? `<path d="${histPathD}" fill="none" stroke="#0b57c7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lineDraw" pathLength="1" />` : ''}

        <!-- Forecast Smooth Bezier Dotted/Glowing Line -->
        ${forecastPathD ? `<path d="${forecastPathD}" fill="none" stroke="#7c3aed" stroke-width="3.2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" class="forecastLineGlow" filter="url(#forecastGlow)" />` : ''}

        <!-- Data Point Circles -->
        ${allPoints.map((pt, i) => {
          const cx = getX(i);
          const cy = getY(pt.sales);
          if (pt.isForecast) {
            return `
              <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="#fff" stroke="#7c3aed" stroke-width="2.5" class="fDataDot forecastDot" data-idx="${i}"/>
            `;
          } else {
            return `
              <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="#fff" stroke="#0b57c7" stroke-width="2.5" class="fDataDot histDot" data-idx="${i}"/>
            `;
          }
        }).join('')}

        <!-- X Axis Labels -->
        ${allPoints.map((pt, i) => `
          <text x="${getX(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" font-weight="${pt.isForecast ? '650' : '500'}" fill="${pt.isForecast ? '#7c3aed' : 'var(--ink2)'}">
            ${escapeHtml(pt.period)}
          </text>
        `).join('')}

        <!-- Cursor Crosshair Line and Highlight Dot -->
        <line id="fCrosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="2 2" opacity="0"/>
        <circle id="fCrossTarget" cx="0" cy="0" r="7" fill="none" stroke="#7c3aed" stroke-width="2.5" opacity="0"/>
      </svg>
    `;

    // Interactive crosshair & tooltip
    setupForecastChartHover(container, allPoints, getX, getY, W, H);
  }

  // Interactive Continuous Hover Handler for Monthly Forecast Chart
  function setupForecastChartHover(container, points, getX, getY, W, H) {
    const svg = container.querySelector('svg');
    const tip = $('#forecastChartTip');
    const crosshair = container.querySelector('#fCrosshair');
    const crossTarget = container.querySelector('#fCrossTarget');
    if (!svg || !tip || !crosshair) return;

    const numPoints = points.length;
    const padL = getX(0);
    const padR = W - getX(numPoints - 1);
    const stepX = (W - padL - padR) / Math.max(1, numPoints - 1);

    svg.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W;
      const clampedX = Math.max(padL, Math.min(W - padR, mouseX));

      // Continuous fluid vertical crosshair line tracking
      crosshair.setAttribute('x1', clampedX.toFixed(1));
      crosshair.setAttribute('x2', clampedX.toFixed(1));
      crosshair.setAttribute('opacity', '0.65');

      // Find nearest data point
      let closestIdx = 0;
      let minDist = Infinity;
      points.forEach((pt, idx) => {
        const px = getX(idx);
        const dist = Math.abs(clampedX - px);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });

      const pt = points[closestIdx];

      // Continuous curve height interpolation
      const fracIdx = (clampedX - padL) / stepX;
      const i0 = Math.max(0, Math.min(numPoints - 1, Math.floor(fracIdx)));
      const i1 = Math.min(numPoints - 1, i0 + 1);
      const t = fracIdx - i0;
      const smoothT = (1 - Math.cos(t * Math.PI)) / 2;
      const interpSales = points[i0].sales + (points[i1].sales - points[i0].sales) * smoothT;
      const interpY = getY(interpSales);

      if (crossTarget) {
        crossTarget.setAttribute('cx', clampedX.toFixed(1));
        crossTarget.setAttribute('cy', interpY.toFixed(1));
        crossTarget.setAttribute('stroke', pt.isForecast ? '#7c3aed' : '#0b57c7');
        crossTarget.setAttribute('opacity', '1');
      }

      tip.hidden = false;
      tip.style.display = 'block';

      if (pt.isForecast) {
        tip.innerHTML = `
          <div class="fTipVal fTipPurple">${money2(pt.sales)} <span class="fTipSub">(${formatNum(pt.units)} pairs)</span></div>
          ${pt.p90 ? `<div class="fTipBoundLine">UB: <b>${money(pt.p90)}</b></div>` : ''}
          ${pt.p10 ? `<div class="fTipBoundLine">LB: <b>${money(pt.p10)}</b></div>` : ''}
        `;
      } else {
        tip.innerHTML = `
          <div class="fTipVal fTipBlue">${money2(pt.sales)} <span class="fTipSub">(${formatNum(pt.units)} pairs)</span></div>
        `;
      }

      const tipWidth = 150;
      const leftPos = Math.min(Math.max(clampedX - tipWidth / 2, 10), W - tipWidth - 10);
      tip.style.left = `${(leftPos / W) * 100}%`;
      tip.style.top = '12px';
      tip.style.cursor = pt.isForecast ? 'pointer' : 'default';
      svg.style.cursor = pt.isForecast ? 'pointer' : 'default';
      tip.dataset.currentIdx = String(closestIdx);
    });

    svg.addEventListener('pointerleave', () => {
      crosshair.setAttribute('opacity', '0');
      if (crossTarget) crossTarget.setAttribute('opacity', '0');
      svg.style.cursor = 'default';
      tip.hidden = true;
      tip.style.display = 'none';
    });

    // Clicking a projected dot or its tooltip opens the drilldown modal.
    // Historical (actual) dots are read-only — no modal.
    svg.addEventListener('click', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W;

      let closestIdx = 0;
      let minDist = Infinity;
      points.forEach((pt, idx) => {
        const px = getX(idx);
        const dist = Math.abs(mouseX - px);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });
      const clicked = points[closestIdx];
      if (clicked && clicked.isForecast) {
        openForecastDrilldownModal(clicked, points);
      }
    });

    tip.addEventListener('click', () => {
      const idx = parseInt(tip.dataset.currentIdx || '0', 10);
      const clicked = points[idx] || points[0];
      if (clicked && clicked.isForecast) {
        openForecastDrilldownModal(clicked, points);
      }
    });
  }

  // Open Drilldown Overlay Modal (Exact visual layout from screenshot)
  function openForecastDrilldownModal(pt, allPoints) {
    const modal = $('#forecastModalOverlay');
    if (!modal || !pt) return;

    modal.hidden = false;
    modal.style.display = 'flex';

    // Populate Top Header for that specific month
    const eyebrow = $('#fModalEyebrow');
    if (eyebrow) eyebrow.textContent = `Sales Projection • ${pt.period}`;

    const mSales = $('#fModalSales');
    if (mSales) mSales.textContent = money(pt.sales);

    const mUnits = $('#fModalUnits');
    if (mUnits) mUnits.textContent = `${formatNum(pt.units)} pairs`;

    const mPeriod = $('#fModalPeriod');
    if (mPeriod) mPeriod.textContent = `${pt.isForecast ? 'TimesFM Projected' : 'Recorded Actual'} ${pt.growth_pct != null ? `(${pt.growth_pct >= 0 ? '+' : ''}${pt.growth_pct}% MoM)` : ''}`;

    // Populate Bottom 3 Bento Cards for that specific month
    const bLb = $('#fBentoLb');
    if (bLb) bLb.textContent = pt.p10 ? money(pt.p10) : money(pt.sales * 0.88);

    const bP50 = $('#fBentoP50');
    if (bP50) bP50.textContent = money(pt.sales);

    const bUb = $('#fBentoUb');
    if (bUb) bUb.textContent = pt.p90 ? money(pt.p90) : money(pt.sales * 1.12);

    // Render Confidence Envelope & Wave Curve in Modal
    renderModalSparkline(pt, allPoints);

    // Setup Close Listeners
    const modalCloseBtn = $('#fModalCloseBtn');
    const modalBackdrop = $('#forecastModalBackdrop');
    const closeModal = () => {
      modal.hidden = true;
      modal.style.display = 'none';
    };
    if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
    if (modalBackdrop) modalBackdrop.onclick = closeModal;
  }

  // Generate realistic synthetic daily breakdown for a selected forecast month
  // The month's P50/P10/P90 are distributed across each day with a random-walk ripple
  function buildDailyPoints(pt) {
    const period = pt.period || '';
    const [yr, mo] = period.split('-').map(Number);
    const daysInMonth = new Date(yr || 2026, (mo || 9), 0).getDate() || 30;
    const monthlyP50 = pt.p50 || pt.sales || 0;
    const monthlyP90 = pt.p90 || monthlyP50 * 1.15;
    const monthlyP10 = pt.p10 || monthlyP50 * 0.85;

    // Distribute monthly total across days with realistic retail curve
    // Weekends + mid-month peak pattern
    const rawWeights = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const seed = yr * 100 + mo + day;           // deterministic but day-specific
      const pseudo = Math.sin(seed * 6.47) * 0.5 + 0.5; // pseudo-random 0-1
      const weekdayBoost = (day % 7 === 0 || day % 7 === 6) ? 1.25 : 1.0; // weekends
      const midMonthBoost = Math.exp(-Math.pow((day - daysInMonth / 2) / 7, 2)) * 0.2 + 1.0;
      return (0.7 + pseudo * 0.6) * weekdayBoost * midMonthBoost;
    });
    const wSum = rawWeights.reduce((a, b) => a + b, 0);
    const shareScale = daysInMonth / wSum;

    return rawWeights.map((w, i) => {
      const dailyShare = w * shareScale;
      const dailyP50 = (monthlyP50 / daysInMonth) * dailyShare;
      const dailyP90 = (monthlyP90 / daysInMonth) * dailyShare;
      const dailyP10 = (monthlyP10 / daysInMonth) * dailyShare;
      return { day: i + 1, p50: dailyP50, p90: dailyP90, p10: dailyP10 };
    });
  }

  // Render Mini Wave Trajectory — daily breakdown for the selected month
  function renderModalSparkline(selectedPt, _allPoints) {
    const container = $('#fModalSvgContainer');
    if (!container || !selectedPt) return;

    const W = container.clientWidth || 600;
    const H = 150;
    const padL = 38, padR = 16, padT = 22, padB = 28;

    const dayPts = buildDailyPoints(selectedPt);
    const n = dayPts.length;

    const maxVal = Math.max(...dayPts.map(d => d.p90), 1) * 1.12;
    const minVal = Math.min(...dayPts.map(d => d.p10), 0) * 0.9;
    const valRange = Math.max(1, maxVal - minVal);

    const stepX = (W - padL - padR) / Math.max(1, n - 1);
    const getX = i => padL + i * stepX;
    const getY = val => padT + (H - padT - padB) * (1 - (val - minVal) / valRange);

    const pts50 = dayPts.map((d, i) => ({ x: getX(i), y: getY(d.p50) }));
    const pts90 = dayPts.map((d, i) => ({ x: getX(i), y: getY(d.p90) }));
    const pts10 = dayPts.map((d, i) => ({ x: getX(i), y: getY(d.p10) }));

    const pathP50 = buildSmoothBezier(pts50);
    const pathP90 = buildSmoothBezier(pts90);
    const pathP10 = buildSmoothBezier(pts10);

    let bandD = `M ${pts90[0].x.toFixed(1)},${pts90[0].y.toFixed(1)}`;
    for (let i = 1; i < n; i++) bandD += ` L ${pts90[i].x.toFixed(1)},${pts90[i].y.toFixed(1)}`;
    for (let i = n - 1; i >= 0; i--) bandD += ` L ${pts10[i].x.toFixed(1)},${pts10[i].y.toFixed(1)}`;
    bandD += ' Z';

    // Y axis ticks (3 levels)
    const yTick = v => padT + (H - padT - padB) * (1 - (v - minVal) / valRange);
    const tickMid = minVal + valRange / 2;

    // Highlight the peak day
    const peakIdx = dayPts.reduce((best, d, i) => d.p50 > dayPts[best].p50 ? i : best, 0);
    const peakX = getX(peakIdx);
    const peakY = getY(dayPts[peakIdx].p50);
    const peakVal = dayPts[peakIdx].p50;

    // X axis: show day 1, mid, last
    const midIdx = Math.floor(n / 2);

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="overflow:visible;">
        <defs>
          <linearGradient id="modalBandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.05"/>
          </linearGradient>
        </defs>

        <!-- Y grid lines -->
        <line x1="${padL}" x2="${W - padR}" y1="${yTick(maxVal / 1.12).toFixed(1)}" y2="${yTick(maxVal / 1.12).toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"/>
        <line x1="${padL}" x2="${W - padR}" y1="${yTick(tickMid).toFixed(1)}" y2="${yTick(tickMid).toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"/>
        <text x="${padL - 4}" y="${(yTick(maxVal / 1.12) + 3.5).toFixed(1)}" fill="#9ca3af" font-size="8.5" text-anchor="end">${money(maxVal / 1.12)}</text>
        <text x="${padL - 4}" y="${(yTick(tickMid) + 3.5).toFixed(1)}" fill="#9ca3af" font-size="8.5" text-anchor="end">${money(tickMid)}</text>

        <!-- Confidence band -->
        <path d="${bandD}" fill="url(#modalBandGrad)"/>
        <!-- UB dashed line -->
        <path d="${pathP90}" fill="none" stroke="#8b5cf6" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.7"/>
        <!-- LB dashed line -->
        <path d="${pathP10}" fill="none" stroke="#3b82f6" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.7"/>
        <!-- P50 projection -->
        <path d="${pathP50}" fill="none" stroke="#7c3aed" stroke-width="2.2" stroke-linecap="round"/>

        <!-- Peak day highlight -->
        <line x1="${peakX.toFixed(1)}" x2="${peakX.toFixed(1)}" y1="${padT}" y2="${H - padB}" stroke="#7c3aed" stroke-width="1" stroke-dasharray="2 2" opacity="0.35"/>
        <circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="4.5" fill="#7c3aed" stroke="#fff" stroke-width="2"/>
        <g transform="translate(${Math.min(Math.max(peakX - 38, 4), W - 82)}, ${Math.max(peakY - 30, 2)})">
          <rect width="76" height="24" rx="6" fill="#fff" stroke="#7c3aed" stroke-width="1" filter="drop-shadow(0 2px 5px rgba(124,58,237,0.18))"/>
          <text x="38" y="10" fill="#6b7280" font-size="8" font-weight="600" text-anchor="middle">Day ${peakIdx + 1} · Peak</text>
          <text x="38" y="20" fill="#7c3aed" font-size="9.5" font-weight="800" text-anchor="middle">${money(peakVal)}</text>
        </g>

        <!-- X axis day labels -->
        <text x="${getX(0).toFixed(1)}" y="${H - 8}" fill="#9ca3af" font-size="9" text-anchor="middle">Day 1</text>
        <text x="${getX(midIdx).toFixed(1)}" y="${H - 8}" fill="#9ca3af" font-size="9" text-anchor="middle">Day ${midIdx + 1}</text>
        <text x="${getX(n - 1).toFixed(1)}" y="${H - 8}" fill="#9ca3af" font-size="9" text-anchor="end">Day ${n}</text>
      </svg>
    `;

    // Wire up interactive daily hover
    setupModalDailyHover(container, dayPts, getX, getY, W, H, padL, padR, padT, padB, n);
  }

  // Interactive daily hover: continuous crosshair + floating tooltip on the modal sparkline
  function setupModalDailyHover(container, dayPts, getX, getY, W, H, padL, padR, padT, padB, n) {
    const svg = container.querySelector('svg');
    if (!svg) return;
    const ns = 'http://www.w3.org/2000/svg';

    // Hover group (hidden by default)
    const hg = document.createElementNS(ns, 'g');
    hg.setAttribute('opacity', '0');
    hg.setAttribute('pointer-events', 'none');
    hg.style.transition = 'opacity 0.12s ease';

    const vline = document.createElementNS(ns, 'line');
    vline.setAttribute('y1', padT); vline.setAttribute('y2', H - padB);
    vline.setAttribute('stroke', '#7c3aed'); vline.setAttribute('stroke-width', '1.2');
    vline.setAttribute('stroke-dasharray', '3 3'); vline.setAttribute('opacity', '0.6');

    const mkDot = (fill, r, sw = '2') => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('r', r); c.setAttribute('fill', fill);
      c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', sw);
      return c;
    };
    const dotP50 = mkDot('#7c3aed', 5, '2.5');
    const dotP90 = mkDot('#8b5cf6', 3.5);
    const dotP10 = mkDot('#3b82f6', 3.5);

    hg.appendChild(vline); hg.appendChild(dotP90); hg.appendChild(dotP50); hg.appendChild(dotP10);
    svg.appendChild(hg);

    // Transparent hit-area overlay
    const overlay = document.createElementNS(ns, 'rect');
    overlay.setAttribute('x', padL); overlay.setAttribute('y', padT);
    overlay.setAttribute('width', W - padL - padR); overlay.setAttribute('height', H - padT - padB);
    overlay.setAttribute('fill', 'transparent'); overlay.style.cursor = 'crosshair';
    svg.appendChild(overlay);

    // Floating HTML tooltip
    const tip = document.createElement('div');
    tip.className = 'modalDayTip';
    tip.style.display = 'none';
    container.style.position = 'relative';
    container.appendChild(tip);

    const getIdx = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = W / rect.width;
      const relX = (clientX - rect.left) * scaleX;
      return Math.max(0, Math.min(n - 1, Math.round((relX - padL) / ((W - padL - padR) / Math.max(1, n - 1)))));
    };

    overlay.addEventListener('pointermove', (e) => {
      const idx = getIdx(e.clientX);
      const d = dayPts[idx];
      const x = getX(idx).toFixed(1);

      vline.setAttribute('x1', x); vline.setAttribute('x2', x);
      dotP50.setAttribute('cx', x); dotP50.setAttribute('cy', getY(d.p50).toFixed(1));
      dotP90.setAttribute('cx', x); dotP90.setAttribute('cy', getY(d.p90).toFixed(1));
      dotP10.setAttribute('cx', x); dotP10.setAttribute('cy', getY(d.p10).toFixed(1));
      hg.setAttribute('opacity', '1');

      // Position tooltip with bounds protection
      const cRect = container.getBoundingClientRect();
      const tipLeft = Math.min(Math.max(e.clientX - cRect.left - 48, 8), container.offsetWidth - 110);
      const tipTop = Math.max(e.clientY - cRect.top - 78, 2);
      tip.innerHTML = `<div class="modalDayTipHead">Day ${d.day} Projected</div>
        <div class="modalDayTipRow" style="color:#7c3aed"><span>P50</span><span>${money(d.p50)}</span></div>
        <div class="modalDayTipRow" style="color:#8b5cf6"><span>UB</span><span>${money(d.p90)}</span></div>
        <div class="modalDayTipRow" style="color:#3b82f6"><span>LB</span><span>${money(d.p10)}</span></div>`;
      tip.style.left = tipLeft + 'px';
      tip.style.top = tipTop + 'px';
      tip.style.display = 'block';
    });

    overlay.addEventListener('pointerleave', () => {
      hg.setAttribute('opacity', '0');
      tip.style.display = 'none';
    });
  }

  // Selected channel forecast filter
  let selectedChannelPeriod = 'all';
  let activeChannelWheelInstance = null;

  // Setup the OptionWheel picker for channel month (same pattern as year wheel in app.js)
  function setupChannelMonthWheel(forecastSeries) {
    const wheelTextEl = $('#channelMonthPickerVal');
    const backdrop = $('#yearWheelBackdrop');
    const portalWheel = $('#portalWheel');
    if (!wheelTextEl || !backdrop || !portalWheel) return;

    // Items: "All Months" first, then each forecast period
    const items = ['All Months', ...forecastSeries.map(f => f.period)];

    const closeWheel = () => {
      backdrop.hidden = true;
      wheelTextEl.style.visibility = 'visible';
    };

    const openWheel = (e) => {
      if (e) { e.stopPropagation(); e.preventDefault(); }

      const rect = wheelTextEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      portalWheel.style.left = centerX + 'px';
      portalWheel.style.top = centerY + 'px';
      backdrop.style.setProperty('--spot-x', `${centerX}px`);
      backdrop.style.setProperty('--spot-y', `${centerY}px`);
      backdrop.hidden = false;
      wheelTextEl.style.visibility = 'hidden';

      let curIdx = selectedChannelPeriod === 'all' ? 0 : items.indexOf(selectedChannelPeriod);
      if (curIdx === -1) curIdx = 0;

      activeChannelWheelInstance = new ReactBitsOptionWheel(portalWheel, {
        items,
        defaultSelected: curIdx,
        rowH: 26,
        smoothing: 180,
        fade: 0.55,
        minOpacity: 0.04,
        blur: 0,
        loop: false,
        onChange: (index, label) => {
          selectedChannelPeriod = index === 0 ? 'all' : label;
          wheelTextEl.textContent = label;
          if (lastData) updateChannelForecastRows(lastData);
        }
      });
    };

    window.openChannelMonthWheel = openWheel;

    wheelTextEl.onpointerdown = (e) => e.stopPropagation();
    wheelTextEl.onclick = openWheel;

    portalWheel.onclick = (e) => {
      if (activeChannelWheelInstance && activeChannelWheelInstance.dragMoved) return;
      const item = e.target.closest('.option-wheel__item');
      if (item) {
        const idx = Number(item.dataset.index);
        activeChannelWheelInstance.applyTarget(idx, true);
      }
    };

    backdrop.onpointerdown = (e) => {
      if (!portalWheel.contains(e.target)) {
        e.stopPropagation(); e.preventDefault();
        closeWheel();
      }
    };
  }

  // Render Channel Contribution Bars — uses the OptionWheel month picker
  function renderChannelContributions(data) {
    const list = $('#channelForecastList');
    if (!list) return;

    const forecastSeries = data.forecast || [];
    const channels = data.channel_contributions || [];

    if (!channels.length) {
      list.innerHTML = '<p class="hint">No retailer distribution available</p>';
      return;
    }

    // Update year badge from forecast series
    const yearBadge = $('#channelYearBadge');
    if (yearBadge) {
      const years = [...new Set(forecastSeries.map(f => (f.period || '').slice(0, 4)).filter(Boolean))];
      yearBadge.textContent = years.length ? years.join('–') : '';
    }

    // Boot the wheel picker (idempotent — re-uses same backdrop/portal)
    setupChannelMonthWheel(forecastSeries);

    // Boot the carousel once with onSlide to update Retailer/Counter label
    const track = $('#channelContribTrack');
    const dots = $('#channelContribDots');
    if (track && dots && !track._carouselInit) {
      track._carouselInit = true;
      const entityLabels = ['Retailer', 'Counter'];
      window.makeCarousel(track, dots, {
        onSlide: (idx) => {
          const label = $('#channelEntityLabel');
          if (label) label.textContent = entityLabels[idx] || entityLabels[0];
        }
      });
    }

    // Sync the label back to "All Months" on fresh render
    selectedChannelPeriod = 'all';
    const wheelTextEl = $('#channelMonthPickerVal');
    if (wheelTextEl) wheelTextEl.textContent = 'All Months';
    const entityLabel = $('#channelEntityLabel');
    if (entityLabel) entityLabel.textContent = 'Retailer';

    updateChannelForecastRows(data);
  }

  function updateChannelForecastRows(data) {
    const list = $('#channelForecastList');
    const hint = $('#channelContribHint');
    if (!list) return;

    const forecastSeries = data.forecast || [];
    const horizonCount = forecastSeries.length || currentHorizon;
    const channels = data.channel_contributions || [];

    let totalPeriodSales = 0;
    let timeframeLabel = '';

    if (selectedChannelPeriod === 'all') {
      const startPeriod = forecastSeries[0]?.period || '';
      const endPeriod = forecastSeries[forecastSeries.length - 1]?.period || '';
      timeframeLabel = startPeriod && endPeriod ? `${startPeriod} – ${endPeriod}` : `${horizonCount} Months`;
      totalPeriodSales = forecastSeries.reduce((acc, f) => acc + (f.sales || 0), 0);
      if (hint) hint.textContent = `Expected revenue distribution across retail partners over the entire ${timeframeLabel} horizon.`;
    } else {
      const matched = forecastSeries.find(f => f.period === selectedChannelPeriod);
      totalPeriodSales = matched ? (matched.sales || matched.p50 || 0) : 0;
      timeframeLabel = selectedChannelPeriod;
      if (hint) hint.textContent = `Expected revenue distribution across retail partners in ${selectedChannelPeriod}.`;
    }

    list.innerHTML = channels.map((ch, idx) => {
      let name = ch.name;
      if (!name || name === 'Retail Partner' || name === 'Direct Outlet' || name === 'undefined') {
        name = ch.retailer && ch.retailer !== 'Retail Partner' ? ch.retailer : (idx === 0 ? 'Mydin' : (idx === 1 ? 'Hero Market' : `Retailer #${idx + 1}`));
      }

      const sharePct = Number(ch.share_pct) || 50;
      const periodSales = (totalPeriodSales * sharePct) / 100;

      return `
        <div class="channelContribRow">
          <div class="contribInfo">
            <span class="contribName">${escapeHtml(name)}</span>
            <span class="contribShare">${sharePct.toFixed(1)}% share</span>
            <span class="contribPeriod">${timeframeLabel}</span>
          </div>
          <div class="contribBarTrack">
            <div class="contribBarFill" style="width: ${Math.min(100, Math.max(5, sharePct))}%;"></div>
          </div>
          <div class="contribVal">
            <strong>${money(periodSales)}</strong>
          </div>
        </div>
      `;
    }).join('');

    // Render top counters pane
    renderCounterContributions(data, totalPeriodSales, timeframeLabel);
  }

  // Render top counters into the second carousel pane
  function renderCounterContributions(data, totalPeriodSales, timeframeLabel) {
    const list = $('#channelCounterList');
    if (!list) return;

    const counters = data.top_counters || [];
    if (!counters.length) {
      list.innerHTML = '<p class="hint">No counter data available for this filter.</p>';
      return;
    }

    list.innerHTML = counters.map((c, idx) => {
      const name = c.name || `Counter #${idx + 1}`;
      const retailer = c.retailer || '';
      const sharePct = Number(c.share_pct) || 0;
      const periodSales = (totalPeriodSales * sharePct) / 100;

      return `
        <div class="channelContribRow">
          <div class="contribInfo">
            <span class="contribName">${escapeHtml(name)}</span>
            <span class="contribShare">${sharePct.toFixed(1)}% share${retailer ? ` · ${escapeHtml(retailer)}` : ''}</span>
            <span class="contribPeriod">${timeframeLabel}</span>
          </div>
          <div class="contribBarTrack">
            <div class="contribBarFill" style="width: ${Math.min(100, Math.max(3, sharePct))}%;"></div>
          </div>
          <div class="contribVal">
            <strong>${money(periodSales)}</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Anomaly & Predictive Signals without emojis
  function renderAnomalies(data) {
    const list = $('#forecastAnomaliesList');
    if (!list) return;

    const anomalies = data.anomalies || [];
    const summary = data.summary || {};
    const signals = [];

    // 1. Historical anomalies
    anomalies.forEach(a => {
      signals.push({
        type: a.type === 'surge' ? 'ok' : 'warn',
        title: a.type === 'surge' ? `Historical Demand Surge in ${a.period}` : `Performance Dip Detected in ${a.period}`,
        text: `Sales reached ${money(a.sales)} (${a.deviation_pct >= 0 ? '+' : ''}${a.deviation_pct}% deviation from expected RM ${a.expected.toLocaleString()}).`
      });
    });

    // 2. Seasonal peak foresight
    if (summary.peak_month) {
      signals.push({
        type: 'info',
        title: `Seasonal Demand Inflection: Peak Expected in ${summary.peak_month}`,
        text: `TimesFM projects peak seasonal volume around ${money(summary.peak_sales)}. Ensure adequate inventory replenishment at major retail outlets 3-4 weeks prior.`
      });
    }

    // 3. Volatility guidance
    if (summary.volatility_index > 8) {
      signals.push({
        type: 'warn',
        title: `Higher Volatility Spread Observed`,
        text: `Sales fluctuations across outlets widen prediction bounds. Consider monitoring monthly consignment sell-through rate closely.`
      });
    }

    if (!signals.length) {
      signals.push({
        type: 'ok',
        title: `Stable Consistent Run-rate`,
        text: `Historical consignments demonstrate consistent sales velocity without abnormal disruptions.`
      });
    }

    list.innerHTML = signals.map(s => `
      <div class="signalCard signal-${s.type}">
        <h4>${s.title}</h4>
        <p>${s.text}</p>
      </div>
    `).join('');
  }

  // Render Month-by-Month Forecast Table without emojis
  function renderForecastTable(data) {
    const tbody = $('#forecastTableBody');
    if (!tbody) return;

    const forecast = data.forecast || [];
    if (!forecast.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="emptyCell">No forecast periods available</td></tr>';
      return;
    }

    tbody.innerHTML = forecast.map((row, idx) => {
      const growth = row.growth_pct != null ? row.growth_pct : 0;
      const growthBadge = growth >= 0 
        ? `<span class="growthPositive">+${growth}%</span>`
        : `<span class="growthNegative">${growth}%</span>`;

      const demandBadge = idx === 0 
        ? '<span class="demandPill normal">Current Baseline</span>'
        : (row.p50 >= (data.summary?.peak_sales || 0) * 0.95 
            ? '<span class="demandPill peak">Peak Season</span>' 
            : (growth > 5 ? '<span class="demandPill high">High Demand</span>' : '<span class="demandPill normal">Steady</span>'));

      return `
        <tr>
          <td><strong>${escapeHtml(row.period)}</strong></td>
          <td class="numCol">${money(row.p10)}</td>
          <td class="numCol highlightCol"><strong>${money2(row.p50)}</strong></td>
          <td class="numCol">${money(row.p90)}</td>
          <td class="numCol">${formatNum(row.units)} pairs</td>
          <td class="numCol">${growthBadge}</td>
          <td>${demandBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Target Feasibility & Gap Evaluation with Instant Feedback & Input Sanitization
  async function evaluateTargetGap(targetAmount) {
    // Sanitize input (handles commas, currency symbols, etc.)
    let target = typeof targetAmount === 'number' ? targetAmount : parseFloat(String(targetAmount || '').replace(/[^0-9.]/g, ''));
    if (!target || isNaN(target) || target <= 0) return;

    const calcBtn = $('#calcTargetGapBtn');
    const resultsBox = $('#targetGapResults');
    const originalText = calcBtn ? calcBtn.textContent : 'Evaluate Target';

    if (calcBtn) {
      calcBtn.disabled = true;
      calcBtn.textContent = 'Evaluating...';
    }

    const applyResults = (resData) => {
      const badge = $('#targetFeasibilityBadge');
      if (badge) {
        badge.textContent = resData.feasibility;
        badge.className = `feasibilityBadge badge-${resData.feasibilityTier}`;
      }

      const gapValEl = $('#targetGapVal');
      if (gapValEl) {
        gapValEl.textContent = resData.gapFormatted;
        gapValEl.style.color = resData.gap <= 0 ? 'var(--ok-tx)' : 'var(--accent)';
      }

      const growthValEl = $('#targetGrowthRateVal');
      if (growthValEl) {
        growthValEl.textContent = `${resData.requiredGrowthRate >= 0 ? '+' : ''}${resData.requiredGrowthRate}%`;
      }

      const adviceBox = $('#targetAdviceBox');
      if (adviceBox) {
        adviceBox.innerHTML = `<strong>Strategic Assessment:</strong> ${escapeHtml(resData.advice)}`;
      }

      if (resultsBox) {
        resultsBox.classList.remove('targetUpdatedAnim');
        void resultsBox.offsetWidth; // trigger reflow
        resultsBox.classList.add('targetUpdatedAnim');
      }
    };

    // Fast Path: If we already have forecast data in memory for this filter set, compute instantly (0ms)
    if (lastData && lastData.forecast && lastData.forecast.length > 0) {
      const baselineProjected = lastData.summary?.total_projected_sales || 0;
      const optimisticProjected = lastData.forecast.reduce((acc, f) => acc + (Number(f.p90) || Number(f.sales) || 0), 0);
      const conservativeProjected = lastData.forecast.reduce((acc, f) => acc + (Number(f.p10) || Number(f.sales) || 0), 0);

      const gap = Math.round((target - baselineProjected) * 100) / 100;
      const requiredGrowthRate = Math.round(((target - baselineProjected) / Math.max(1, baselineProjected)) * 1000) / 10;

      let feasibility = 'Achievable (On Track)';
      let feasibilityTier = 'likely';
      let advice = 'Your target is well aligned with historical momentum and TimesFM seasonality baseline.';

      if (target > optimisticProjected) {
        feasibility = 'High Stretch Target (Challenging)';
        feasibilityTier = 'stretch';
        advice = `Reaching RM ${target.toLocaleString()} exceeds the 90th percentile projection (RM ${Math.round(optimisticProjected).toLocaleString()}). Requires aggressive promotional campaigns or opening new retail counters.`;
      } else if (target > baselineProjected) {
        feasibility = 'Growth Target (Attainable)';
        feasibilityTier = 'moderate';
        advice = `Target is ${requiredGrowthRate}% above baseline. Focus on top retail chains and high-volume counters to close the RM ${Math.abs(gap).toLocaleString()} gap.`;
      } else {
        feasibility = 'Conservative Target (Easily Attainable)';
        feasibilityTier = 'conservative';
        advice = `TimesFM forecasts baseline revenue of RM ${Math.round(baselineProjected).toLocaleString()}, which is RM ${Math.abs(gap).toLocaleString()} higher than your target.`;
      }

      applyResults({
        target,
        gap,
        gapFormatted: `${gap >= 0 ? '+' : '-'}RM ${Math.abs(gap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        requiredGrowthRate,
        feasibility,
        feasibilityTier,
        advice
      });

      if (calcBtn) {
        calcBtn.textContent = originalText;
        calcBtn.disabled = false;
      }
      return;
    }

    // Network Path (if data not yet loaded)
    const retailer = $('#fRetailer')?.value || '';
    const counter = $('#fCounter')?.value || '';
    const category = $('#fCategory')?.value || '';

    try {
      const res = await fetch('/api/forecast/target-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSales: target,
          horizon: currentHorizon,
          retailer,
          counter,
          category
        })
      });

      if (!res.ok) throw new Error('Target gap API error');
      const resData = await res.json();
      applyResults(resData);
    } catch (e) {
      console.warn('Target gap analysis failed:', e);
    } finally {
      if (calcBtn) {
        calcBtn.textContent = originalText;
        calcBtn.disabled = false;
      }
    }
  }

  // Export Forecast Table as CSV
  function exportForecastCsv() {
    if (!lastData || !lastData.forecast) return;
    const headers = ['Month', 'Conservative (P10 RM)', 'Expected (P50 RM)', 'Optimistic (P90 RM)', 'Forecasted Units', 'MoM Growth %'];
    const rows = lastData.forecast.map(f => [
      `"${f.period}"`,
      f.p10,
      f.p50,
      f.p90,
      f.units,
      f.growth_pct
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_forecast_${currentHorizon}months.csv`;
    link.click();
  }

  // Event Listeners Setup
  function initForecastEventListeners() {
    // Navigation toggle in header
    const navBtn = $('#navForecastBtn');
    if (navBtn) {
      navBtn.addEventListener('click', () => {
        const isForecastVisible = !$('#forecastView')?.hidden;
        window.switchView(isForecastVisible ? 'dashboard' : 'forecast');
      });
    }

    // Dock item click
    $$('.dockItem').forEach(btn => {
      if (btn.dataset.action === 'forecast') {
        btn.addEventListener('click', () => window.switchView('forecast'));
      }
    });

    // Horizon pill selectors
    $$('#horizonButtons .pillBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#horizonButtons .pillBtn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        currentHorizon = parseInt(btn.dataset.horizon, 10) || 6;
        loadForecastData();
      });
    });

    // Scenario pill selectors
    $$('#scenarioButtons .pillBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#scenarioButtons .pillBtn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        currentScenario = btn.dataset.scenario || 'baseline';
        loadForecastData();
      });
    });

    // Initialize custom animated dropdowns for forecast
    setupForecastSelect('#fRetailer', '#wrapFRetailer', '#btnFRetailer', '#menuFRetailer', 'All retailers', () => loadForecastData());
    setupForecastSelect('#fCounter', '#wrapFCounter', '#btnFCounter', '#menuFCounter', 'All counters', () => loadForecastData());
    setupForecastSelect('#fCategory', '#wrapFCategory', '#btnFCategory', '#menuFCategory', 'All categories', () => loadForecastData());
    setupForecastSelect('#fConfidence', '#wrapFConfidence', '#btnFConfidence', '#menuFConfidence', '90% Standard', (val) => {
      currentConfidence = parseFloat(val) || 0.90;
      loadForecastData();
    });

    // Target gap form evaluation
    const submitTargetCalc = () => {
      const rawVal = $('#targetAmountInput')?.value || '';
      const target = parseFloat(String(rawVal).replace(/[^0-9.]/g, ''));
      if (target > 0) evaluateTargetGap(target);
    };

    $('#calcTargetGapBtn')?.addEventListener('click', submitTargetCalc);
    $('#targetAmountInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitTargetCalc();
      }
    });

    // Target quick chips
    $$('#targetQuickChips .quickChip').forEach(chip => {
      chip.addEventListener('click', () => {
        const mult = parseFloat(chip.dataset.mult) || 1.1;
        const baseline = lastData?.summary?.total_projected_sales || 100000;
        const newTarget = Math.round(baseline * mult / 1000) * 1000;
        const input = $('#targetAmountInput');
        if (input) {
          input.value = newTarget;
          evaluateTargetGap(newTarget);
        }
      });
    });

    // Export CSV
    $('#exportForecastCsvBtn')?.addEventListener('click', exportForecastCsv);

    // Pre-populate filter options on load
    populateForecastFilters();

    // Close open dropdown menus on window scroll
    window.addEventListener('scroll', () => {
      document.querySelectorAll('.customSelectMenu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.customSelectBtn').forEach(b => { b.setAttribute('aria-expanded', 'false'); b.classList.remove('open'); });
      document.querySelectorAll('.customSelectWrap').forEach(w => { w.classList.remove('open'); });
    }, { passive: true });

    // Deep link check on load
    if (location.hash === '#forecast') {
      window.switchView('forecast');
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForecastEventListeners);
  } else {
    initForecastEventListeners();
  }
})();
