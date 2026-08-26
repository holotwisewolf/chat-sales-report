// Main spreadsheet view: the table IS the page. Filters here also drive the stats strip and charts (via load()).
const $data = selector => document.querySelector(selector);
const dataState = { page: 1, sort: 'period', dir: 'desc', retailer: '', category: '', month: '', q: '', editRow: null, editMode: false };
const COLUMNS = [
  { key: 'periodStart', label: 'Period start', sort: 'period' },
  { key: 'periodEnd', label: 'Period end' },
  { key: 'retailer', label: 'Retailer', sort: 'retailer' },
  { key: 'counter', label: 'Counter', sort: 'counter' },
  { key: 'category', label: 'Category', sort: 'category' },
  { key: 'productName', label: 'Product' },
  { key: 'sku', label: 'SKU' },
  { key: 'quantity', label: 'Qty', sort: 'quantity', num: true },
  { key: 'sales', label: 'Sales (RM)', sort: 'sales', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true }
];

async function populateDataFilters() {
  const options = await fetch('/api/dashboard').then(r => r.json()).then(b => b.options).catch(() => null);
  if (!options) return;
  const fill = (id, values, all) => { $data(id).innerHTML = `<option value="">${all}</option>${values.map(v => `<option>${escapeHtml(v)}</option>`).join('')}`; };
  fill('#dRetailer', options.retailers, 'All retailers');
  fill('#dCategory', options.categories, 'All categories');
  fill('#dMonth', options.months, 'All months');
  $data('#dRetailer').value = dataState.retailer; $data('#dCategory').value = dataState.category; $data('#dMonth').value = dataState.month;
}

async function loadRows() {
  const params = new URLSearchParams({ page: dataState.page, sort: dataState.sort, dir: dataState.dir, retailer: dataState.retailer, category: dataState.category, month: dataState.month, q: dataState.q });
  const data = await fetch(`/api/rows?${params}`).then(r => r.json()).catch(() => null);
  if (!data) { $data('#dataTable').innerHTML = '<p class="hint">Couldn\'t load rows.</p>'; return; }
  const head = `<thead><tr>${COLUMNS.map(c => `<th ${c.sort ? `data-sort="${c.sort}" class="sortable${dataState.sort === c.sort ? ' on' : ''}"` : ''}>${c.label}${dataState.sort === c.sort ? (dataState.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>`;
  const body = data.rows.map(row => row.id === dataState.editRow ? editRowHtml(row) : displayRowHtml(row)).join('');
  $data('#dataTable').innerHTML = `<div class="tableWrap"><table>${head}<tbody>${body || '<tr><td colspan="12" class="hint">No rows match these filters.</td></tr>'}</tbody></table></div>
    <div class="pageBar"><button type="button" class="secondary" id="dPrev" ${data.page <= 1 ? 'disabled' : ''}>&larr; Previous</button><small>Page ${data.page} of ${data.pages} &middot; ${data.total.toLocaleString()} rows</small><button type="button" class="secondary" id="dNext" ${data.page >= data.pages ? 'disabled' : ''}>Next &rarr;</button></div>`;
  const prev = $data('#dPrev'), next = $data('#dNext');
  if (prev) prev.onclick = () => { dataState.page--; loadRows(); };
  if (next) next.onclick = () => { dataState.page++; loadRows(); };
}

const cellText = (row, col) => {
  const value = row[col.key];
  if (value == null) return '';
  return col.num ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : escapeHtml(String(value));
};
const displayRowHtml = row => `<tr data-id="${row.id}" class="${dataState.editMode ? 'editable' : ''}">
  ${COLUMNS.map(c => `<td class="${c.num ? 'num' : ''}">${cellText(row, c)}</td>`).join('')}
  <td class="rowActions">${dataState.editMode ? `<button type="button" class="secondary" data-edit="${row.id}">Edit</button><button type="button" class="secondary danger" data-del="${row.id}">Delete</button>` : ''}</td></tr>`;

const editInput = (row, key, num = false) => `<input value="${row[key] ?? ''}" data-k="${key}" ${num ? 'type="number" step="any"' : ''}>`;
const editRowHtml = row => `<tr data-id="${row.id}" class="editing">
  ${COLUMNS.map(c => `<td class="${c.num ? 'num' : ''}">${['retailer', 'periodStart', 'periodEnd'].includes(c.key) ? cellText(row, c) : editInput(row, c.key, c.num)}</td>`).join('')}
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
[['#dRetailer', 'retailer'], ['#dCategory', 'category'], ['#dMonth', 'month']].forEach(([selector, key]) => {
  $data(selector).onchange = event => { dataState[key] = event.target.value; dataState.page = 1; loadRows(); load(); };
});
let searchTimer;
$data('#dSearch').oninput = event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { dataState.q = event.target.value.trim(); dataState.page = 1; loadRows(); }, 300); };

populateDataFilters().then(loadRows);
