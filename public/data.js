// Main spreadsheet view: the table IS the page. Filters here also drive the stats strip and charts (via load()).
const $data = selector => document.querySelector(selector);
const dataState = { page: 1, sort: 'period', dir: 'desc', retailer: '', category: '', q: '', editRow: null, editMode: false, period: { year: null, months: {}, from: '', to: '' }, years: [] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Resolved filter: a date range (all time / year / custom), plus multi-month includes and
// right-click excludes. months/exMonths are '8,9' lists of month numbers.
function currentPeriod() {
  const p = dataState.period;
  const inc = [], exc = [];
  for (let i = 0; i < 12; i++) {
    if (p.months[i] === 'on') inc.push(i + 1);
    else if (p.months[i] === 'excl') exc.push(i + 1);
  }
  const range = (p.from || p.to) ? { from: p.from, to: p.to } : (p.year != null ? { from: `${p.year}-01-01`, to: `${p.year}-12-31` } : { from: '', to: '' });
  return { ...range, months: inc.join(','), exMonths: exc.join(',') };
}
function periodLabel() {
  const p = dataState.period;
  const short = iso => iso ? iso.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => `${+d}/${+m}/${y.slice(2)}`) : '';
  if (p.from || p.to) return `${short(p.from) || '…'} – ${short(p.to) || '…'}`;
  const inc = [], exc = [];
  for (let i = 0; i < 12; i++) { if (p.months[i] === 'on') inc.push(MONTHS[i]); else if (p.months[i] === 'excl') exc.push(MONTHS[i]); }
  const yearText = p.year == null ? 'every year' : String(p.year);
  if (!inc.length && !exc.length) return p.year == null ? 'All time' : yearText;
  let label = inc.length ? `${inc.join(' + ')}` : 'All months';
  if (exc.length) label += ` except ${exc.join(', ')}`;
  return p.year == null ? `${label} · all years` : `${label} ${yearText}`;
}
function resetPeriod() { dataState.period = { year: null, months: {}, from: '', to: '' }; renderPeriodPicker(); }
function applyPeriod() { dataState.page = 1; loadRows(); load(); }
window.currentPeriod = currentPeriod;
window.periodLabel = periodLabel;
window.resetPeriod = resetPeriod;

function renderPeriodPicker() {
  $data('#periodBtn').innerHTML = `${escapeHtml(periodLabel())} &darr;`;
  const p = dataState.period;
  $data('#ppYears').innerHTML = [`<button type="button" class="ppBtn secondary ${p.year == null && !p.from && !p.to ? 'on' : ''}" data-year="">Reset</button>`]
    .concat(dataState.years.map(y => `<button type="button" class="ppBtn secondary ${p.year === y && !p.from && !p.to ? 'on' : ''}" data-year="${y}">${y}</button>`)).join('');
  $data('#ppMonths').innerHTML = MONTHS.map((m, i) => {
    const state = p.months[i] || '';
    return `<button type="button" class="ppBtn secondary ${state}" data-month="${i}" title="${state === 'excl' ? 'Right-click to include again' : 'Right-click to exclude ' + m}">${m}</button>`;
  }).join('');
  $data('#ppFrom').value = p.from; $data('#ppTo').value = p.to;
}

function wirePeriodPicker() {
  const pop = $data('#periodPop');
  $data('#periodBtn').onclick = event => { event.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) renderPeriodPicker(); };
  // pointerdown fires before any click handler can re-render (and detach) the button that was
  // clicked, so inside/outside detection can't be fooled in either direction.
  document.addEventListener('pointerdown', event => {
    if (pop.hidden) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (!path.some(el => el.classList && el.classList.contains('periodPicker'))) pop.hidden = true;
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !pop.hidden) pop.hidden = true; });
  $data('#ppYears').onclick = event => {
    const year = event.target.dataset?.year;
    if (year === undefined) return;
    // The re-render below detaches the clicked button before this click reaches the document
    // listener, which would then see it as "outside" and close the menu - so stop here.
    event.stopPropagation();
    dataState.period.year = year === '' ? null : Number(year);
    dataState.period.from = ''; dataState.period.to = '';
    renderPeriodPicker();
    applyPeriod();
  };
  // Left click toggles a month on/off; right click marks it as an exception (excluded) and back.
  // Neither closes the menu - only clicking outside does.
  $data('#ppMonths').onclick = event => {
    const month = event.target.dataset?.month;
    if (month === undefined) return;
    event.stopPropagation();
    const idx = Number(month);
    dataState.period.months[idx] = dataState.period.months[idx] === 'on' ? '' : 'on';
    dataState.period.from = ''; dataState.period.to = '';
    renderPeriodPicker();
    applyPeriod();
  };
  $data('#ppMonths').oncontextmenu = event => {
    const month = event.target.dataset?.month;
    if (month === undefined) return;
    event.preventDefault();
    const idx = Number(month);
    dataState.period.months[idx] = dataState.period.months[idx] === 'excl' ? '' : 'excl';
    dataState.period.from = ''; dataState.period.to = '';
    renderPeriodPicker();
    applyPeriod();
  };
  // Custom range applies the moment both dates are picked - no Apply button needed.
  const onRangeChange = () => {
    dataState.period = { year: null, months: {}, from: $data('#ppFrom').value, to: $data('#ppTo').value };
    renderPeriodPicker();
    applyPeriod();
  };
  $data('#ppFrom').onchange = onRangeChange;
  $data('#ppTo').onchange = onRangeChange;
  $data('#ppReset').onclick = () => { resetPeriod(); applyPeriod(); };
}

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
  const params = new URLSearchParams({ page: dataState.page, sort: dataState.sort, dir: dataState.dir, retailer: dataState.retailer, category: dataState.category, from: range.from, to: range.to, months: range.months, exMonths: range.exMonths, q: dataState.q });
  const data = await fetch(`/api/rows?${params}`).then(r => r.json()).catch(() => null);
  if (!data) { $data('#dataTable').innerHTML = '<p class="hint">Couldn\'t load rows.</p>'; return; }
  const has = data.columns || {};
  const COLUMNS = visibleColumns(has);
  // One shared column template drives header, rows, and footer - no filler column can appear.
  const widths = { counter: 'minmax(200px,1.8fr)', retailer: 'minmax(110px,1fr)', category: 'minmax(110px,1fr)', period: 'minmax(110px,auto)', productName: 'minmax(140px,auto)', sku: 'minmax(90px,auto)' };
  const template = COLUMNS.map(c => c.num ? 'minmax(88px,auto)' : (widths[c.key] || 'minmax(90px,auto)')).concat(dataState.editMode ? ['minmax(160px,auto)'] : []).join(' ');
  const headCells = COLUMNS.map(c => `<div class="dsCell ${c.sort ? 'sortable' : ''}${c.num ? ' num' : ''}${dataState.sort === c.sort ? ' on' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''}>${c.label}${dataState.sort === c.sort ? (dataState.dir === 'asc' ? ' ▲' : ' ▼') : ''}</div>`).join('') + (dataState.editMode ? '<div class="dsCell"></div>' : '');
  const body = data.rows.map(row => row.id === dataState.editRow ? editRowHtml(row, COLUMNS) : displayRowHtml(row, COLUMNS)).join('');
  const totals = data.totals || {};
  const footCells = COLUMNS.map(c => c.key === 'counter'
    ? `<div class="dsCell counterName">Total (${data.total.toLocaleString()} rows)</div>`
    : `<div class="dsCell ${c.num ? 'num' : ''}">${c.num ? Number(totals[c.key] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</div>`).join('') + (dataState.editMode ? '<div class="dsCell"></div>' : '');
  $data('#dataTable').innerHTML = `
    <div class="dsHead" style="--cols:${template}">${headCells}</div>
    <div class="dsBody" style="--cols:${template}">${body || '<div class="hint" style="padding:22px 14px">No rows match these filters.</div>'}</div>
    <div class="dsFoot" style="--cols:${template}">${footCells}</div>
    <div class="pageBar"><button type="button" class="secondary" id="dPrev" ${data.page <= 1 ? 'disabled' : ''}>&larr; Previous</button><small>Page ${data.page} of ${data.pages} &middot; ${data.total.toLocaleString()} rows</small><button type="button" class="secondary" id="dNext" ${data.page >= data.pages ? 'disabled' : ''}>Next &rarr;</button></div>`;
  const prev = $data('#dPrev'), next = $data('#dNext');
  if (prev) prev.onclick = () => { dataState.page--; loadRows(); };
  if (next) next.onclick = () => { dataState.page++; loadRows(); };
}

const ALL_COLUMNS = [
  { key: 'counter', label: 'Counter', sort: 'counter', cls: 'counterName' },
  { key: 'retailer', label: 'Retailer', sort: 'retailer' },
  { key: 'category', label: 'Category', sort: 'category' },
  { key: 'productName', label: 'Product', optional: 'product' },
  { key: 'sku', label: 'SKU', optional: 'sku' },
  { key: 'quantity', label: 'Qty', sort: 'quantity', num: true },
  { key: 'sales', label: 'Sales (RM)', sort: 'sales', num: true },
  { key: 'cost', label: 'Cost', num: true, optional: 'cost' },
  { key: 'profit', label: 'Profit', num: true, optional: 'profit' },
  { key: 'period', label: 'Period', sort: 'period', cls: 'mutedcol' }
];
const visibleColumns = has => ALL_COLUMNS.filter(c => !c.optional || has[c.optional]);

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
const sortIndex = columns => columns.findIndex(c => c.sort === dataState.sort);
const rowCellClass = (col, ci, columns) => `${col.num ? 'num' : ''}${col.cls ? ` ${col.cls}` : ''}${ci === sortIndex(columns) ? ' sortedCol' : ''}`;

const displayRowHtml = (row, columns) => `<div class="dsRow" data-id="${row.id}">
  ${columns.map((c, ci) => `<div class="dsCell ${rowCellClass(c, ci, columns)}">${cellText(row, c)}</div>`).join('')}
  ${dataState.editMode ? `<div class="dsCell rowActions"><button type="button" class="secondary" data-edit="${row.id}">Edit</button><button type="button" class="secondary danger" data-del="${row.id}">Delete</button></div>` : ''}</div>`;

const editInput = (row, key, num = false) => `<input value="${row[key] ?? ''}" data-k="${key}" ${num ? 'type="number" step="any"' : ''}>`;
const editRowHtml = (row, columns) => `<div class="dsRow editing" data-id="${row.id}">
  ${columns.map((c, ci) => `<div class="dsCell ${rowCellClass(c, ci, columns)}">${['retailer', 'period'].includes(c.key) ? cellText(row, c) : editInput(row, c.key, c.num)}</div>`).join('')}
  <div class="dsCell rowActions"><button type="button" id="dSave">Save</button><button type="button" class="secondary" id="dCancel">Cancel</button></div></div>`;

$data('#dataTable').addEventListener('click', async event => {
  const edit = event.target.dataset?.edit;
  const del = event.target.dataset?.del;
  const sortKey = event.target.closest('.dsCell.sortable')?.dataset?.sort;
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
    const rowEl = event.target.closest('.dsRow');
    const body = {};
    rowEl.querySelectorAll('input[data-k]').forEach(input => { body[input.dataset.k] = input.value; });
    const response = await fetch(`/api/rows/${rowEl.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
