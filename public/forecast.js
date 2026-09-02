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
      if (navLabel) navLabel.textContent = '📊 Back to Dashboard';
      if (pageTitle) pageTitle.textContent = 'AI Sales Forecast';
      if (brandEyebrow) brandEyebrow.textContent = 'GOOGLE TIMESFM PREDICTIONS';
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
      if (navLabel) navLabel.textContent = '🔮 AI Sales Forecast';
      if (pageTitle) pageTitle.textContent = 'Sales dashboard';
      if (brandEyebrow) brandEyebrow.textContent = 'SALES REPORTS';
      location.hash = 'dashboard';

      // Update active dock item
      $$('.dockItem').forEach(b => b.classList.toggle('active', b.dataset.action === 'charts'));
    }
  };

  // Populate forecast filters from main dashboard data options
  function populateForecastFilters() {
    const retailerSel = $('#fRetailer');
    const categorySel = $('#fCategory');
    const counterSel = $('#fCounter');

    const dRetailer = $('#dRetailer');
    const dCategory = $('#dCategory');

    if (retailerSel && dRetailer && retailerSel.options.length <= 1) {
      Array.from(dRetailer.options).forEach(opt => {
        if (opt.value) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.textContent;
          retailerSel.appendChild(o);
        }
      });
    }

    if (categorySel && dCategory && categorySel.options.length <= 1) {
      Array.from(dCategory.options).forEach(opt => {
        if (opt.value) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.textContent;
          categorySel.appendChild(o);
        }
      });
    }

    // Counters dropdown
    fetch('/api/dashboard').then(r => r.json()).then(data => {
      if (data.options?.counters && counterSel && counterSel.options.length <= 1) {
        data.options.counters.forEach(c => {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          counterSel.appendChild(o);
        });
      }
    }).catch(() => {});
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
      ? `<span class="badgeOk">↑ +${growth}% vs previous</span>`
      : `<span class="badgeWarn">↓ ${growth}% vs previous</span>`;

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
      $('#fModelBadge').textContent = `🔮 ${data.model}`;
    }
  }

  // Render Interactive Forecast SVG Chart with Confidence Envelope
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

    // Build historical path
    const histPoints = [];
    for (let i = 0; i < hist.length; i++) {
      histPoints.push({ x: getX(i), y: getY(allPoints[i].sales), p: allPoints[i] });
    }

    // Build forecast path (starts from last historical point for seamless line)
    const forecastPoints = [];
    if (hist.length > 0) {
      forecastPoints.push({ x: getX(hist.length - 1), y: getY(allPoints[hist.length - 1].sales), p: allPoints[hist.length - 1] });
    }
    for (let i = hist.length; i < numPoints; i++) {
      forecastPoints.push({ x: getX(i), y: getY(allPoints[i].sales), p: allPoints[i] });
    }

    // Build confidence interval polygon path (P10 to P90)
    let bandPathD = '';
    if (pred.length > 0) {
      const bandTop = [];
      const bandBottom = [];
      
      // Start band at last historical point
      if (hist.length > 0) {
        const lastHistX = getX(hist.length - 1);
        const lastHistY = getY(allPoints[hist.length - 1].sales);
        bandTop.push(`${lastHistX.toFixed(1)},${lastHistY.toFixed(1)}`);
        bandBottom.unshift(`${lastHistX.toFixed(1)},${lastHistY.toFixed(1)}`);
      }

      for (let i = hist.length; i < numPoints; i++) {
        const pt = allPoints[i];
        const x = getX(i);
        const y90 = getY(pt.p90);
        const y10 = getY(pt.p10);
        bandTop.push(`${x.toFixed(1)},${y90.toFixed(1)}`);
        bandBottom.unshift(`${x.toFixed(1)},${y10.toFixed(1)}`);
      }

      bandPathD = `M ${bandTop.join(' L ')} L ${bandBottom.join(' L ')} Z`;
    }

    // SVG Line Paths
    const histPathD = buildSvgPath(histPoints);
    const forecastPathD = buildSvgPath(forecastPoints);

    // Y Grid Ticks
    const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(t => t * maxVal);

    // Vertical Divider X for "Today / Forecast Horizon"
    const splitX = hist.length > 0 ? getX(hist.length - 1) : padL;

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" class="forecastSvg">
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.08"/>
          </linearGradient>
          <linearGradient id="histAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0b57c7" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#0b57c7" stop-opacity="0.0"/>
          </linearGradient>
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

        <!-- Shaded Confidence Interval Envelope (P10 - P90) -->
        ${bandPathD ? `<path d="${bandPathD}" fill="url(#bandGrad)" class="forecastBandAnim" />` : ''}

        <!-- Historical Line -->
        ${histPathD ? `<path d="${histPathD}" fill="none" stroke="#0b57c7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ''}

        <!-- Forecast Dotted/Glowing Line -->
        ${forecastPathD ? `<path d="${forecastPathD}" fill="none" stroke="#7c3aed" stroke-width="3.2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" class="forecastLineGlow" />` : ''}

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

        <!-- Cursor Crosshair Line -->
        <line id="fCrosshair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 2" opacity="0"/>
      </svg>
    `;

    // Interactive crosshair & tooltip
    setupForecastChartHover(container, allPoints, getX, getY, W, H);
  }

  // Build SVG path from point array
  function buildSvgPath(points) {
    if (!points || !points.length) return '';
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }
    return d;
  }

  // Interactive Hover Handler for Chart
  function setupForecastChartHover(container, points, getX, getY, W, H) {
    const svg = container.querySelector('svg');
    const tip = $('#forecastChartTip');
    const crosshair = container.querySelector('#fCrosshair');
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

      const tipWidth = 210;
      const leftPos = Math.min(Math.max(px - tipWidth / 2, 10), W - tipWidth - 10);
      tip.style.left = `${(leftPos / W) * 100}%`;
      tip.style.top = '12px';
    });

    svg.addEventListener('pointerleave', () => {
      crosshair.setAttribute('opacity', '0');
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
          <span class="contribName">${escapeHtml(ch.name)}</span>
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

  // Render Anomaly & Predictive Signals
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
        title: a.type === 'surge' ? `📈 Historical Demand Surge in ${a.period}` : `📉 Performance Dip Detected in ${a.period}`,
        text: `Sales reached ${money(a.sales)} (${a.deviation_pct >= 0 ? '+' : ''}${a.deviation_pct}% deviation from expected RM ${a.expected.toLocaleString()}).`
      });
    });

    // 2. Seasonal peak foresight
    if (summary.peak_month) {
      signals.push({
        type: 'info',
        title: `✨ Seasonal Demand Inflection: Peak Expected in ${summary.peak_month}`,
        text: `TimesFM projects peak seasonal volume around ${money(summary.peak_sales)}. Ensure adequate inventory replenishment at major retail outlets 3-4 weeks prior.`
      });
    }

    // 3. Volatility guidance
    if (summary.volatility_index > 8) {
      signals.push({
        type: 'warn',
        title: `⚠️ Higher Volatility Spread Observed`,
        text: `Sales fluctuations across outlets widen prediction bounds. Consider monitoring monthly consignment sell-through rate closely.`
      });
    }

    if (!signals.length) {
      signals.push({
        type: 'ok',
        title: `✅ Stable Consistent Run-rate`,
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

  // Render Month-by-Month Forecast Table
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
            ? '<span class="demandPill peak">🔥 Peak Season</span>' 
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

  // Target Feasibility & Gap Evaluation
  async function evaluateTargetGap(targetAmount) {
    if (!targetAmount || targetAmount <= 0) return;

    const retailer = $('#fRetailer')?.value || '';
    const counter = $('#fCounter')?.value || '';
    const category = $('#fCategory')?.value || '';

    try {
      const res = await fetch('/api/forecast/target-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSales: targetAmount,
          horizon: currentHorizon,
          retailer,
          counter,
          category
        })
      });

      if (!res.ok) throw new Error('Target gap API error');
      const resData = await res.json();

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
    } catch (e) {
      console.warn('Target gap analysis failed:', e);
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
    $('#navForecastBtn')?.addEventListener('click', () => {
      const isForecastVisible = !$('#forecastView')?.hidden;
      window.switchView(isForecastVisible ? 'dashboard' : 'forecast');
    });

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

    // Confidence dropdown
    $('#fConfidence')?.addEventListener('change', e => {
      currentConfidence = parseFloat(e.target.value) || 0.9;
      loadForecastData();
    });

    // Filter selects
    ['#fRetailer', '#fCounter', '#fCategory'].forEach(sel => {
      $(sel)?.addEventListener('change', () => loadForecastData());
    });

    // Target gap form evaluation
    $('#calcTargetGapBtn')?.addEventListener('click', () => {
      const target = Number($('#targetAmountInput')?.value);
      if (target > 0) evaluateTargetGap(target);
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
