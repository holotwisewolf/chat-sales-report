// Main spreadsheet view: the table IS the page. Edit mode = click a cell and type;
// index-cell selection (ctrl for multiple) + right-click delete; undo for edits and deletes.
const $data = selector => document.querySelector(selector);
const dataState = { page: 1, sort: 'period', dir: 'desc', retailer: '', category: '', q: '', editRow: null, editMode: false, period: { year: null, months: {}, from: '', to: '' }, years: [], selection: new Set(), lastRows: [] };
const undoStack = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EDITABLE = new Set(['counter', 'retailer', 'category', 'productName', 'sku', 'quantity', 'sales', 'cost', 'profit']);
const NUMERIC = new Set(['quantity', 'sales', 'cost', 'profit']);

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
  $data('#ppYears').innerHTML = [`<button type="button" class="ppBtn secondary ${p.year == null && !p.from && !p.to ? 'on' : ''}" data-year="">All years</button>`]
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
  document.addEventListener('pointerdown', event => {
    if (pop.hidden) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (!path.some(el => el.classList && el.classList.contains('periodPicker'))) pop.hidden = true;
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !pop.hidden) pop.hidden = true; });
  $data('#ppYears').onclick = event => {
    const year = event.target.dataset?.year;
    if (year === undefined) return;
    event.stopPropagation();
    dataState.period.year = year === '' ? null : Number(year);
    dataState.period.from = ''; dataState.period.to = '';
    renderPeriodPicker();
    applyPeriod();
  };
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
  const onRangeChange = () => {
    dataState.period = { year: null, months: {}, from: $data('#ppFrom').value, to: $data('#ppTo').value };
    renderPeriodPicker();
    applyPeriod();
  };
  $data('#ppFrom').onchange = onRangeChange;
  $data('#ppTo').onchange = onRangeChange;
  $data('#ppReset').onclick = () => { resetPeriod(); applyPeriod(); };
  const resetLabel = $data('#ppReset');
  if (resetLabel) resetLabel.textContent = 'Reset everything';
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
  dataState.lastRows = data.rows;
  const has = data.columns || {};
  const COLUMNS = visibleColumns(has);
  const widths = { counter: 'minmax(0,1.8fr)', retailer: 'minmax(0,1fr)', category: 'minmax(0,1fr)', period: 'minmax(0,0.9fr)', productName: 'minmax(0,1.2fr)', sku: 'minmax(0,0.8fr)' };
  const template = ['36px'].concat(COLUMNS.map(c => c.num ? 'minmax(0,0.55fr)' : (widths[c.key] || 'minmax(0,1fr)'))).join(' ');
  const headCells = '<div class="dsCell num">#</div>' + COLUMNS.map(c => `<div class="dsCell ${c.sort ? 'sortable' : ''}${c.num ? ' num' : ''}${dataState.sort === c.sort ? ' on' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''}>${c.label}${dataState.sort === c.sort ? (dataState.dir === 'asc' ? ' ▲' : ' ▼') : ''}</div>`).join('');
  const firstIndex = ((data.page - 1) * (data.pageSize || 50)) + 1;
  const body = data.rows.map((row, i) => rowHtml(row, COLUMNS, firstIndex + i)).join('');
  const totals = data.totals || {};
  const footCells = '<div class="dsCell"></div>' + COLUMNS.map(c => c.key === 'counter'
    ? `<div class="dsCell counterName">Total (${data.total.toLocaleString()} rows)</div>`
    : `<div class="dsCell ${c.num ? 'num' : ''}">${c.num ? Number(totals[c.key] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</div>`).join('');
  $data('#dataTable').innerHTML = `
    <div class="dsHead" style="--cols:${template}">${headCells}</div>
    <div class="dsBody" style="--cols:${template}">${body || '<div class="hint" style="padding:22px 14px">No rows match these filters.</div>'}</div>
    <div class="dsFoot" style="--cols:${template}">${footCells}</div>
    <div class="pageBar"><button type="button" class="secondary" id="dPrev" ${data.page <= 1 ? 'disabled' : ''}>&larr; Previous</button><small>Page ${data.page} of ${data.pages} &middot; ${data.total.toLocaleString()} rows</small><button type="button" class="secondary" id="dNext" ${data.page >= data.pages ? 'disabled' : ''}>Next &rarr;</button></div>
    <div class="resizeHandle" title="Drag to resize the table"></div>`;
  const prev = $data('#dPrev'), next = $data('#dNext');
  if (prev) prev.onclick = () => { dataState.page--; loadRows(); };
  if (next) next.onclick = () => { dataState.page++; loadRows(); };
  wireResize();
  window.updateUndoDock?.();
  const bodyEl = $data('.dsBody');
  const strips = [...$data('#dataTable').querySelectorAll('.dsHead,.dsFoot')];
  if (bodyEl && strips.length) {
    const sync = () => {
      const width = bodyEl.clientWidth;
      strips.forEach(strip => {
        strip.style.width = `${width}px`;
        strip.style.paddingRight = '0';
        strip.style.transform = `translateX(${-bodyEl.scrollLeft}px)`;
      });
    };
    sync();
    bodyEl.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
  }
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

function rowHtml(row, columns, index) {
  const selected = dataState.selection.has(row.id) ? ' selected' : '';
  const cells = columns.map((c, ci) => {
    const editable = dataState.editMode && EDITABLE.has(c.key);
    return `<div class="dsCell ${rowCellClass(c, ci, columns)}" ${editable ? `contenteditable="plaintext-only" data-field="${c.key}" data-raw="${c.num ? row[c.key] ?? '' : escapeHtml(String(row[c.key] ?? ''))}"` : ''}>${cellText(row, c)}</div>`;
  }).join('');
  return `<div class="dsRow${selected}" data-id="${row.id}"><div class="dsCell dsIndex" ${dataState.editMode ? 'title="Click to select the row"' : ''}>${index}</div>${cells}</div>`;
}

// ---- Undo: edits are patched back; deletes are restored through /api/rows/restore. ----
function pushUndo(entry) { undoStack.push(entry); if (undoStack.length > 50) undoStack.shift(); window.updateUndoDock?.(); }
window.undo = undo;
window.undoCount = () => undoStack.length;
async function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  try {
    if (entry.type === 'edit') {
      await fetch(`/api/rows/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [entry.field]: entry.oldValue }) });
    } else if (entry.type === 'delete') {
      await fetch('/api/rows/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reports: entry.reports, rows: entry.rows }) });
    }
  } catch { alert('Could not undo - is the app still running?'); }
  loadRows();
  load();
}

// ---- Table interactions: cell editing, row selection, right-click delete. ----
$data('#dataTable').addEventListener('focusout', async event => {
  const cell = event.target.closest?.('.dsCell[contenteditable]');
  if (!cell || cell !== event.target) return;
  const field = cell.dataset.field;
  const rowEl = cell.closest('.dsRow');
  const row = dataState.lastRows.find(r => String(r.id) === rowEl?.dataset.id);
  if (!row || !field) return;
  const raw = cell.dataset.raw ?? '';
  const text = cell.textContent.trim().replace(/,/g, '');
  let value = NUMERIC.has(field) ? Number(text) : text;
  if (NUMERIC.has(field) && !Number.isFinite(value)) {
    cell.textContent = cellText(row, ALL_COLUMNS.find(c => c.key === field));
    return alert('That needs to be a number - the cell was put back.');
  }
  const oldValue = NUMERIC.has(field) ? Number(raw) : raw;
  if (String(value) === String(oldValue)) return;
  pushUndo({ type: 'edit', id: row.id, field, oldValue });
  const response = await fetch(`/api/rows/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { alert(result.error || 'Could not save that cell.'); undoStack.pop(); window.updateUndoDock?.(); }
  else if (field === 'retailer' && result.affectedRows > 1) alert(`Retailer changed for all ${result.affectedRows} rows of that report - a report belongs to one retailer.`);
  loadRows();
  load();
});
$data('#dataTable').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('.dsCell[contenteditable]')) { event.preventDefault(); event.target.blur(); }
  if (event.key === 'Escape' && event.target.matches('.dsCell[contenteditable]')) {
    event.preventDefault();
    const row = dataState.lastRows.find(r => String(r.id) === event.target.closest('.dsRow')?.dataset.id);
    const col = ALL_COLUMNS.find(c => c.key === event.target.dataset.field);
    if (row && col) event.target.textContent = cellText(row, col);
    event.target.blur();
  }
});

$data('#dataTable').addEventListener('click', event => {
  const sortCell = event.target.closest('.dsCell.sortable');
  if (sortCell) {
    const sortKey = sortCell.dataset.sort;
    if (dataState.sort === sortKey) dataState.dir = dataState.dir === 'asc' ? 'desc' : 'asc';
    else { dataState.sort = sortKey; dataState.dir = 'desc'; }
    dataState.page = 1;
    loadRows();
    return;
  }
  const indexCell = event.target.closest('.dsIndex');
  if (indexCell && dataState.editMode) {
    const id = Number(indexCell.closest('.dsRow').dataset.id);
    if (event.ctrlKey || event.metaKey) { dataState.selection.has(id) ? dataState.selection.delete(id) : dataState.selection.add(id); }
    else { dataState.selection.clear(); dataState.selection.add(id); }
    refreshSelection();
  }
});
function refreshSelection() {
  $data('#dataTable').querySelectorAll('.dsRow').forEach(rowEl => rowEl.classList.toggle('selected', dataState.selection.has(Number(rowEl.dataset.id))));
  window.updateUndoDock?.();
}

let ctxMenu = null;
$data('#dataTable').addEventListener('contextmenu', event => {
  if (!dataState.editMode) return;
  const rowEl = event.target.closest('.dsRow');
  if (!rowEl) return;
  event.preventDefault();
  const id = Number(rowEl.dataset.id);
  if (!dataState.selection.has(id)) { dataState.selection.clear(); dataState.selection.add(id); refreshSelection(); }
  if (ctxMenu) ctxMenu.remove();
  ctxMenu = document.createElement('div');
  ctxMenu.className = 'ctxMenu';
  ctxMenu.innerHTML = `<button type="button" id="ctxDelete">Delete ${dataState.selection.size} selected row${dataState.selection.size > 1 ? 's' : ''}</button>`;
  document.body.appendChild(ctxMenu);
  const x = Math.min(event.clientX, window.innerWidth - 220), y = Math.min(event.clientY, window.innerHeight - 70);
  ctxMenu.style.left = `${x}px`; ctxMenu.style.top = `${y}px`;
  ctxMenu.querySelector('#ctxDelete').onclick = deleteSelected;
  setTimeout(() => document.addEventListener('pointerdown', function close(event2) {
    if (ctxMenu && !ctxMenu.contains(event2.target)) { ctxMenu.remove(); ctxMenu = null; document.removeEventListener('pointerdown', close); }
  }), 0);
});

async function deleteSelected() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  const ids = [...dataState.selection];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} row${ids.length > 1 ? 's' : ''}? You can undo with the Undo button.`)) return;
  const rows = dataState.lastRows.filter(r => ids.includes(r.id)).map(r => ({
    _report: 0, counter: r.counter, retailer: r.retailer, category: r.category, productName: r.productName,
    sku: r.sku, quantity: r.quantity, sales: r.sales, cost: r.cost, profit: r.profit
  }));
  const reports = [];
  for (const id of ids) {
    const response = await fetch(`/api/rows/${id}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (result.removedReport) reports.push(result.removedReport);
  }
  pushUndo({ type: 'delete', rows, reports });
  dataState.selection.clear();
  loadRows();
  load();
}

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input, textarea, [contenteditable]')) {
    event.preventDefault();
    undo();
  }
});

$data('#editMode').onchange = event => { dataState.editMode = event.target.checked; dataState.selection.clear(); loadRows(); };
// Exports download exactly what the table shows, filters included.
const exportUrl = format => {
  const range = currentPeriod();
  const params = new URLSearchParams({ retailer: dataState.retailer, category: dataState.category, from: range.from, to: range.to, months: range.months, exMonths: range.exMonths, q: dataState.q, sort: dataState.sort, dir: dataState.dir, format });
  window.open(`/api/export?${params}`, '_blank');
};
const exportCsv = $data('#exportCsv'), exportXls = $data('#exportXls');
if (exportCsv) exportCsv.onclick = () => exportUrl('csv');
if (exportXls) exportXls.onclick = () => exportUrl('xls');
[['#dRetailer', 'retailer'], ['#dCategory', 'category']].forEach(([selector, key]) => {
  $data(selector).onchange = event => { dataState[key] = event.target.value; dataState.page = 1; loadRows(); load(); };
});
let searchTimer;
$data('#dSearch').oninput = event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { dataState.q = event.target.value.trim(); dataState.page = 1; loadRows(); }, 300); };

// Drag the handle under the table card to set its height; remembered between visits.
function wireResize() {
  const handle = $data('.resizeHandle');
  if (!handle) return;
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    const section = $data('.tableSection');
    const startY = event.clientY;
    const startHeight = section.getBoundingClientRect().height;
    handle.setPointerCapture(event.pointerId);
    const move = ev => {
      const height = Math.max(280, Math.min(window.innerHeight * 0.92, startHeight + (ev.clientY - startY)));
      section.style.height = `${height}px`;
      try { localStorage.setItem('tableHeight', String(height)); } catch {}
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
(function restoreHeight() {
  try {
    const saved = Number(localStorage.getItem('tableHeight'));
    if (Number.isFinite(saved) && saved >= 280) $data('.tableSection').style.height = `${saved}px`;
  } catch {}
})();

wirePeriodPicker();
populateDataFilters().then(loadRows);
