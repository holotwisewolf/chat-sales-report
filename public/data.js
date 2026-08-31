// Main spreadsheet view: the table IS the page. Edit mode = click a cell and type;
// index-cell selection (ctrl for multiple) + right-click delete; undo for edits and deletes.
const $data = selector => document.querySelector(selector);
const dataState = { page: 1, sort: 'period', dir: 'desc', retailer: '', category: '', q: '', editRow: null, editMode: false, period: { year: null, months: {}, from: '', to: '' }, years: [], selection: new Set(), lastRows: [] };
const undoStack = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EDITABLE = new Set(['counter', 'retailer', 'category', 'productName', 'sku', 'quantity', 'sales', 'cost', 'profit']);
const NUMERIC = new Set(['quantity', 'sales', 'cost', 'profit']);
const customColWidths = {};

function initColumnResizers(COLUMNS) {
  const headEl = $data('.dsHead');
  if (!headEl) return;
  const resizers = headEl.querySelectorAll('.colResizer');
  resizers.forEach(resizer => {
    const colKey = resizer.dataset.col;
    const isLeft = resizer.classList.contains('left');
    let startX = 0;
    let startWidth = 0;
    
    const onMouseMove = e => {
      const rawDx = e.clientX - startX;
      const dx = isLeft ? -rawDx : rawDx;
      const minW = colKey === 'index' ? 24 : 50;
      const newWidth = Math.max(minW, startWidth + dx);
      customColWidths[colKey] = `${newWidth}px`;
      
      const widths = { counter: 'minmax(0,1.8fr)', retailer: 'minmax(0,1fr)', category: 'minmax(0,1fr)', period: 'minmax(0,1fr)', productName: 'minmax(0,1.2fr)', sku: 'minmax(0,0.8fr)' };
      const idxW = customColWidths.index || '36px';
      const newTemplate = [idxW].concat(COLUMNS.map(c => customColWidths[c.key] || (c.num ? 'minmax(0,0.55fr)' : (widths[c.key] || 'minmax(0,1fr)')))).join(' ');
      
      const tableEl = $data('#dataTable');
      if (tableEl) {
        tableEl.querySelectorAll('.dsHead, .dsBody, .dsFoot, .dsRow').forEach(el => {
          el.style.setProperty('--cols', newTemplate);
        });
      }
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    resizer.onmousedown = e => {
      e.stopPropagation();
      e.preventDefault();
      startX = e.clientX;
      const cell = resizer.parentElement;
      startWidth = cell.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
  });
}

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
  const lbl = $data('#periodBtnLabel');
  if (lbl) lbl.textContent = periodLabel();
  else $data('#periodBtn').innerHTML = `${escapeHtml(periodLabel())} &darr;`;
  const p = dataState.period;
  $data('#ppYears').innerHTML = [`<button type="button" class="ppBtn secondary ${p.year == null && !p.from && !p.to ? 'on' : ''}" data-year="">All</button>`]
    .concat(dataState.years.map(y => `<button type="button" class="ppBtn secondary ${p.year === y && !p.from && !p.to ? 'on' : ''}" data-year="${y}">${y}</button>`)).join('');
  $data('#ppMonths').innerHTML = MONTHS.map((m, i) => {
    const state = p.months[i] || '';
    return `<button type="button" class="ppBtn secondary ${state}" data-month="${i}" title="${state === 'excl' ? 'Right-click to include again' : 'Right-click to exclude ' + m}">${m}</button>`;
  }).join('');
  $data('#ppFrom').value = p.from; $data('#ppTo').value = p.to;
}

function wirePeriodPicker() {
  const pop = $data('#periodPop');
  const btn = $data('#periodBtn');
  btn.onclick = event => {
    event.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.classList.toggle('open', !pop.hidden);
    if (!pop.hidden) renderPeriodPicker();
  };
  document.addEventListener('pointerdown', event => {
    if (pop.hidden) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (!path.some(el => el.classList && el.classList.contains('periodPicker'))) {
      pop.hidden = true;
      btn.classList.remove('open');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !pop.hidden) {
      pop.hidden = true;
      btn.classList.remove('open');
    }
  });
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
  if (resetLabel) resetLabel.textContent = 'Reset';
}

async function populateDataFilters() {
  const options = await fetch('/api/dashboard').then(r => r.json()).then(b => b.options).catch(() => null);
  if (!options) return;
  const fill = (id, values, all) => { $data(id).innerHTML = `<option value="">${all}</option>${values.map(v => `<option>${escapeHtml(v)}</option>`).join('')}`; };
  fill('#dRetailer', options.retailers, 'All retailers');
  fill('#dCategory', options.categories, 'All categories');
  allAvailableCounters = options.counters || [];
  allAvailableRetailers = options.retailers || [];
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
  const widths = { counter: 'minmax(0,1.8fr)', retailer: 'minmax(0,1fr)', category: 'minmax(0,1fr)', period: 'minmax(0,1fr)', productName: 'minmax(0,1.2fr)', sku: 'minmax(0,0.8fr)' };
  const idxW = customColWidths.index || '36px';
  const template = [idxW].concat(COLUMNS.map(c => customColWidths[c.key] || (c.num ? 'minmax(0,0.55fr)' : (widths[c.key] || 'minmax(0,1fr)')))).join(' ');
  const indexHeadCell = `<div class="dsCell num">#<div class="colResizer left" data-col="index"></div><div class="colResizer right" data-col="index"></div></div>`;
  const headCells = indexHeadCell + COLUMNS.map(c => `
    <div class="dsCell ${c.sort ? 'sortable' : ''}${c.num ? ' num' : ''}${dataState.sort === c.sort ? ' on' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''}>
      ${c.label}${dataState.sort === c.sort ? (dataState.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      <div class="colResizer left" data-col="${c.key}"></div>
      <div class="colResizer right" data-col="${c.key}"></div>
    </div>
  `).join('');
  const firstIndex = ((data.page - 1) * (data.pageSize || 50)) + 1;
  const body = data.rows.map((row, i) => rowHtml(row, COLUMNS, firstIndex + i)).join('');
  const totals = data.totals || {};
  const footCells = '<div class="dsCell"></div>' + COLUMNS.map(c => c.key === 'counter'
    ? `<div class="dsCell counterName">Total (${data.total.toLocaleString()} rows)</div>`
    : `<div class="dsCell ${c.num ? 'num' : ''}">${c.num ? formatNum(totals[c.key] || 0, MONEY_FIELDS.has(c.key)) : ''}</div>`).join('');
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
  initColumnResizers(COLUMNS);
  window.updateUndoDock?.();
  const bodyEl = $data('.dsBody');
  const strips = [...$data('#dataTable').querySelectorAll('.dsHead,.dsFoot')];
  if (bodyEl && strips.length) {
    const sync = () => {
      const scrollWidth = bodyEl.scrollWidth || bodyEl.clientWidth;
      strips.forEach(strip => {
        strip.style.width = `${scrollWidth}px`;
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
  { key: 'period', label: 'Period', sort: 'period' }
];
const visibleColumns = has => ALL_COLUMNS.filter(c => !c.optional || has[c.optional]);

const shortDate = iso => { if (!iso) return null; const [, m, d] = iso.split('-'); return `${+d}/${+m}`; };
const periodText = row => {
  const start = shortDate(row.periodStart), end = shortDate(row.periodEnd);
  if (!start && !end) return '';
  const yy = (row.periodEnd || '').slice(2, 4);
  return `${start || '?'}–${end || '?'}${yy ? `/${yy}` : ''}`;
};
const MONEY_FIELDS = new Set(['sales', 'cost', 'profit']);
const formatNum = (value, isMoney) => {
  if (value == null || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return isMoney
    ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : num.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
const cellText = (row, col) => {
  if (col.key === 'period') return escapeHtml(periodText(row));
  const value = row[col.key];
  if (value == null) return '';
  return col.num ? formatNum(value, MONEY_FIELDS.has(col.key)) : escapeHtml(String(value));
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
function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > 50) undoStack.shift();
  window.updateUndoDock?.();
  window.revealDock?.();
}
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
    _report: 0,
    reportId: r.reportId,
    counter: r.counter,
    retailer: r.retailer,
    category: r.category,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    productName: r.productName,
    sku: r.sku,
    quantity: r.quantity,
    sales: r.sales,
    cost: r.cost,
    profit: r.profit,
    margin_percent: r.margin_percent
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

// Export dropdown logic
const exportMenuBtn = $data('#exportMenuBtn');
const exportMenu = $data('#exportMenu');
if (exportMenuBtn && exportMenu) {
  exportMenuBtn.onclick = event => {
    event.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
    exportMenuBtn.classList.toggle('open', !exportMenu.hidden);
  };
  document.addEventListener('pointerdown', event => {
    if (exportMenu.hidden) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (!path.some(el => el.classList && el.classList.contains('exportDropdown'))) {
      exportMenu.hidden = true;
      exportMenuBtn.classList.remove('open');
    }
  });
}

// Exports download exactly what the table shows, filters included.
const exportUrl = format => {
  const range = currentPeriod();
  const params = new URLSearchParams({ retailer: dataState.retailer, category: dataState.category, from: range.from, to: range.to, months: range.months, exMonths: range.exMonths, q: dataState.q, sort: dataState.sort, dir: dataState.dir, format });
  window.open(`/api/export?${params}`, '_blank');
  if (exportMenu) exportMenu.hidden = true;
};
const exportCsv = $data('#exportCsv'), exportXls = $data('#exportXls');
if (exportCsv) exportCsv.onclick = () => exportUrl('csv');
if (exportXls) exportXls.onclick = () => exportUrl('xls');

// ---- Advanced Print Customization Modal & Table Generator ----
const printDialog = $data('#printDialog');
const closePrint = $data('#closePrint'), cancelPrint = $data('#cancelPrint');
const executePrint = $data('#executePrint');
const exportPrintBtn = $data('#exportPrintBtn');
const topPrintBtn = $data('#printBtn');

// ---- ReactBits Stepper for Print Modal ----
let printCurrentStep = 1;
const pSteps = [$data('#pStep1'), $data('#pStep2'), $data('#pStep3')];
const pIndicators = document.querySelectorAll('.stepIndicator[data-pstep]');
const pConns = [$data('#pConn1'), $data('#pConn2')];
const pBackBtn = $data('#pBackBtn');
const pNextBtn = $data('#pNextBtn');
const pExecuteBtn = $data('#executePrint');
const previewContainer = $data('#previewContainer');

function setPrintStep(step) {
  printCurrentStep = step;
  pSteps.forEach((panel, i) => {
    if (panel) panel.classList.toggle('active', i + 1 === step);
  });
  pIndicators.forEach(ind => {
    const s = Number(ind.dataset.pstep);
    ind.classList.toggle('active', s === step);
    ind.classList.toggle('completed', s < step);
    if (s < step) {
      ind.innerHTML = '&#10003;';
    } else {
      ind.textContent = String(s);
    }
  });
  pConns.forEach((conn, i) => {
    if (conn) {
      conn.classList.toggle('completed', i + 1 < step);
      conn.classList.toggle('active', i + 1 === step - 1);
    }
  });
  if (pBackBtn) pBackBtn.disabled = step === 1;
  if (step === 3) {
    if (pNextBtn) pNextBtn.style.display = 'none';
    if (pExecuteBtn) pExecuteBtn.style.display = 'inline-block';
    updatePrintPreview();
  } else {
    if (pNextBtn) pNextBtn.style.display = 'inline-block';
    if (pExecuteBtn) pExecuteBtn.style.display = 'none';
  }
}

pIndicators.forEach(ind => {
  ind.onclick = () => setPrintStep(Number(ind.dataset.pstep));
});
if (pBackBtn) pBackBtn.onclick = () => { if (printCurrentStep > 1) setPrintStep(printCurrentStep - 1); };
if (pNextBtn) pNextBtn.onclick = () => { if (printCurrentStep < 3) setPrintStep(printCurrentStep + 1); };

function openPrintModal() {
  if (exportMenu) exportMenu.hidden = true;
  if (!printDialog) return;
  // Render column checkboxes dynamically based on available data headers
  const colsList = $data('#psColumnsList');
  if (colsList) {
    const activeCols = visibleColumns(dataState.columns || {});
    const cols = activeCols.length ? activeCols : ALL_COLUMNS;
    colsList.innerHTML = cols.map(col => `
      <label class="psCheck">
        <div class="checkbox-comp"><input type="checkbox" class="psColToggle" data-col="${col.key}" ${['productName', 'sku', 'cost', 'profit'].includes(col.key) ? '' : 'checked'}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 12.5L9.5 16.5L18.5 7.5" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        ${escapeHtml(col.label)}
      </label>
    `).join('');
    colsList.querySelectorAll('input').forEach(inp => inp.onchange = () => { if (printCurrentStep === 3) updatePrintPreview(); });
  }
  setPrintStep(1);
  printDialog.showModal();
}

if (topPrintBtn) topPrintBtn.onclick = openPrintModal;
if (exportPrintBtn) exportPrintBtn.onclick = openPrintModal;
if (closePrint) closePrint.onclick = () => printDialog?.close();
if (cancelPrint) cancelPrint.onclick = () => printDialog?.close();

// Setup segmented alignment buttons (Text & Numeric alignments)
function setupAlignButtonGroup(groupId, hiddenInputId) {
  const group = $data(groupId);
  const hiddenInput = $data(hiddenInputId);
  if (!group || !hiddenInput) return;
  const btns = group.querySelectorAll('.alignBtn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hiddenInput.value = btn.dataset.align;
      if (printCurrentStep === 3) updatePrintPreview();
    });
  });
}
setupAlignButtonGroup('#groupTextAlign', '#psTextAlign');
setupAlignButtonGroup('#groupNumAlign', '#psNumAlign');

// ---- Custom Animated Search Dropdown Autocomplete ----
// Limit to 10 suggestions. If blank: recent searches (from localStorage) + alphabetical retailers/counters.
// When querying: shortest match first (e.g. "mydin" shows retailer "Mydin" first).
let allAvailableCounters = [];
let allAvailableRetailers = [];
const searchMenu = $data('#searchMenu');
const searchInput = $data('#dSearch');

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem('recentCounterSearches') || '[]');
  } catch {
    return [];
  }
}
function saveRecentSearch(term) {
  if (!term || !term.trim()) return;
  term = term.trim();
  const recents = getRecentSearches().filter(s => s.toLowerCase() !== term.toLowerCase());
  recents.unshift(term);
  if (recents.length > 10) recents.length = 10;
  try { localStorage.setItem('recentCounterSearches', JSON.stringify(recents)); } catch {}
}

function renderSearchSuggestions(query = '') {
  if (!searchMenu) return;
  const q = query.trim().toLowerCase();
  let html = '';
  if (!q) {
    const recents = getRecentSearches();
    if (recents.length) {
      html += `<div class="searchSectionHead">Recent Searches</div>`;
      html += recents.map(term => `
        <button type="button" class="searchItem" data-val="${escapeHtml(term)}" data-type="recent">
          <span>${escapeHtml(term)}</span>
          <small>Recent</small>
        </button>
      `).join('');
    }
    const remainingSlots = Math.max(0, 10 - recents.length);
    if (remainingSlots > 0) {
      const recentsLower = new Set(recents.map(r => r.toLowerCase()));
      const availableRetailers = (allAvailableRetailers || []).filter(r => !recentsLower.has(r.toLowerCase()));
      const availableCounters = (allAvailableCounters || []).filter(c => !recentsLower.has(c.toLowerCase()));
      const combined = [
        ...availableRetailers.map(r => ({ name: r, type: 'Retailer' })),
        ...availableCounters.map(c => ({ name: c, type: 'Counter' }))
      ].slice(0, remainingSlots);

      if (combined.length) {
        html += `<div class="searchSectionHead">Quick Suggestions</div>`;
        html += combined.map(item => `
          <button type="button" class="searchItem" data-val="${escapeHtml(item.name)}" data-type="${item.type.toLowerCase()}">
            <span>${escapeHtml(item.name)}</span>
            <small>${item.type}</small>
          </button>
        `).join('');
      }
    }
  } else {
    // Search across retailers and counters. Shortest length first!
    const retailerMatches = (allAvailableRetailers || [])
      .filter(r => r.toLowerCase().includes(q))
      .map(r => ({ name: r, type: 'Retailer' }));
    const counterMatches = (allAvailableCounters || [])
      .filter(c => c.toLowerCase().includes(q))
      .map(c => ({ name: c, type: 'Counter' }));

    const combined = [...retailerMatches, ...counterMatches];
    // Shortest match first, then alphabetical
    combined.sort((a, b) => {
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return a.name.localeCompare(b.name);
    });
    const matches = combined.slice(0, 10);

    if (matches.length) {
      html += `<div class="searchSectionHead">Suggestions (${matches.length})</div>`;
      html += matches.map(item => {
        const idx = item.name.toLowerCase().indexOf(q);
        const highlighted = idx >= 0
          ? `${escapeHtml(item.name.slice(0, idx))}<mark>${escapeHtml(item.name.slice(idx, idx + q.length))}</mark>${escapeHtml(item.name.slice(idx + q.length))}`
          : escapeHtml(item.name);
        return `
          <button type="button" class="searchItem" data-val="${escapeHtml(item.name)}" data-type="${item.type.toLowerCase()}">
            <span>${highlighted}</span>
            <small>${item.type}</small>
          </button>
        `;
      }).join('');
    } else {
      html = `<div class="searchEmpty">No matches for &ldquo;${escapeHtml(query)}&rdquo;. Press Enter to search anyway.</div>`;
    }
  }
  searchMenu.innerHTML = html;
  searchMenu.hidden = !html;
}

if (searchInput) {
  searchInput.addEventListener('focus', () => renderSearchSuggestions(searchInput.value));
  searchInput.addEventListener('input', () => renderSearchSuggestions(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (!searchMenu || searchMenu.hidden) return;
    const items = [...searchMenu.querySelectorAll('.searchItem')];
    const active = searchMenu.querySelector('.searchItem.active');
    let idx = items.indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) idx++; else idx = 0;
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
      if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) idx--; else idx = items.length - 1;
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
      if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (active) {
        e.preventDefault();
        selectSearchValue(active.dataset.val);
      } else {
        saveRecentSearch(searchInput.value);
        searchMenu.hidden = true;
      }
    } else if (e.key === 'Escape') {
      searchMenu.hidden = true;
    }
  });
}

function selectSearchValue(val) {
  if (!searchInput) return;
  searchInput.value = val;
  saveRecentSearch(val);
  if (searchMenu) searchMenu.hidden = true;
  dataState.q = val.trim();
  dataState.page = 1;
  loadRows();
}

if (searchMenu) {
  searchMenu.addEventListener('pointerdown', e => {
    const item = e.target.closest('.searchItem');
    if (!item) return;
    e.preventDefault();
    selectSearchValue(item.dataset.val);
  });
}

document.addEventListener('pointerdown', e => {
  if (searchMenu && !searchMenu.hidden) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (!path.some(el => el.classList && el.classList.contains('searchWrap'))) {
      searchMenu.hidden = true;
    }
  }
});

async function buildPrintHtml() {
  const range = currentPeriod();
  const params = new URLSearchParams({
    retailer: dataState.retailer, category: dataState.category,
    from: range.from, to: range.to, months: range.months, exMonths: range.exMonths,
    q: dataState.q, sort: dataState.sort, dir: dataState.dir
  });
  const countRes = await fetch(`/api/rows?${params}&page=1`).then(r => r.json()).catch(() => ({ rows: [] }));
  let rows = countRes.rows || [];
  if (countRes.total > countRes.rows.length) {
    const allRowsRes = await fetch(`/api/rows?${params}&page=1&limit=${Math.min(2000, countRes.total)}`).then(r => r.json()).catch(() => null);
    if (allRowsRes?.rows) rows = allRowsRes.rows;
  }

  const title = $data('#psTitle')?.value.trim() || 'Sales Report';
  const subtitle = $data('#psSubtitle')?.value.trim() || '';
  const showPeriod = $data('#psShowPeriod')?.checked;
  const showSummary = $data('#psShowSummary')?.checked;
  const fontSize = $data('#psFontSize')?.value || 'medium';
  const fontFamily = $data('#psFontFamily')?.value || 'sans';
  const rowsPerPage = Number($data('#psPageSize')?.value) || 0;
  const theme = $data('#psTheme')?.value || 'clean';
  const boldHeaders = $data('#psBoldHeaders')?.checked;
  const gridLines = $data('#psGridLines')?.checked;
  const textAlign = $data('#psTextAlign')?.value || 'left';
  const numAlign = $data('#psNumAlign')?.value || 'right';

  const selectedColKeys = new Set(
    [...document.querySelectorAll('.psColToggle:checked')].map(el => el.dataset.col)
  );
  const activeCols = ALL_COLUMNS.filter(c => selectedColKeys.has(c.key));
  if (!activeCols.length) {
    return { error: 'Please select at least one column to print.' };
  }

  // Calculate totals
  let totalQty = 0, totalSales = 0, totalCost = 0, totalProfit = 0;
  rows.forEach(r => {
    totalQty += Number(r.quantity) || 0;
    totalSales += Number(r.sales) || 0;
    totalCost += Number(r.cost) || 0;
    totalProfit += Number(r.profit) || 0;
  });

  const totalsObj = { quantity: totalQty, sales: totalSales, cost: totalCost, profit: totalProfit };

  const classes = [
    `size-${fontSize}`,
    `font-${fontFamily}`,
    `theme-${theme}`,
    gridLines ? 'with-grid' : 'no-grid'
  ].join(' ');

  let summaryHtml = '';
  if (showSummary) {
    summaryHtml = `
      <div class="printCards">
        <div class="printCard"><span>Total Sales</span><strong>RM ${formatNum(totalSales, true)}</strong></div>
        <div class="printCard"><span>Units Sold</span><strong>${formatNum(totalQty, false)}</strong></div>
        <div class="printCard"><span>Rows Printed</span><strong>${rows.length.toLocaleString()}</strong></div>
      </div>
    `;
  }

  let filterMeta = '';
  if (showPeriod) {
    const parts = [];
    if (dataState.retailer) parts.push(`Retailer: <b>${escapeHtml(dataState.retailer)}</b>`);
    if (dataState.category) parts.push(`Category: <b>${escapeHtml(dataState.category)}</b>`);
    const pLabel = window.periodLabel ? window.periodLabel() : '';
    if (pLabel && pLabel !== 'All time') parts.push(`Period: <b>${escapeHtml(pLabel)}</b>`);
    if (parts.length) filterMeta = `<p class="printMeta">${parts.join(' &middot; ')}</p>`;
  }

  const stamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const getColAlign = col => col.num ? numAlign : textAlign;

  const renderTableRows = slice => slice.map((row, idx) => `
    <tr>
      <td style="text-align:right;width:32px;color:#666">${idx + 1}</td>
      ${activeCols.map(col => `<td class="${col.num ? 'num' : ''}" style="text-align:${getColAlign(col)}">${cellText(row, col)}</td>`).join('')}
    </tr>
  `).join('');

  const tableHead = `
    <thead>
      <tr>
        <th style="width:32px;text-align:right">#</th>
        ${activeCols.map(col => `<th class="${col.num ? 'num' : ''}" style="text-align:${getColAlign(col)};${boldHeaders ? 'font-weight:800;' : ''}">${escapeHtml(col.label)}</th>`).join('')}
      </tr>
    </thead>
  `;

  const tableFoot = `
    <tfoot class="tfoot">
      <tr>
        <td></td>
        ${activeCols.map(col => col.key === 'counter'
          ? `<td style="text-align:${textAlign};${boldHeaders ? 'font-weight:800;' : ''}">Total (${rows.length.toLocaleString()} rows)</td>`
          : `<td class="${col.num ? 'num' : ''}" style="text-align:${getColAlign(col)};${boldHeaders ? 'font-weight:800;' : ''}">${col.num ? formatNum(totalsObj[col.key] || 0, MONEY_FIELDS.has(col.key)) : ''}</td>`
        ).join('')}
      </tr>
    </tfoot>
  `;

  let tablesHtml = '';
  if (rowsPerPage > 0 && rows.length > rowsPerPage) {
    const pages = Math.ceil(rows.length / rowsPerPage);
    for (let p = 0; p < pages; p++) {
      const slice = rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
      const isLast = p === pages - 1;
      tablesHtml += `
        <div class="${isLast ? '' : 'printPageBreak'}">
          <table class="printTable">
            ${tableHead}
            <tbody>${renderTableRows(slice)}</tbody>
            ${isLast ? tableFoot : ''}
          </table>
        </div>
      `;
    }
  } else {
    tablesHtml = `
      <table class="printTable">
        ${tableHead}
        <tbody>${renderTableRows(rows)}</tbody>
        ${tableFoot}
      </table>
    `;
  }

  const fullHtml = `
    <div class="printHeader">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="printSubtitle">${escapeHtml(subtitle)}</p>` : ''}
      ${filterMeta}
      <p class="printMeta">Generated on ${stamp}</p>
    </div>
    ${summaryHtml}
    ${tablesHtml}
  `;

  return { classes, fullHtml };
}

async function updatePrintPreview() {
  if (!previewContainer) return;
  previewContainer.innerHTML = '<div style="padding:40px;text-align:center;color:#666">Generating live preview...</div>';
  const result = await buildPrintHtml();
  if (result.error) {
    previewContainer.innerHTML = `<div style="padding:40px;text-align:center;color:#bb3a30">${escapeHtml(result.error)}</div>`;
    return;
  }
  previewContainer.className = `previewSheet ${result.classes}`;
  previewContainer.innerHTML = result.fullHtml;
}

async function generateAndPrint() {
  const printArea = $data('#printOutput');
  if (!printArea) return;
  const result = await buildPrintHtml();
  if (result.error) {
    alert(result.error);
    return;
  }
  printArea.className = `printOutput ${result.classes}`;
  printArea.innerHTML = result.fullHtml;

  printDialog.close();
  setTimeout(() => window.print(), 100);
}

if (executePrint) executePrint.onclick = generateAndPrint;
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
