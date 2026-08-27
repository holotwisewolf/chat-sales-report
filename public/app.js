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
  const params = new URLSearchParams(Object.fromEntries(Object.entries(FILTER_IDS).map(([selector, key]) => [key, filterValue(selector)])));
  const range = window.currentPeriod ? window.currentPeriod() : {};
  params.set('from', range.from || '');
  params.set('to', range.to || '');
  params.set('monthOfYear', range.monthOfYear || '');
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
    ? periodChip + chips.map(([selector, key]) => `<span class="filterChip">${labels[key]}: ${escapeHtml(filterValue(selector))}<button type="button" data-clear="${selector}" aria-label="Clear filter">&times;</button></span>`).join('') + '<button type="button" class="linkish" id="clearAll">clear all</button>'
    : '<span class="filterChip all">All data &mdash; use the filters above the table to focus.</span>';
  const clearPeriod = document.querySelector('#clearPeriod');
  if (clearPeriod) clearPeriod.onclick = () => { if (window.resetPeriod) window.resetPeriod(); loadRows(); load(); };
  const clearAll = document.querySelector('#clearAll');
  if (clearAll) clearAll.onclick = clearFilters;
  const cats = data.categoryTotals || [];
  const catRow = document.querySelector('#categoryRow');
  if (cats.length >= 2) { catRow.hidden = false; catRow.innerHTML = cats.map(c => `<article><span>${escapeHtml(c.category)}</span><strong>${money(c.sales)}</strong><small>${Number(c.quantity).toLocaleString()} units</small></article>`).join(''); }
  else catRow.hidden = true;
  lineChart(document.querySelector('#trend'), data.trend.map(item => ({ label: item.month, value: item.sales })), { format: money });
  barList(document.querySelector('#retailers'), data.retailers.map(row => ({ label: row.retailer, value: row.sales, sub: `${row.quantity} units` })), { format: money });
  document.querySelector('#ranking').innerHTML = data.ranking.map((row, index) => `<div class="rank"><b>${index + 1}</b><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.retailer)} &middot; ${row.quantity} units &middot; ${money(row.average_price)} avg/unit</small></div><em>${money(row.sales)}</em></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
  const signals = buildSignals(data.allCounters);
  document.querySelector('#alerts').innerHTML = signals.length ? signals.map(signal => `<div class="alert ${signal.type}"><strong>${escapeHtml(signal.title)}</strong><small>${escapeHtml(signal.text)}</small></div>`).join('') : '<p class="hint">Not enough counters in a retailer for a meaningful peer comparison.</p>';
  document.querySelector('#reports').innerHTML = data.periods.map(row => `<div class="report"><div><strong>${escapeHtml(row.retailer)}</strong><small>${row.period_start} to ${row.period_end}${row.source_filename ? ` &middot; ${escapeHtml(row.source_filename)}` : ''}</small></div><div><strong>${money(row.sales)}</strong><small>${row.quantity} units</small></div></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
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
document.querySelector('#resetFilters').onclick = clearFilters;
// Collapsible dashboard sections; whether each is open is remembered.
document.querySelectorAll('.collapsible').forEach(section => {
  const saved = localStorage.getItem(`collapsible-${section.id}`);
  if (saved === 'closed') section.classList.add('closed');
  section.querySelector('.collHead').onclick = () => {
    section.classList.toggle('closed');
    localStorage.setItem(`collapsible-${section.id}`, section.classList.contains('closed') ? 'closed' : 'open');
  };
});
load();
