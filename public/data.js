// Main spreadsheet view: the table IS the page. Filters here also drive the stats strip and charts (via load()).
const $data = selector => document.querySelector(selector);
const dataState = { page: 1, sort: 'period', dir: 'desc', retailer: '', category: '', q: '', editRow: null, editMode: false, period: { year: null, monthIdx: null, from: '', to: '' }, years: [] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Resolved date range for the current picker state: all time, a year, a month of a year, or custom.
function currentPeriod() {
  const p = dataState.period;
  if (p.from || p.to) return { from: p.from, to: p.to };
  if (p.year == null) return { from: '', to: '' };
  if (p.monthIdx == null) return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  const mm = String(p.monthIdx + 1).padStart(2, '0');
  const lastDay = new Date(Date.UTC(p.year, p.monthIdx + 1, 0)).getUTCDate();
  return { from: `${p.year}-${mm}-01`, to: `${p.year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}
function periodLabel() {
  const p = dataState.period;
  const short = iso => iso ? iso.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => `${+d}/${+m}/${y.slice(2)}`) : '';
  if (p.from || p.to) return `${short(p.from) || '…'} – ${short(p.to) || '…'}`;
  if (p.year == null) return 'All time';
  return p.monthIdx == null ? String(p.year) : `${MONTHS[p.monthIdx]} ${p.year}`;
}
function resetPeriod() { dataState.period = { year: null, monthIdx: null, from: '', to: '' }; renderPeriodPicker(); }
function applyPeriod() { dataState.page = 1; loadRows(); load(); }
window.currentPeriod = currentPeriod;
window.periodLabel = periodLabel;
window.resetPeriod = resetPeriod;

function renderPeriodPicker() {
  $data('#periodBtn').innerHTML = `${escapeHtml(periodLabel())} &darr;`;
  const p = dataState.period;
  $data('#ppYears').innerHTML = [`<button type="button" class="ppBtn secondary ${p.year == null && !p.from && !p.to ? 'on' : ''}" data-year="">All</button>`]
    .concat(dataState.years.map(y => `<button type="button" class="ppBtn secondary ${p.year === y && !p.from && !p.to ? 'on' : ''}" data-year="${y}">${y}</button>`)).join('');
  const monthsEnabled = p.year != null;
  $data('#ppMonths').innerHTML = MONTHS.map((m, i) => `<button type="button" class="ppBtn secondary ${p.monthIdx === i && monthsEnabled ? 'on' : ''}" data-month="${i}" ${monthsEnabled ? '' : 'disabled'}>${m}</button>`).join('');
  $data('#ppFrom').value = p.from; $data('#ppTo').value = p.to;
}

function wirePeriodPicker() {
  const pop = $data('#periodPop');
  $data('#periodBtn').onclick = event => { event.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) renderPeriodPicker(); };
  document.addEventListener('click', event => { if (!pop.hidden && !event.target.closest('.periodPicker')) pop.hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !pop.hidden) pop.hidden = true; });
  $data('#ppYears').onclick = event => {
    const year = event.target.dataset?.year;
    if (year === undefined) return;
    dataState.period = { year: year === '' ? null : Number(year), monthIdx: null, from: '', to: '' };
    renderPeriodPicker();
    applyPeriod();
  };
  $data('#ppMonths').onclick = event => {
    const month = event.target.dataset?.month;
    if (month === undefined || dataState.period.year == null) return;
    const idx = Number(month);
    dataState.period.monthIdx = dataState.period.monthIdx === idx ? null : idx;
    renderPeriodPicker();
    applyPeriod();
  };
  $data('#ppApply').onclick = () => {
    dataState.period = { year: null, monthIdx: null, from: $data('#ppFrom').value, to: $data('#ppTo').value };
    pop.hidden = true;
    applyPeriod();
  };
  $data('#ppReset').onclick = () => { resetPeriod(); pop.hidden = true; applyPeriod(); };
}
const COLUMNS = [
  { key: 'counter', label: 'Counter', sort: 'counter', cls: 'counterName' },
  { key: 'retailer', label: 'Retailer', sort: 'retailer' },
  { key: 'category', label: 'Category', sort: 'category' },
  { key: 'productName', label: 'Product' },
  { key: 'sku', label: 'SKU' },
  { key: 'quantity', label: 'Qty', sort: 'quantity', num: true },
  { key: 'sales', label: 'Sales (RM)', sort: 'sales', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true },
  { key: 'period', label: 'Period', sort: 'period', cls: 'mutedcol' }
];

async function populateDataFilters() {
  const options = await fetch('/api/dashboard').then(r => r.json()).then(b => b.options).catch(() => null);
  if (!options) return;
  const fill = (id, values, all) => { $data(id).innerHTML = `<option value="">${all}</option>${values.map(v => `<option>${escapeHtml(v)}</option>`).join('')}`; };
  fill('#dRetailer', options.retailers, 'All retailers');
  fill('#dCategory', options.categories, 'All categories');
  $data('#counterList').innerHTML = (options.counters || []).map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
  dataState.years = [...new Set((options.months || []).map(m => m.slice(0, 4)))].sort().reverse().map(Number);
  $data('#dRetailer').value = dataState.retailer; $data('#dCategory').value = dataState.category;
  renderPeriodPicker();
}

async function loadRows() {
  const range = currentPeriod();
  const params = new URLSearchParams({ page: dataState.page, sort: dataState.sort, dir: dataState.dir, retailer: dataState.retailer, category: dataState.category, from: range.from, to: range.to, q: dataState.q });
  const data = await fetch(`/api/rows?${params}`).then(r => r.json()).catch(() => null);
  if (!data) { $data('#dataTable').innerHTML = '<p class="hint">Couldn\'t load rows.</p>'; return; }
  const head = `<thead><tr>${COLUMNS.map(c => `<th ${c.sort ? `data-sort="${c.sort}" class="sortable${c.num ? ' num' : ''}${dataState.sort === c.sort ? ' on' : ''}"` : ''}>${c.label}${dataState.sort === c.sort ? (dataState.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}${dataState.editMode ? '<th></th>' : ''}</tr></thead>`;
  const body = data.rows.map(row => row.id === dataState.editRow ? editRowHtml(row) : displayRowHtml(row)).join('');
  $data('#dataTable').innerHTML = `<div class="tableWrap"><table>${head}<tbody>${body || `<tr><td colspan="${COLUMNS.length + 1}" class="hint" style="padding:22px">No rows match these filters.</td></tr>`}</tbody></table></div>
    <div class="pageBar"><button type="button" class="secondary" id="dPrev" ${data.page <= 1 ? 'disabled' : ''}>&larr; Previous</button><small>Page ${data.page} of ${data.pages} &middot; ${data.total.toLocaleString()} rows</small><button type="button" class="secondary" id="dNext" ${data.page >= data.pages ? 'disabled' : ''}>Next &rarr;</button></div>`;
  const prev = $data('#dPrev'), next = $data('#dNext');
  if (prev) prev.onclick = () => { dataState.page--; loadRows(); };
  if (next) next.onclick = () => { dataState.page++; loadRows(); };
}

const shortDate = iso => { if (!iso) return null; const [, m, d] = iso.split('-'); return `${+d}/${+m}`; };
const periodText = row => {
  const start = shortDate(row.periodStart), end = shortDate(row.periodEnd);
  if (!start && !end) return '';
  const yy = (row.periodEnd || '').slice(2, 4);
  return `${start || '?'}–${end || '?'}${yy ? `/${yy}` : ''}`;
};
const cellText = (row, col) => {
  if (col.key === 'period') return escapeHtml(periodText(row));
  const value = row[col.key];
  if (value == null) return '';
  return col.num ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : escapeHtml(String(value));
};
const sortIndex = () => COLUMNS.findIndex(c => c.sort === dataState.sort);
const cellClass = (col, index) => `${col.num ? 'num' : ''}${col.cls ? ` ${col.cls}` : ''}${index === sortIndex() ? ' sortedCol' : ''}`;

const displayRowHtml = row => `<tr data-id="${row.id}" class="${dataState.editMode ? 'editable' : ''}">
  ${COLUMNS.map((c, ci) => `<td class="${cellClass(c, ci)}">${cellText(row, c)}</td>`).join('')}
  ${dataState.editMode ? `<td class="rowActions"><button type="button" class="secondary" data-edit="${row.id}">Edit</button><button type="button" class="secondary danger" data-del="${row.id}">Delete</button></td>` : ''}</tr>`;

const editInput = (row, key, num = false) => `<input value="${row[key] ?? ''}" data-k="${key}" ${num ? 'type="number" step="any"' : ''}>`;
const editRowHtml = row => `<tr data-id="${row.id}" class="editing">
  ${COLUMNS.map((c, ci) => `<td class="${cellClass(c, ci)}">${['retailer', 'period'].includes(c.key) ? cellText(row, c) : editInput(row, c.key, c.num)}</td>`).join('')}
  <td class="rowActions"><button type="button" id="dSave">Save</button><button type="button" class="secondary" id="dCancel">Cancel</button></td></tr>`;

$data('#dataTable').addEventListener('click', async event => {
  const edit = event.target.dataset?.edit;
  const del = event.target.dataset?.del;
  const sortKey = event.target.closest('th')?.dataset?.sort;
  if (edit) { dataState.editRow = Number(edit); loadRows(); return; }
  if (del) {
    if (!confirm('Delete this row? This cannot be undone.')) return;
    await fetch(`/api/rows/${del}`, { method: 'DELETE' });
    loadRows();
    load();
    return;
  }
  if (event.target.id === 'dCancel') { dataState.editRow = null; loadRows(); return; }
  if (event.target.id === 'dSave') {
    const tr = event.target.closest('tr');
    const body = {};
    tr.querySelectorAll('input[data-k]').forEach(input => { body[input.dataset.k] = input.value; });
    const response = await fetch(`/api/rows/${tr.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return alert(result.error || 'Could not save that row.');
    dataState.editRow = null;
    loadRows();
    load();
    return;
  }
  if (sortKey) {
    if (dataState.sort === sortKey) dataState.dir = dataState.dir === 'asc' ? 'desc' : 'asc';
    else { dataState.sort = sortKey; dataState.dir = 'desc'; }
    dataState.page = 1;
    loadRows();
  }
});

$data('#editMode').onchange = event => { dataState.editMode = event.target.checked; dataState.editRow = null; loadRows(); };
[['#dRetailer', 'retailer'], ['#dCategory', 'category']].forEach(([selector, key]) => {
  $data(selector).onchange = event => { dataState[key] = event.target.value; dataState.page = 1; loadRows(); load(); };
});
let searchTimer;
$data('#dSearch').oninput = event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { dataState.q = event.target.value.trim(); dataState.page = 1; loadRows(); }, 300); };

wirePeriodPicker();
populateDataFilters().then(loadRows);
