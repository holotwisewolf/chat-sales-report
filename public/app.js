const money = n => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n || 0);
const filters = ['month', 'retailer', 'category'];
const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const median = values => { const sorted = values.slice().sort((a,b) => a-b); const half = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2; };

function populateSelect(id, values, value) {
  const select = document.querySelector(`#${id}`);
  const label = id === 'month' ? 'All months' : `All ${id}s`;
  select.innerHTML = `<option value="">${label}</option>${values.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
  select.value = value;
}

function buildSignals(counters) {
  const byRetailer = counters.reduce((groups, counter) => { (groups[counter.retailer] ||= []).push(counter); return groups; }, {});
  return Object.values(byRetailer).flatMap(group => {
    if (group.length < 4) return [];
    const salesMedian = median(group.map(row => row.sales));
    const qtyMedian = median(group.map(row => row.quantity));
    const priceMedian = median(group.map(row => row.average_price));
    const high = group[0];
    const low = group[group.length - 1];
    const results = [];
    if (high.sales >= salesMedian * 1.5) results.push({ type: 'high', title: `${high.name} is above its ${high.retailer} peers`, text: `${money(high.sales)} is ${Math.round(high.sales / salesMedian * 100)}% of the retailer median; ${high.quantity} units vs median ${qtyMedian}, at ${money(high.average_price)} per unit vs median ${money(priceMedian)}.` });
    if (low.sales <= salesMedian * .55) results.push({ type: 'low', title: `${low.name} needs a check`, text: `${money(low.sales)} is ${Math.round(low.sales / salesMedian * 100)}% of the ${low.retailer} median; ${low.quantity} units vs median ${qtyMedian}, at ${money(low.average_price)} per unit vs median ${money(priceMedian)}.` });
    return results;
  }).slice(0, 4);
}

async function load() {
  const current = Object.fromEntries(filters.map(id => [id, document.querySelector(`#${id}`).value]));
  const data = await fetch(`/api/dashboard?${new URLSearchParams(current)}`).then(response => response.json());
  populateSelect('month', data.options.months, current.month);
  populateSelect('retailer', data.options.retailers, current.retailer);
  populateSelect('category', data.options.categories, current.category);
  const labels = { month: 'Month', retailer: 'Retailer', category: 'Category' };
  const chips = filters.filter(id => document.querySelector(`#${id}`).value);
  document.querySelector('#activeFilters').innerHTML = chips.length
    ? chips.map(id => `<span class="filterChip">${labels[id]}: ${escapeHtml(document.querySelector(`#${id}`).value)}<button type="button" data-clear="${id}" aria-label="Clear filter">&times;</button></span>`).join('') + '<button type="button" class="linkish" id="clearAll">clear all</button>'
    : '<span class="filterChip all">Showing all data &mdash; pick a month, retailer, or category above to focus.</span>';
  const clearAll = document.querySelector('#clearAll');
  if (clearAll) clearAll.onclick = () => { filters.forEach(id => document.querySelector(`#${id}`).value = ''); load(); };
  const cats = data.categoryTotals || [];
  const catRow = document.querySelector('#categoryRow');
  if (cats.length >= 2) { catRow.hidden = false; catRow.innerHTML = cats.map(c => `<article><span>${escapeHtml(c.category)}</span><strong>${money(c.sales)}</strong><small>${Number(c.quantity).toLocaleString()} units</small></article>`).join(''); }
  else catRow.hidden = true;
  document.querySelector('#sales').textContent = money(data.summary.sales);
  document.querySelector('#units').textContent = Number(data.summary.quantity).toLocaleString();
  document.querySelector('#counters').textContent = data.summary.counters;
  document.querySelector('#top').textContent = data.ranking[0]?.name || '—';
  lineChart(document.querySelector('#trend'), data.trend.map(item => ({ label: item.month, value: item.sales })), { format: money });
  barList(document.querySelector('#retailers'), data.retailers.map(row => ({ label: row.retailer, value: row.sales, sub: `${row.quantity} units` })), { format: money });
  document.querySelector('#ranking').innerHTML = data.ranking.map((row, index) => `<div class="rank"><b>${index + 1}</b><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.retailer)} &middot; ${row.quantity} units &middot; ${money(row.average_price)} avg/unit</small></div><em>${money(row.sales)}</em></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
  const signals = buildSignals(data.allCounters);
  document.querySelector('#alerts').innerHTML = signals.length ? signals.map(signal => `<div class="alert ${signal.type}"><strong>${escapeHtml(signal.title)}</strong><small>${escapeHtml(signal.text)}</small></div>`).join('') : '<p class="hint">Not enough counters in a retailer for a meaningful peer comparison.</p>';
  document.querySelector('#reports').innerHTML = data.periods.map(row => `<div class="report"><div><strong>${escapeHtml(row.retailer)}</strong><small>${row.period_start} to ${row.period_end}${row.source_filename ? ` &middot; ${escapeHtml(row.source_filename)}` : ''}</small></div><div><strong>${money(row.sales)}</strong><small>${row.quantity} units</small></div></div>`).join('') || '<p class="hint">No data matches these filters.</p>';
}

filters.forEach(id => document.querySelector(`#${id}`).onchange = load);
document.querySelector('#activeFilters').onclick = event => { const id = event.target.dataset?.clear; if (id) { document.querySelector(`#${id}`).value = ''; load(); } };
document.querySelector('#resetFilters').onclick = () => { filters.forEach(id => document.querySelector(`#${id}`).value = ''); load(); };
const dialog = document.querySelector('#importDialog');
document.querySelector('#showImport').onclick = () => dialog.showModal();
['#closeImport', '#cancelImport'].forEach(selector => document.querySelector(selector).onclick = () => dialog.close());
document.querySelector('#addRow').onclick = () => document.querySelector('#rows').insertAdjacentHTML('beforeend', '<div class="saleRow"><input name="counter" placeholder="Counter name" required><input name="quantity" type="number" min="0" step="1" placeholder="Qty" required><input name="sales" type="number" min="0" step="0.01" placeholder="Sales (RM)" required></div>');
document.querySelector('#importForm').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.target); const counters = form.getAll('counter'); const body = { retailer: form.get('retailer'), periodStart: form.get('periodStart'), periodEnd: form.get('periodEnd'), category: form.get('category'), rows: counters.map((counter, index) => ({ counter, quantity: form.getAll('quantity')[index], sales: form.getAll('sales')[index] })) }; const response = await fetch('/api/import/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) return alert((await response.json()).error); dialog.close(); event.target.reset(); document.querySelector('#rows').innerHTML = '<div class="saleRow"><input name="counter" placeholder="Counter name" required><input name="quantity" type="number" min="0" step="1" placeholder="Qty" required><input name="sales" type="number" min="0" step="0.01" placeholder="Sales (RM)" required></div>'; load(); };
load();
