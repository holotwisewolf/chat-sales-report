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

async function renderDashboard() {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(FILTER_IDS).map(([selector, key]) => [key, filterValue(selector)])));
  const range = window.currentPeriod ? window.currentPeriod() : {};
  params.set('from', range.from || '');
  params.set('to', range.to || '');
  params.set('months', range.months || '');
  params.set('exMonths', range.exMonths || '');
  const data = await fetch(`/api/dashboard?${params}`).then(response => response.json());
  document.querySelector('#sales').textContent = money(data.summary.sales);
  document.querySelector('#units').textContent = Number(data.summary.quantity).toLocaleString();
  document.querySelector('#counters').textContent = data.summary.counters;
  document.querySelector('#top').textContent = data.ranking[0]?.name || '—';
  const labels = { retailer: 'Retailer', category: 'Category' };
  const chips = Object.entries(FILTER_IDS).filter(([selector]) => filterValue(selector));
  const periodChip = window.periodLabel && window.periodLabel() !== 'All time'
    ? `<span class="filterChip">Period: ${escapeHtml(window.periodLabel())}<button type="button" id="clearPeriod" aria-label="Clear period">&times;</button></span>` : '';
  document.querySelector('#activeFilters').innerHTML = (chips.length || periodChip)
    ? '<span class="statusLabel">Showing</span>' + periodChip + chips.map(([selector, key]) => `<span class="filterChip">${labels[key]}: ${escapeHtml(filterValue(selector))}<button type="button" data-clear="${selector}" aria-label="Clear filter">&times;</button></span>`).join('') + '<button type="button" class="linkish" id="clearAll">clear all</button>'
    : '<span class="statusLabel">Showing</span><span class="filterChip all">everything &mdash; use the filters above the table to focus.</span>';
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
  // The line chart handles any number of months (one month plots as a single point);
  // with no months at all, show the category comparison instead of an empty panel.
  if (data.trend.length >= 1) {
    lineChart(document.querySelector('#trend'), data.trend.map(item => ({ label: item.month, value: item.sales })), { format: money });
  } else if ((data.categoryTotals || []).length >= 2) {
    document.querySelector('#trend').innerHTML = '<p class="hint" style="margin-bottom:6px">No monthly data in this filter yet &mdash; showing categories.</p>';
    barList(document.querySelector('#trend'), data.categoryTotals.map(c => ({ label: c.category, value: c.sales, sub: `${Number(c.quantity).toLocaleString()} units` })), { format: money });
  } else {
    lineChart(document.querySelector('#trend'), [], { format: money });
  }
  barList(document.querySelector('#retailers'), data.retailers.map(row => ({ label: row.retailer, value: row.sales, sub: `${row.quantity} units` })), { format: money });
  document.querySelector('#ranking').innerHTML = data.ranking.map((row, index) => `<div class="rank"><b>${index + 1}</b><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.retailer)} &middot; ${row.quantity} units &middot; ${money(row.average_price)} avg/unit</small></div><em>${money(row.sales)}</em></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
  const signals = buildSignals(data.allCounters);
  document.querySelector('#alerts').innerHTML = signals.length ? signals.map(signal => `<div class="alert ${signal.type}"><strong>${escapeHtml(signal.title)}</strong><small>${escapeHtml(signal.text)}</small></div>`).join('') : '<p class="hint">Not enough counters in a retailer for a meaningful peer comparison.</p>';
  document.querySelector('#reports').innerHTML = data.periods.map(row => `<div class="report"><div><strong>${escapeHtml(row.retailer)}</strong><small>${row.period_start} to ${row.period_end}${row.source_filename ? ` &middot; ${escapeHtml(row.source_filename)}` : ''}</small></div><div><strong>${money(row.sales)}</strong><small>${row.quantity} units${row.jobId ? ' &middot; <button type="button" class="linkish" data-deimport="' + row.jobId + '">Undo import</button>' : ''}</small></div></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
const reportsWrap = document.querySelector('#reports');
if (reportsWrap) reportsWrap.onclick = async event => {
  const jobId = event.target.dataset?.deimport;
  if (!jobId) return;
  if (!confirm('Undo this import? Its rows are removed. Reports it REPLACED stay removed - re-import those if needed.')) return;
  const response = await fetch(`/api/import-jobs/${jobId}/deimport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return alert(result.error || 'Could not undo that import.');
  if (window.loadRows) loadRows();
  load();
};
document.querySelector('#printBtn').onclick = () => window.print();
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
    if (section.id === 'collCharts' && !section.classList.contains('closed')) load();
  };
});
load();
