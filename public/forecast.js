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

  // Load forecast data from API
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

    try {
      const res = await fetch(`/api/forecast?${params}`);
      if (!res.ok) throw new Error('Forecast API returned status ' + res.status);
      const data = await res.json();
      lastData = data;

      renderForecastKPIs(data);
      renderForecastChart(data);
      renderChannelContributions(data);
      renderAnomalies(data);
      renderForecastTable(data);

      // Auto evaluate default target if planner is uninitialized
      const targetInput = $('#targetAmountInput');
      if (targetInput && (!targetInput.value || Number(targetInput.value) <= 0)) {
        const defaultTarget = Math.round((data.summary?.total_projected_sales || 100000) * 1.1 / 1000) * 1000;
        targetInput.value = defaultTarget;
        evaluateTargetGap(defaultTarget);
      } else if (targetInput && targetInput.value) {
        evaluateTargetGap(Number(targetInput.value));
      }
    } catch (err) {
      console.error('Failed to load forecast:', err);
    }
  }

  // Render KPI Bento Cards
  function renderForecastKPIs(data) {
    const summary = data.summary || {};
    $('#fStatSales').textContent = money(summary.total_projected_sales);
    
    const growthEl = $('#fStatGrowth');
    const growth = summary.growth_rate_pct || 0;
    growthEl.innerHTML = growth >= 0 
      ? `<span class="badgeOk">+${growth}% vs previous</span>`
      : `<span class="badgeWarn">${growth}% vs previous</span>`;

    $('#fStatUnits').textContent = formatNum(summary.total_projected_units);
    $('#fStatAvgMonthly').textContent = `Avg ${money(summary.average_monthly_sales)} / month`;

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

  // Interactive Hover Handler for Chart
  function setupForecastChartHover(container, points, getX, getY, W, H) {
    const svg = container.querySelector('svg');
    const tip = $('#forecastChartTip');
    const crosshair = container.querySelector('#fCrosshair');
    const crossTarget = container.querySelector('#fCrossTarget');
    if (!svg || !tip || !crosshair) return;

    svg.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W;

      // Find closest point
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

      const pt = points[closestIdx];
      const px = getX(closestIdx);
      const py = getY(pt.sales);

      crosshair.setAttribute('x1', px);
      crosshair.setAttribute('x2', px);
      crosshair.setAttribute('opacity', '0.6');

      if (crossTarget) {
        crossTarget.setAttribute('cx', px);
        crossTarget.setAttribute('cy', py);
        crossTarget.setAttribute('stroke', pt.isForecast ? '#7c3aed' : '#0b57c7');
        crossTarget.setAttribute('opacity', '1');
      }

      tip.hidden = false;
      tip.style.display = 'block';

      if (pt.isForecast) {
        tip.innerHTML = `
          <div class="fTipHead"><span class="fTipTag forecastTag">TimesFM Projection</span> <b>${escapeHtml(pt.period)}</b></div>
          <div class="fTipMain"><strong>${money2(pt.sales)}</strong> <span class="fTipUnits">(${formatNum(pt.units)} pairs)</span></div>
          <div class="fTipBounds">
            <span>P10 (Min): ${money(pt.p10)}</span>
            <span>P90 (Max): ${money(pt.p90)}</span>
          </div>
          ${pt.growth_pct != null ? `<div class="fTipGrowth">MoM Trend: <b>${pt.growth_pct >= 0 ? '+' : ''}${pt.growth_pct}%</b></div>` : ''}
        `;
      } else {
        tip.innerHTML = `
          <div class="fTipHead"><span class="fTipTag histTag">Recorded Actual</span> <b>${escapeHtml(pt.period)}</b></div>
          <div class="fTipMain"><strong>${money2(pt.sales)}</strong> <span class="fTipUnits">(${formatNum(pt.units)} pairs)</span></div>
        `;
      }

      const tipWidth = 220;
      const leftPos = Math.min(Math.max(px - tipWidth / 2, 10), W - tipWidth - 10);
      tip.style.left = `${(leftPos / W) * 100}%`;
      tip.style.top = '12px';
    });

    svg.addEventListener('pointerleave', () => {
      crosshair.setAttribute('opacity', '0');
      if (crossTarget) crossTarget.setAttribute('opacity', '0');
      tip.hidden = true;
      tip.style.display = 'none';
    });
  }

  // Render Channel Contribution Bars
  function renderChannelContributions(data) {
    const list = $('#channelForecastList');
    if (!list) return;

    const channels = data.channel_contributions || [];
    if (!channels.length) {
      list.innerHTML = '<p class="hint">No retailer distribution available</p>';
      return;
    }

    list.innerHTML = channels.map(ch => `
      <div class="channelContribRow">
        <div class="contribInfo">
          <span class="contribName">${escapeHtml(ch.name || ch.retailer || 'Retail Partner')}</span>
          <span class="contribShare">${ch.share_pct}% share</span>
        </div>
        <div class="contribBarTrack">
          <div class="contribBarFill" style="width: ${Math.min(100, Math.max(5, ch.share_pct))}%;"></div>
        </div>
        <div class="contribVal">
          <strong>${money(ch.projected_sales)}</strong>
        </div>
      </div>
    `).join('');
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
    // Navigation toggle in header with liquid glass pointer tracking
    const navBtn = $('#navForecastBtn');
    if (navBtn) {
      navBtn.addEventListener('click', () => {
        const isForecastVisible = !$('#forecastView')?.hidden;
        window.switchView(isForecastVisible ? 'dashboard' : 'forecast');
      });
      navBtn.addEventListener('pointermove', e => {
        const rect = navBtn.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
        navBtn.style.setProperty('--liquid-x', `${x}%`);
        navBtn.style.setProperty('--liquid-y', `${y}%`);
      }, { passive: true });
      navBtn.addEventListener('pointerleave', () => {
        navBtn.style.removeProperty('--liquid-x');
        navBtn.style.removeProperty('--liquid-y');
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
