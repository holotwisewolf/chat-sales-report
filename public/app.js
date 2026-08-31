// Dashboard stats strip + charts dialog. The toolbar filters (#dRetailer/#dCategory/#dMonth in data.js)
// are the single source of truth - they drive both the table and everything rendered here.
const money = n => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n || 0);
const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const median = values => { const sorted = values.slice().sort((a,b) => a-b); const half = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2; };
const FILTER_IDS = { '#dRetailer': 'retailer', '#dCategory': 'category' };
const filterValue = selector => document.querySelector(selector)?.value || '';

// Plain-English signals for a non-native speaker: "typical store" instead of median, no jargon.
function buildSignals(counters) {
  const byRetailer = counters.reduce((groups, counter) => { (groups[counter.retailer] ||= []).push(counter); return groups; }, {});
  return Object.values(byRetailer).flatMap(group => {
    if (group.length < 4) return [];
    const typical = median(group.map(row => row.sales));
    const typicalUnits = median(group.map(row => row.quantity));
    const high = group[0];
    const low = group[group.length - 1];
    const results = [];
    if (high.sales >= typical * 1.5) results.push({ type: 'high', title: `${high.name} is doing very well`, text: `It earned ${money(high.sales)} with ${high.quantity} pairs sold. That is much more than the other ${high.retailer} stores - a typical one earned about ${money(typical)}. Maybe worth asking what they are doing right.` });
    if (low.sales <= typical * .55) results.push({ type: 'low', title: `${low.name} is much slower than the others`, text: `It only earned ${money(low.sales)} (${low.quantity} pairs), while a typical ${low.retailer} store earned about ${money(typical)} (${Math.round(typicalUnits)} pairs). Maybe check the stock or the display there.` });
    return results;
  }).slice(0, 4);
}

async function load() {
  try {
    await renderDashboard();
  } catch (error) {
    console.error('dashboard load failed', error);
    const bar = document.querySelector('#activeFilters');
    if (bar) bar.innerHTML = `<span class="filterChip" style="color:var(--bad-tx);border-color:var(--bad-tx)">Something broke while refreshing the numbers - ${escapeHtml(error.message || 'unknown error')}</span>`;
  }
}

let applyFiltersToOverview = false;

async function renderDashboard() {
  const applyBtn = document.querySelector('#applyFilterToggleBtn');
  if (applyBtn && !applyBtn.dataset.wired) {
    applyBtn.dataset.wired = 'true';
    applyBtn.onclick = e => {
      e.stopPropagation();
      applyFiltersToOverview = !applyFiltersToOverview;
      applyBtn.classList.toggle('on', applyFiltersToOverview);
      const labelSpan = applyBtn.querySelector('.toggleLabel');
      if (labelSpan) labelSpan.textContent = applyFiltersToOverview ? 'Apply current filter' : 'Overview unfiltered';
      if (applyFiltersToOverview && window.slideCarouselTo) {
        window.slideCarouselTo(3); // Slide to Pane 4 (Filtered Sales)
      }
      load();
    };
  }

  const params = new URLSearchParams();
  if (applyFiltersToOverview) {
    Object.entries(FILTER_IDS).forEach(([selector, key]) => params.set(key, filterValue(selector)));
    const range = window.currentPeriod ? window.currentPeriod() : {};
    params.set('from', range.from || '');
    params.set('to', range.to || '');
    params.set('months', range.months || '');
    params.set('exMonths', range.exMonths || '');
  }
  const data = await fetch(`/api/dashboard?${params}`).then(response => response.json());
  document.querySelector('#sales').textContent = money(data.summary.sales);
  document.querySelector('#units').textContent = Number(data.summary.quantity).toLocaleString();
  document.querySelector('#counters').textContent = data.summary.counters;
  document.querySelector('#top').textContent = data.ranking[0]?.name || '—';
  const labels = { retailer: 'Retailer', category: 'Category' };
  const chips = Object.entries(FILTER_IDS).filter(([selector]) => filterValue(selector));
  const periodChip = window.periodLabel && window.periodLabel() !== 'All time'
    ? `<span class="filterChip">Period: ${escapeHtml(window.periodLabel())}<button type="button" id="clearPeriod" aria-label="Clear period">&times;</button></span>` : '';
  const activeFiltersEl = document.querySelector('#activeFilters');
  if (activeFiltersEl) {
    const hasFilters = Boolean(chips.length || periodChip);
    activeFiltersEl.style.display = hasFilters ? 'flex' : 'none';
    activeFiltersEl.innerHTML = hasFilters
      ? '<span class="statusLabel">Showing</span>' + periodChip + chips.map(([selector, key]) => `<span class="filterChip">${labels[key]}: ${escapeHtml(filterValue(selector))}<button type="button" data-clear="${selector}" aria-label="Clear filter">&times;</button></span>`).join('') + '<button type="button" class="linkish" id="clearAll">clear all</button>'
      : '';
  }

  // Populate flyout submenu active filter parameters list
  const flyoutList = document.querySelector('#flyoutFilterList');
  if (flyoutList) {
    const retVal = filterValue('#dRetailer');
    const catVal = filterValue('#dCategory');
    const periodVal = window.periodLabel ? window.periodLabel() : 'All time';
    flyoutList.innerHTML = `
      <div class="flyoutFilterItem"><span>Retailer:</span> <span>${escapeHtml(retVal || 'All retailers')}</span></div>
      <div class="flyoutFilterItem"><span>Category:</span> <span>${escapeHtml(catVal || 'All categories')}</span></div>
      <div class="flyoutFilterItem"><span>Period:</span> <span>${escapeHtml(periodVal)}</span></div>
      <div class="flyoutFilterItem" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--hair2)">
        <span>Overview Status:</span> <strong>${applyFiltersToOverview ? 'Filtered' : 'Unfiltered'}</strong>
      </div>
    `;
  }
  const clearPeriod = document.querySelector('#clearPeriod');
  if (clearPeriod) clearPeriod.onclick = () => { if (window.resetPeriod) window.resetPeriod(); loadRows(); load(); };
  const clearAll = document.querySelector('#clearAll');
  if (clearAll) clearAll.onclick = clearFilters;
  const cats = data.categoryTotals || [];
  const catPane = document.querySelector('#catPane');
  if (catPane) {
    catPane.innerHTML = '';
    if (cats.length) barList(catPane, cats.map(c => ({ label: c.category, value: c.sales, sub: `${Number(c.quantity).toLocaleString()} units` })), { format: money });
    else catPane.innerHTML = '<p class="hint">No categories in this filter yet.</p>';
  }
  window.lastDashboardData = data;
  const defaultYears = [2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
  const dataYears = data.options?.years || [];
  const availableYears = Array.from(new Set([...dataYears, ...defaultYears])).sort((a, b) => a - b);
  if (!availableYears.includes(selectedChartYear)) {
    selectedChartYear = 2026;
  }
  renderMonthlySalesTrend(data.trend, availableYears);
  renderYearlySalesTrend(data);
  renderFilteredSalesTrend(data.trend);
  setupYearWheel(availableYears);
  barList(document.querySelector('#retailers'), data.retailers.map(row => ({ label: row.retailer, value: row.sales, sub: `${row.quantity} units` })), { format: money, indexes: true });
  renderChannelCounters(document.querySelector('#channelCounters'), data.allCounters);
  renderAnimatedRanking(document.querySelector('#ranking'), data.allCounters || []);
  const signals = buildSignals(data.allCounters);
  const aiData = await fetch('/api/ai-insights').then(r => r.json()).catch(() => ({ insights: [] }));
  const allCards = [...(aiData.insights || []), ...signals];
  document.querySelector('#alerts').innerHTML = allCards.length ? allCards.map(signal => `<div class="alert alertCard ${signal.type}${signal.isAi ? ' aiInsightCard' : ''}"><strong>${escapeHtml(signal.title)}</strong><small>${escapeHtml(signal.text)}</small></div>`).join('') : '<p class="hint">Not enough counters in a retailer for a meaningful peer comparison.</p>';
  document.querySelector('#reports').innerHTML = data.periods.map(row => `<div class="report"><div><strong>${escapeHtml(row.retailer)}</strong><small>${row.period_start} to ${row.period_end}${row.source_filename ? ` &middot; ${escapeHtml(row.source_filename)}` : ''}</small></div><div><strong>${money(row.sales)}</strong><small>${row.quantity} units &middot; ${row.jobId ? `<button type="button" class="linkish" data-deimport="${row.jobId}">Undo import</button>` : `<button type="button" class="linkish" data-remove-report="${row.id}">Remove</button>`}</small></div></div>`).join('') || '<p class="hint">No data matches these filters.</p>';

let activeDiscussMenu = null;
function removeDiscussMenu() { if (activeDiscussMenu) { activeDiscussMenu.remove(); activeDiscussMenu = null; } }
document.addEventListener('pointerdown', event => { if (activeDiscussMenu && !activeDiscussMenu.contains(event.target)) removeDiscussMenu(); });

const alertsWrap = document.querySelector('#alerts');
if (alertsWrap && !alertsWrap.dataset.wired) {
  alertsWrap.dataset.wired = 'true';
  alertsWrap.addEventListener('click', event => {
    const card = event.target.closest('.alertCard, .alert');
    if (!card) return;
    removeDiscussMenu();
    const titleText = card.querySelector('strong')?.textContent || '';
    const descText = card.querySelector('small')?.textContent || '';
    const fullInsight = titleText ? `${titleText}: ${descText}` : descText;

    const menu = document.createElement('div');
    menu.className = 'discussContextMenu';
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(event.clientY + 8, window.innerHeight - 60)}px`;
    menu.innerHTML = `<button type="button" class="discussAiBtn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Discuss with AI</button>`;

    menu.querySelector('.discussAiBtn').onclick = e => {
      e.stopPropagation();
      removeDiscussMenu();
      if (window.openChat) window.openChat();
      const chatInput = document.querySelector('#chatInput');
      const chatForm = document.querySelector('#chatForm');
      if (chatInput) {
        chatInput.value = `Can you explain what this means: "${fullInsight}"? Also give me some questions that help me critically think about what changed for that particular month or sales period.`;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          chatForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }, 120);
      }
    };
    document.body.appendChild(menu);
    activeDiscussMenu = menu;
  });
}

const reportsWrap = document.querySelector('#reports');
if (reportsWrap) reportsWrap.onclick = async event => {
  const jobId = event.target.dataset?.deimport;
  const reportId = event.target.dataset?.removeReport;
  if (jobId) {
    if (!confirm('Undo this import? Its rows are removed. Reports it REPLACED stay removed - re-import those if needed.')) return;
    const response = await fetch(`/api/import-jobs/${jobId}/deimport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return alert(result.error || 'Could not undo that import.');
  } else if (reportId) {
    if (!confirm('Remove this report and all its rows? This cannot be undone.')) return;
    const response = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return alert(result.error || 'Could not remove that report.');
  } else return;
  if (window.loadRows) loadRows();
  load();
};
}

function clearFilters() {
  Object.keys(FILTER_IDS).forEach(selector => { const el = document.querySelector(selector); if (el) el.value = ''; });
  const search = document.querySelector('#dSearch');
  if (search) search.value = '';
  if (window.resetPeriod) window.resetPeriod();
  if (window.loadRows) loadRows();
  load();
}

document.querySelector('#activeFilters').onclick = event => {
  const selector = event.target.dataset?.clear;
  if (!selector) return;
  const el = document.querySelector(selector);
  if (el) el.value = '';
  if (window.loadRows) loadRows();
  load();
};
// Manual-entry dialog (restored - a rewrite had dropped its wiring entirely).
const importDialog = document.querySelector('#importDialog');
const saleRowHtml = '<div class="saleRow"><input name="counter" placeholder="Counter name" required><input name="quantity" type="number" min="0" step="1" placeholder="Qty" required><input name="sales" type="number" min="0" step="0.01" placeholder="Sales (RM)" required></div>';
window.openManual = () => importDialog.showModal();
['#closeImport', '#cancelImport'].forEach(selector => document.querySelector(selector).onclick = () => importDialog.close());
document.querySelector('#addRow').onclick = () => document.querySelector('#rows').insertAdjacentHTML('beforeend', saleRowHtml);
document.querySelector('#importForm').onsubmit = async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const body = {
    retailer: form.get('retailer'), periodStart: form.get('periodStart'), periodEnd: form.get('periodEnd'), category: form.get('category'),
    rows: form.getAll('counter').map((counter, index) => ({ counter, quantity: form.getAll('quantity')[index], sales: form.getAll('sales')[index] }))
  };
  const response = await fetch('/api/import/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) return alert((await response.json()).error);
  importDialog.close();
  event.target.reset();
  document.querySelector('#rows').innerHTML = saleRowHtml;
  if (window.loadRows) loadRows();
  load();
};

// Clicking a dialog's backdrop (outside its card) closes it.
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
// Collapsible dashboard sections; whether each is open is remembered - except across UI
// versions, where stale saved state (e.g. graphs left collapsed) caused confusion.
const UI_VERSION = '6';
if (localStorage.getItem('uiVersion') !== UI_VERSION) {
  Object.keys(localStorage).filter(key => key.startsWith('collapsible-')).forEach(key => localStorage.removeItem(key));
  localStorage.setItem('uiVersion', UI_VERSION);
}
document.querySelectorAll('.collapsible').forEach(section => {
  const saved = localStorage.getItem(`collapsible-${section.id}`);
  if (saved === 'closed') section.classList.add('closed');
  section.querySelector('.collHead').onclick = () => {
    section.classList.toggle('closed');
    localStorage.setItem(`collapsible-${section.id}`, section.classList.contains('closed') ? 'closed' : 'open');
    // Charts rendered while hidden had no width to measure; re-measure on reveal.
    if (section.id === 'collOverview' && !section.classList.contains('closed')) load();
  };
});
// ---- ReactBits AnimatedList Component for Best Counters (Top 10) ----
let animatedListKeyNavSetup = false;
let currentAnimatedListRef = null;

function renderAnimatedRanking(container, items) {
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<p class="hint">No data matches these filters.</p>';
    return;
  }

  container.innerHTML = `
    <div class="scroll-list-container ranking-animated-list">
      <div class="scroll-list" id="animatedRankingList" tabindex="0" role="listbox" aria-label="All counters by sales">
        ${items.map((row, index) => `
          <div class="animated-item" data-index="${index}" style="animation-delay: ${index * 0.05}s">
            <div class="item ${index === 0 ? 'selected' : ''}" data-counter="${escapeHtml(row.name)}">
              <div class="rank">
                <b>${index + 1}</b>
                <div>
                  <strong class="item-text">${escapeHtml(row.name)}</strong>
                  <small>${escapeHtml(row.retailer)} &middot; ${row.quantity} units &middot; ${money(row.average_price)} avg/unit</small>
                </div>
                <em>${money(row.sales)}</em>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="top-gradient" id="rankTopGradient" style="opacity: 0"></div>
      <div class="bottom-gradient" id="rankBottomGradient" style="opacity: 1"></div>
    </div>
  `;

  const listEl = container.querySelector('#animatedRankingList');
  const topGrad = container.querySelector('#rankTopGradient');
  const botGrad = container.querySelector('#rankBottomGradient');
  currentAnimatedListRef = listEl;

  if (listEl) {
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = listEl;
      if (topGrad) topGrad.style.opacity = String(Math.min(scrollTop / 40, 1));
      const bottomDistance = scrollHeight - (scrollTop + clientHeight);
      if (botGrad) botGrad.style.opacity = String(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 40, 1));
    };
    listEl.addEventListener('scroll', handleScroll, { passive: true });
    // Initial check
    setTimeout(handleScroll, 50);

    // Hover and Click item selection
    const itemEls = listEl.querySelectorAll('.item');
    itemEls.forEach((el, idx) => {
      el.addEventListener('mouseenter', () => {
        itemEls.forEach(other => other.classList.remove('selected'));
        el.classList.add('selected');
      });
      el.addEventListener('click', () => {
        itemEls.forEach(other => other.classList.remove('selected'));
        el.classList.add('selected');
        // Quick filter shortcut if available
        const sInput = document.querySelector('#dSearch');
        if (sInput) {
          sInput.value = el.dataset.counter || '';
          sInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  }

  // Keyboard navigation across arrow keys / Tab / Enter
  if (!animatedListKeyNavSetup) {
    animatedListKeyNavSetup = true;
    window.addEventListener('keydown', e => {
      if (!currentAnimatedListRef || !document.body.contains(currentAnimatedListRef)) return;
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        // Only trigger if active element is body or within animated list or panel
        const active = document.activeElement;
        const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (inInput) return;

        const items = [...currentAnimatedListRef.querySelectorAll('.item')];
        if (!items.length) return;
        let selectedIdx = items.findIndex(el => el.classList.contains('selected'));

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = Math.min(selectedIdx + 1, items.length - 1);
          items.forEach(el => el.classList.remove('selected'));
          items[nextIdx].classList.add('selected');
          items[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIdx = Math.max(selectedIdx - 1, 0);
          items.forEach(el => el.classList.remove('selected'));
          items[prevIdx].classList.add('selected');
          items[prevIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });
  }
}

// ---- By-counters pane in the Channels carousel: same bar format as By retailer, plus an index; scrollable ----
function renderChannelCounters(container, counters) {
  if (!container) return;
  if (!counters || !counters.length) {
    container.innerHTML = '<p class="hint">No counters match these filters yet.</p>';
    return;
  }
  container.innerHTML = `
    <div class="scroll-list-container channelCountersWrap">
      <div class="channelCounterList"></div>
      <div class="top-gradient"></div>
      <div class="bottom-gradient"></div>
    </div>
  `;
  const listEl = container.querySelector('.channelCounterList');
  barList(listEl, counters.map(row => ({ label: row.name, value: row.sales, sub: `${row.retailer} · ${row.quantity} units · ${money(row.average_price)} avg/unit` })), { format: money, indexes: true });
  const topGrad = container.querySelector('.top-gradient');
  const botGrad = container.querySelector('.bottom-gradient');
  const handleScroll = () => {
    const { scrollTop, scrollHeight, clientHeight } = listEl;
    if (topGrad) topGrad.style.opacity = String(Math.min(scrollTop / 40, 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    if (botGrad) botGrad.style.opacity = String(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 40, 1));
  };
  listEl.addEventListener('scroll', handleScroll, { passive: true });
  setTimeout(handleScroll, 50);
}

// ---- Custom Animated Dropdowns for "All Retailers" & "All Categories" ----
function setupCustomSelect(selectId, wrapId, btnId, menuId, defaultLabel) {
  const select = document.querySelector(selectId);
  const wrap = document.querySelector(wrapId);
  const btn = document.querySelector(btnId);
  const menu = document.querySelector(menuId);
  if (!select || !wrap || !btn || !menu) return;

  const updateDisplay = () => {
    const selectedOption = select.options[select.selectedIndex];
    const label = selectedOption && selectedOption.value ? selectedOption.text : defaultLabel;
    const labelSpan = btn.querySelector('.customSelectLabel');
    if (labelSpan) labelSpan.textContent = label;
  };

  const syncMenuOptions = () => {
    menu.innerHTML = [...select.options].map(opt => `
      <button type="button" class="customSelectItem ${opt.selected ? 'active' : ''}" data-value="${escapeHtml(opt.value)}">
        <span>${escapeHtml(opt.text)}</span>
        ${opt.selected ? '<span class="customSelectCheck">&#10003;</span>' : ''}
      </button>
    `).join('');
  };

  // Close when clicking outside
  document.addEventListener('pointerdown', e => {
    if (!wrap.contains(e.target) && !menu.hidden) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('open');
    }
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    // Close any other open custom select
    document.querySelectorAll('.customSelectMenu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.customSelectBtn').forEach(b => { b.setAttribute('aria-expanded', 'false'); b.classList.remove('open'); });

    if (willOpen) {
      syncMenuOptions();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('open');
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
  });

  // Observe select changes (e.g. data loading or clearing filters)
  select.addEventListener('change', updateDisplay);
  const observer = new MutationObserver(() => {
    updateDisplay();
    syncMenuOptions();
  });
  observer.observe(select, { childList: true, subtree: true });
  updateDisplay();
}

setupCustomSelect('#dRetailer', '#wrapRetailer', '#btnRetailer', '#menuRetailer', 'All retailers');
setupCustomSelect('#dCategory', '#wrapCategory', '#btnCategory', '#menuCategory', 'All categories');

// Monthly sales trend calculation with full 12-month X-axis plotting & OptionWheel Year Selector
let selectedChartYear = 2026;

function renderMonthlySalesTrend(trendData, optionsYears) {
  const trendEl = document.querySelector('#trend');
  const yearSpan = document.querySelector('#chartYearVal');
  if (yearSpan) yearSpan.textContent = selectedChartYear;

  const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullYearTrend = MONTH_NAMES_SHORT.map((name, idx) => {
    const monthNum = String(idx + 1).padStart(2, '0');
    const monthKey = `${selectedChartYear}-${monthNum}`;
    const match = (trendData || []).find(item => item.month === monthKey);
    return {
      label: name,
      value: match ? Number(match.sales || 0) : 0
    };
  });

  const hasData = fullYearTrend.some(m => m.value > 0);
  if (trendEl) {
    trendEl.style.filter = hasData ? 'none' : 'grayscale(1) opacity(0.5)';
  }
  lineChart(trendEl, fullYearTrend, { format: hasData ? money : () => '—' });
}

function initOptionWheel(container, items, initialIndex, onChange) {
  if (!container) return;
  container.innerHTML = '';
  let curIndex = initialIndex;

  const wheelEl = document.createElement('div');
  wheelEl.className = 'option-wheel-3d';
  
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = `option-wheel__item ${i === curIndex ? 'option-wheel__item--selected' : ''}`;
    div.textContent = item;
    div.onclick = () => {
      curIndex = i;
      updateWheelDisplay();
      onChange(i, items[i]);
    };
    wheelEl.appendChild(div);
  });

  function updateWheelDisplay() {
    const itemEls = wheelEl.querySelectorAll('.option-wheel__item');
    itemEls.forEach((el, i) => {
      const dist = i - curIndex;
      const rotateX = dist * 24;
      const opacity = Math.max(0.2, 1 - Math.abs(dist) * 0.35);
      const isSelected = (i === curIndex);
      el.style.transform = `translate(-50%, -50%) rotateX(${rotateX}deg) translateZ(${isSelected ? 65 : 45}px)`;
      el.style.opacity = opacity;
      el.classList.toggle('option-wheel__item--selected', isSelected);
    });
  }

  let isDragging = false;
  let startY = 0;

  wheelEl.onpointerdown = e => {
    isDragging = true;
    startY = e.clientY;
    wheelEl.classList.add('option-wheel--dragging');
  };

  window.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 28) {
      if (dy < 0 && curIndex < items.length - 1) {
        curIndex++;
        startY = e.clientY;
        updateWheelDisplay();
        onChange(curIndex, items[curIndex]);
      } else if (dy > 0 && curIndex > 0) {
        curIndex--;
        startY = e.clientY;
        updateWheelDisplay();
        onChange(curIndex, items[curIndex]);
      }
    }
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
    wheelEl.classList.remove('option-wheel--dragging');
  });

  container.appendChild(wheelEl);
  updateWheelDisplay();
}

function setupYearWheel(years) {
  const yearBtn = document.querySelector('#chartYearVal');
  const popup = document.querySelector('#yearWheelPopup');
  const container = document.querySelector('#optionWheelContainer');
  if (!yearBtn || !popup || !container) return;

  const currentIdx = Math.max(0, years.indexOf(Number(selectedChartYear)));
  initOptionWheel(container, years.map(String), currentIdx, (idx, yearVal) => {
    selectedChartYear = Number(yearVal);
    if (yearBtn) yearBtn.textContent = selectedChartYear;
    if (window.lastDashboardData) {
      renderMonthlySalesTrend(window.lastDashboardData.trend, years);
    }
  });

  yearBtn.onclick = e => {
    e.stopPropagation();
    popup.hidden = !popup.hidden;
  };

  document.addEventListener('pointerdown', e => {
    if (popup && !popup.hidden && !popup.contains(e.target) && e.target !== yearBtn) {
      popup.hidden = true;
    }
  });
}

function renderYearlySalesTrend(data) {
  const yearlyEl = document.querySelector('#yearlyTrend');
  if (!yearlyEl) return;
  const periods = data?.periods || [];
  const yearTotals = {};
  periods.forEach(p => {
    const year = (p.period_start || '').slice(0, 4);
    if (year) {
      yearTotals[year] = (yearTotals[year] || 0) + Number(p.sales || 0);
    }
  });
  const yearsList = Object.keys(yearTotals).sort();
  const yearlyData = yearsList.length ? yearsList.map(y => ({ label: y, value: yearTotals[y] })) : [{ label: '2026', value: 0 }];
  lineChart(yearlyEl, yearlyData, { format: money });
}

function renderFilteredSalesTrend(trendData) {
  const filteredPane = document.querySelector('#filteredPane');
  const filteredEl = document.querySelector('#filteredTrend');
  const hintEl = document.querySelector('#filteredHint');
  if (!filteredEl) return;

  if (applyFiltersToOverview) {
    if (filteredPane) filteredPane.classList.remove('disabled');
    const retVal = filterValue('#dRetailer');
    const catVal = filterValue('#dCategory');
    const filterDesc = [retVal, catVal].filter(Boolean).join(', ');
    if (hintEl) hintEl.textContent = filterDesc ? `Filtered by ${filterDesc}` : 'Showing active filter trend.';
    const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const activeTrend = (trendData && trendData.length)
      ? trendData.map(item => ({ label: item.month ? item.month.slice(5) : item.label, value: Number(item.sales || item.value || 0) }))
      : MONTH_NAMES_SHORT.map(name => ({ label: name, value: 0 }));
    lineChart(filteredEl, activeTrend, { format: money });
  } else {
    if (filteredPane) filteredPane.classList.add('disabled');
    if (hintEl) hintEl.textContent = "Filter inactive — toggle 'Apply current filter' to enable.";
    const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const baselineTrend = MONTH_NAMES_SHORT.map(name => ({ label: name, value: 0 }));
    lineChart(filteredEl, baselineTrend, { format: () => '—' });
  }
}

load();
