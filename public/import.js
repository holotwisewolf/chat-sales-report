// Upload -> AI read -> review grid -> confirm flow. Reuses money/escapeHtml/load from app.js.
const $import = selector => document.querySelector(selector);
const state = { job: null, rows: [], flags: new Map(), pollTimer: null, saveTimer: null, busy: false, dirty: false, currentFileId: null };
const round2c = v => Math.round(v * 100) / 100;

// Local-only branding: generic label in the repo, real name when BUSINESS_NAME is set in .env.
fetch('/api/config').then(r => r.json()).then(({ businessName }) => {
  if (!businessName) return;
  $import('#brandEyebrow').textContent = businessName.toUpperCase();
  document.title = `${businessName} Sales Dashboard`;
});

const uploadDialog = $import('#uploadDialog');
const reviewDialog = $import('#reviewDialog');
let staged = [];

// The header button became Print; the dock calls window.openUpload().
window.openUpload = () => { setState(''); renderStaged(); loadDrafts(); uploadDialog.showModal(); };
['#closeUpload', '#cancelUpload'].forEach(s => $import(s).onclick = () => uploadDialog.close());

// ---- Spreadsheet intake: CSV/Excel rows go straight into a review job - no AI read needed. ----
const isSheet = file => /\.(csv|xlsx|xls)$/i.test(file.name) || /csv|excel|spreadsheet/i.test(file.type);

// Minimal CSV reader: quoted fields, embedded commas/newlines, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const SYNONYMS = {
  counter: ['counter', 'countername', 'store', 'name', 'outlet'],
  quantity: ['qty', 'quantity', 'units', 'pairs', 'pieces'],
  sales: ['sales', 'amount', 'rm', 'total', 'salesamount', 'totalsales'],
  category: ['category', 'type', 'shoecategory'],
  retailer: ['retailer', 'chain', 'brand'],
  periodStart: ['start', 'startdate', 'periodstart', 'from', 'fromdate'],
  periodEnd: ['end', 'enddate', 'periodend', 'to', 'todate'],
  productName: ['product', 'productname', 'item', 'description', 'model'],
  sku: ['sku', 'code', 'itemcode'],
  cost: ['cost', 'costprice'],
  profit: ['profit', 'margin']
};
function mapHeaders(headers) {
  const found = {};
  const normalize = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
  for (const [field, names] of Object.entries(SYNONYMS)) {
    found[field] = headers.find(h => names.includes(normalize(h)));
  }
  return found;
}

async function importSheets(files, note) {
  setState('Reading spreadsheet&hellip;', true);
  const allRows = [];
  for (const file of files) {
    let headers, dataRows;
    if (/\.csv$/i.test(file.name)) {
      const matrix = parseCsv(await file.text());
      headers = (matrix[0] || []).map(h => h.trim());
      dataRows = matrix.slice(1).map(cells => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null])));
    } else {
      const form = new FormData();
      form.append('file', file);
      const parsed = await fetch('/api/parse/sheet', { method: 'POST', body: form }).then(r => r.json()).catch(() => null);
      if (!parsed || !parsed.headers) { setState(safeSheetError(parsed), false); return null; }
      headers = parsed.headers;
      dataRows = parsed.rows;
    }
    const map = mapHeaders(headers);
    const missing = ['counter', 'quantity', 'sales'].filter(f => !map[f]);
    if (missing.length) {
      setState(`"${file.name}" is missing the ${missing.join(', ')} column(s). Its headers are: ${headers.join(', ')}.`, false);
      return null;
    }
    for (const raw of dataRows) {
      allRows.push({
        counter: raw[map.counter], quantity: raw[map.quantity], sales: raw[map.sales],
        category: map.category ? raw[map.category] : null,
        retailer: map.retailer ? raw[map.retailer] : null,
        periodStart: map.periodStart ? raw[map.periodStart] : null,
        periodEnd: map.periodEnd ? raw[map.periodEnd] : null,
        productName: map.productName ? raw[map.productName] : null,
        sku: map.sku ? raw[map.sku] : null,
        cost: map.cost ? raw[map.cost] : null,
        profit: map.profit ? raw[map.profit] : null
      });
    }
  }
  const response = await fetch('/api/import-jobs/seed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: allRows, sourceFilename: files.map(f => f.name).join(', '), note })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { setState(body.error || 'The spreadsheet could not be imported.', false); return null; }
  setState('');
  return body.job;
}

function safeSheetError(parsed) {
  try { return parsed && parsed.error ? escapeHtml(parsed.error) : 'We couldn\'t read this spreadsheet. Try saving it as CSV.'; }
  catch { return 'We couldn\'t read this spreadsheet. Try saving it as CSV.'; }
}

function renderStaged() {
  $import('#staged').innerHTML = staged.map((f, i) => `<div class="stagedFile"><span>${escapeHtml(f.name)}</span><small>${(f.size / 1048576).toFixed(1)} MB</small><button type="button" class="secondary" data-unstage="${i}">Remove</button></div>`).join('');
  $import('#readBtn').disabled = !staged.length;
  $import('#readBtn').textContent = staged.length ? `Read ${staged.length} file${staged.length > 1 ? 's' : ''}` : 'Read report';
}
$import('#staged').onclick = e => { const i = e.target.dataset?.unstage; if (i !== undefined) { staged.splice(Number(i), 1); renderStaged(); } };
const drop = $import('#drop');
drop.onclick = () => $import('#fileInput').click();
$import('#fileInput').onchange = e => { staged.push(...e.target.files); e.target.value = ''; renderStaged(); };
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { staged.push(...e.dataTransfer.files); renderStaged(); });

function setState(html, spin) {
  const el = $import('#uploadState');
  el.hidden = !html;
  el.innerHTML = (spin ? '<div class="spinner"></div>' : '') + (html || '');
}

$import('#readBtn').onclick = async () => {
  if (!staged.length || state.busy) return;
  // Spreadsheets take the direct path: parse locally, seed a review job, skip the AI entirely.
  const sheets = staged.filter(isSheet);
  if (sheets.length) {
    if (sheets.length !== staged.length) setState('Spreadsheets import directly; photos/PDFs in the same batch were skipped - upload those separately.', false);
    state.busy = true;
    const job = await importSheets(sheets, $import('#uploadNote').value);
    state.busy = false;
    if (job) { staged = []; renderStaged(); uploadDialog.close(); openReview(job); loadDrafts(); }
    return;
  }
  state.busy = true;
  const form = new FormData();
  staged.forEach(file => form.append('files', file));
  form.append('note', $import('#uploadNote').value);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/import-jobs');
  xhr.upload.onprogress = e => e.lengthComputable && setState(`Uploading&hellip; ${Math.round(e.loaded / e.total * 100)}%`, true);
  xhr.onload = () => {
    state.busy = false;
    if (xhr.status !== 201) return setState(safeError(xhr), false);
    staged = []; renderStaged();
    setState('Reading report&hellip;', true);
    poll(JSON.parse(xhr.responseText).job.id);
  };
  xhr.onerror = () => { state.busy = false; setState('The report reader is temporarily unavailable. Your file was not imported; try again later.', false); };
  xhr.send(form);
};

function safeError(xhr) { try { return escapeHtml(JSON.parse(xhr.responseText).error || 'Something went wrong.'); } catch { return 'Something went wrong on our side. Please try again.'; } }

function poll(jobId, attempt = 0) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const job = await fetch(`/api/import-jobs/${jobId}`).then(r => r.json()).then(b => b.job).catch(() => null);
    if (!job) return;
    if (job.status === 'reading') { if (attempt++ < 240) return setState('Reading report&hellip;', true); }
    clearInterval(state.pollTimer);
    setState('');
    if (job.status === 'review') { uploadDialog.close(); openReview(job); }
    else showFailure(job);
  }, 1500);
}

function showFailure(job) {
  const retry = `<button type="button" id="retryBtn">Try again</button>`;
  setState(`<div><strong>${escapeHtml(job.errorMessage || 'Something went wrong.')}</strong>${['failed_read', 'failed_no_table'].includes(job.status) ? `<div class="actions">${retry}</div>` : ''}</div>`, false);
  const btn = $import('#retryBtn');
  if (btn) btn.onclick = async () => {
    setState('Reading report&hellip;', true);
    const fresh = await fetch(`/api/import-jobs/${job.id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).then(b => b.job).catch(() => null);
    if (fresh) poll(fresh.id);
  };
}

async function loadDrafts() {
  const jobs = await fetch('/api/import-jobs?open=1').then(r => r.json()).then(b => b.jobs).catch(() => []);
  const wrap = $import('#draftsWrap');
  wrap.hidden = !jobs.length;
  $import('#draftList').innerHTML = jobs.map(j => `<div class="draftRow"><div><strong>${escapeHtml(j.retailer || j.files[0]?.filename || 'Draft')}</strong><small> ${escapeHtml(j.periodStart || '?')} to ${escapeHtml(j.periodEnd || '?')} &middot; ${j.rows.length} rows</small></div><span class="chip ${j.status === 'review' ? '' : 'warn'}">${j.status === 'review' ? 'ready to check' : j.status.replace('failed_', '')}</span><button type="button" class="secondary" data-resume="${j.id}">Resume</button></div>`).join('');
  $import('#draftList').onclick = async e => {
    const id = e.target.dataset?.resume;
    if (!id) return;
    const job = await fetch(`/api/import-jobs/${id}`).then(r => r.json()).then(b => b.job).catch(() => null);
    if (!job) return;
    if (job.status === 'review') { uploadDialog.close(); openReview(job); } else { uploadDialog.showModal(); showFailure(job); }
  };
}

const NUM_KEYS = ['quantity', 'sales', 'cost', 'profit', 'margin_percent'];
const isSku = job => job.documentType === 'sku_by_outlet';

function openReview(job) {
  state.job = job;
  state.rows = job.rows.map(r => ({ ...r }));
  state.flags = new Map((job.reconciliation?.flagged || []).map(f => [`${f.fileId}:${f.index}`, f.reasons]));
  $import('#reviewTitle').textContent = job.files.length > 1 ? `${job.files[0].filename} +${job.files.length - 1} more` : (job.files[0]?.filename || 'Review');
  $import('#reviewRetailer').value = job.retailer || '';
  $import('#reviewCategory').value = job.category || '';
  $import('#reviewStart').value = job.periodStart || '';
  $import('#reviewEnd').value = job.periodEnd || '';
  $import('#reviewNote').value = job.note || '';
  renderTabs(job.files[0]?.id);
  renderGrid();
  syncFromServer(job);
  reviewDialog.showModal();
}

function renderTabs(activeId) {
  const files = state.job.files;
  state.currentFileId = activeId ?? files[0]?.id;
  $import('#fileTabs').innerHTML = files.map((f, i) => `<button type="button" class="${f.id === state.currentFileId ? 'on' : ''}" data-tab="${f.id}" title="${escapeHtml(f.filename)}">${i + 1}. ${escapeHtml(f.filename.length > 22 ? f.filename.slice(0, 20) + '…' : f.filename)}</button>`).join('');
  const file = files.find(f => f.id === state.currentFileId);
  const isPdf = file?.mime === 'application/pdf';
  $import('#sourceImg').hidden = isPdf; $import('#sourcePdf').hidden = !isPdf;
  if (isPdf) $import('#sourcePdf').src = file.fileUrl; else $import('#sourceImg').src = file?.fileUrl || '';
  $import('#fileErrors').innerHTML = state.job.files.filter(f => f.status === 'no_table' || f.status === 'failed_read').map(f =>
    `<div class="fileErr"><strong>${escapeHtml(f.filename)}:</strong> ${escapeHtml(f.errorMessage || '')} <button type="button" class="secondary" data-retry-file="${f.id}">Try again</button></div>`).join('');
}

function renderGrid() {
  const sku = isSku(state.job);
  const head = sku
    ? `<div class="r head sku"><span>Product</span><span>Counter / outlet</span><span>SKU</span><span>Qty</span><span>Sales (RM)</span><span>Cost</span><span>Profit</span><span>GP%</span><span></span></div>`
    : `<div class="r head"><span>Counter</span><span>Qty</span><span>Sales (RM)</span><span>Category</span><span></span><span></span></div>`;
  const groups = [];
  let last = null;
  state.rows.forEach((row, i) => {
    if (row.fileId !== last) { groups.push({ fileId: row.fileId, start: true }); last = row.fileId; }
    groups.push({ row, i });
  });
  $import('#rowGrid').innerHTML = head + groups.map(g => {
    if (g.start) {
      const f = state.job.files.find(x => x.id === g.fileId);
      const fileRows = state.rows.filter(r => r.fileId === g.fileId);
      const sharedCategory = fileRows.length && [...new Set(fileRows.map(r => (r.category || '').trim()))].length === 1 ? fileRows[0].category || '' : '';
      return `<div class="r group" style="grid-column:1/-1"><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(f?.filename || 'file')} &middot; ${fileRows.length} rows</span><input class="groupCat" data-setcat="${g.fileId}" list="categoryList" placeholder="Set category for this page" value="${escapeHtml(sharedCategory)}"></div>`;
    }
    const { row, i } = g;
    const reasons = state.flags.get(`${row.fileId}:${i}`);
    const bad = k => (k === 'counter' ? !row.counter : NUM_KEYS.slice(0, 2).includes(k) && !Number.isFinite(row[k]) && row[k] !== null && row[k] !== '') ? 'bad' : '';
    const inp = (k, cls, type = 'text') => `<input data-f="${row.fileId}" data-i="${i}" data-k="${k}" class="${cls}" type="${type}" value="${row[k] ?? ''}" ${type === 'number' ? 'step="any"' : ''}>`;
    const catInput = `<input data-f="${row.fileId}" data-i="${i}" data-k="category" list="categoryList" value="${escapeHtml(row.category ?? '')}">`;
    return sku
      ? `<div class="r sku ${reasons ? 'flag' : ''}" data-row="${i}">${inp('product_name', bad('product_name'))}${inp('counter', bad('counter'))}${inp('sku', '')}${inp('quantity', bad('quantity'), 'number')}${inp('sales', bad('sales'), 'number')}${inp('cost', '', 'number')}${inp('profit', '', 'number')}${inp('margin_percent', '', 'number')}${reasons ? `<span class="needsChip" title="${escapeHtml(reasons.join(' • '))}">REVIEW</span>` : '<span></span>'}<button type="button" class="rm" data-remove="${i}" title="Remove row">&times;</button></div>`
      : `<div class="r ${reasons ? 'flag' : ''}" data-row="${i}">${inp('counter', bad('counter'))}${inp('quantity', bad('quantity'), 'number')}${inp('sales', bad('sales'), 'number')}${catInput}${reasons ? `<span class="needsChip" title="${escapeHtml(reasons.join(' • '))}">REVIEW</span>` : '<span></span>'}<button type="button" class="rm" data-remove="${i}" title="Remove row">&times;</button></div>`;
  }).join('');
}

// Typing a category on a page header relabels every row from that page in one go.
$import('#rowGrid').addEventListener('change', event => {
  const set = event.target.dataset?.setcat;
  if (set === undefined) return;
  const fileId = Number(set);
  const value = event.target.value.trim();
  state.rows.forEach(row => { if (row.fileId === fileId) row.category = value; });
  state.dirty = true;
  renderGrid();
  renderBanner();
  updateConfirmState();
  scheduleSave();
});

// All grid interaction through two delegated listeners - never a per-row handler, never a re-render on typing.
$import('#rowGrid').addEventListener('input', e => {
  const t = e.target;
  if (!t.dataset?.k) return;
  const row = state.rows[Number(t.dataset.i)];
  if (!row) return;
  const key = t.dataset.k;
  row[key] = NUM_KEYS.includes(key) ? (t.value === '' ? null : Number(t.value)) : t.value;
  state.dirty = true;
  renderBanner();
  updateConfirmState();
  scheduleSave();
});

reviewDialog.addEventListener('click', async e => {
  const remove = e.target.dataset?.remove;
  const tab = e.target.dataset?.tab;
  const retryFile = e.target.dataset?.retryFile;
  if (remove !== undefined && remove !== null && e.target.classList.contains('rm')) { state.rows.splice(Number(remove), 1); state.dirty = true; renderGrid(); renderBanner(); updateConfirmState(); scheduleSave(); }
  if (tab) renderTabs(Number(tab));
  if (retryFile) {
    const job = await fetch(`/api/import-jobs/${state.job.id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: Number(retryFile) }) }).then(r => r.json()).then(b => b.job).catch(() => null);
    if (job) { state.job.files = job.files; poll(job.id); reviewDialog.close(); uploadDialog.showModal(); setState('Reading report&hellip;', true); }
  }
});

$import('#addRowBtn').onclick = () => {
  state.rows.push({ fileId: state.currentFileId ?? state.job.files[0]?.id, counter: '', sku: null, product_name: null, quantity: null, sales: null, cost: null, profit: null, margin_percent: null, low_confidence: false, note: null });
  state.dirty = true;
  renderGrid();
  $import('#rowGrid').scrollTop = $import('#rowGrid').scrollHeight;
};

function fileSums(fileId) {
  const rows = state.rows.filter(r => r.fileId === fileId);
  return { qty: rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0), sales: round2c(rows.reduce((s, r) => s + (Number.isFinite(r.sales) ? r.sales : 0), 0)) };
}

function renderBanner() {
  const banner = $import('#reconBanner');
  const dup = state.job.duplicateOf;
  let status = 'no_printed_total', lines = [], mismatchFile = null;
  for (const f of state.job.files) {
    const printed = f.printedTotals;
    const sums = fileSums(f.id);
    if (!printed || (printed.quantity == null && printed.sales == null)) continue;
    status = 'ok';
    const qtyOk = printed.quantity == null || Math.round(sums.qty) === Math.round(printed.quantity);
    const salesOk = printed.sales == null || Math.abs(sums.sales - round2c(printed.sales)) <= 0.05;
    if (!qtyOk || !salesOk) { status = 'mismatch'; mismatchFile = mismatchFile || { f, sums, printed, qtyOk, salesOk }; }
    lines.push(`${f.filename}: ${Math.round(sums.qty)} units / ${money(sums.sales)}${status === 'mismatch' ? ` (report says ${Math.round(printed.quantity ?? 0)} / ${money(printed.sales ?? 0)})` : ' ✓'}`);
  }
  const total = state.rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);
  const totalSales = round2c(state.rows.reduce((s, r) => s + (Number.isFinite(r.sales) ? r.sales : 0), 0));
  if (status === 'mismatch' && mismatchFile) {
    const { f, sums, printed, qtyOk } = mismatchFile;
    banner.className = 'banner warn';
    banner.innerHTML = `<div>${qtyOk === false
      ? `The extracted rows total ${Math.round(sums.qty)} units, but the report says ${Math.round(printed.quantity)}.`
      : `The extracted rows total ${money(sums.sales)}, but the report says ${money(printed.sales)}.`}</div>${lines.map(l => `<small>${escapeHtml(l)}</small>`).join('')}`;
  } else if (status === 'ok') {
    banner.className = 'banner';
    banner.innerHTML = `Totals match the report (${Math.round(total)} units, ${money(totalSales)}).${lines.map(l => `<small>${escapeHtml(l)}</small>`).join('')}`;
  } else {
    banner.className = 'banner';
    banner.textContent = 'No printed totals were found to check against.';
  }
  if (dup) banner.innerHTML += `<small class="chip warn">Already imported once before (${escapeHtml(dup.retailer)} ${escapeHtml(dup.period_start)} to ${escapeHtml(dup.period_end)}) - make sure this is a new report, not the same file.</small>`;
  $import('#overrideWrap').hidden = status !== 'mismatch';
}

function invalidCount() {
  return state.rows.filter(r => !String(r.counter || '').trim() || !Number.isFinite(r.quantity) || !Number.isFinite(r.sales)).length;
}

function updateConfirmState() {
  const mismatch = $import('#reconBanner').className.includes('warn');
  const ok = !(mismatch && !$import('#overrideTotals').checked) && !invalidCount() && state.rows.length;
  $import('#confirmImport').disabled = !ok;
  if (invalidCount()) $import('#confirmImport').textContent = `Confirm import (${invalidCount()} row${invalidCount() > 1 ? 's' : ''} to fix)`;
  else $import('#confirmImport').textContent = 'Confirm import';
}
$import('#overrideTotals').onchange = updateConfirmState;

function metaValues() {
  return { retailer: $import('#reviewRetailer').value, category: $import('#reviewCategory').value, periodStart: $import('#reviewStart').value, periodEnd: $import('#reviewEnd').value, note: $import('#reviewNote').value };
}
['#reviewRetailer', '#reviewCategory', '#reviewStart', '#reviewEnd', '#reviewNote'].forEach(s => $import(s).addEventListener('input', () => { state.dirty = true; scheduleSave(); }));

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDraft, 1200);
}

async function saveDraft() {
  if (!state.dirty || !state.job || state.job.status !== 'review') return;
  const body = JSON.stringify({ ...metaValues(), rows: state.rows });
  const job = await fetch(`/api/import-jobs/${state.job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.json()).then(b => b.job).catch(() => null);
  if (job) { state.dirty = false; syncFromServer(job); }
}

// Server is the source of truth for flags/reconciliation - sync DOM marks without re-rendering inputs.
// Overlap note: a restated period (1-21 Aug after 1-18 Aug) replaces the earlier report so days aren't counted twice.
function renderOverlapNote(job) {
  const el = $import('#overlapNote');
  const overlaps = job.overlaps || [];
  if (!overlaps.length || job.status !== 'review') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = 'banner warn';
  el.innerHTML = `<div>An earlier ${escapeHtml(job.retailer || '')} report (${escapeHtml(job.category || 'Uncategorised')}) already covers some of these days: ${overlaps.map(o => `${escapeHtml(o.periodStart)} to ${escapeHtml(o.periodEnd)}`).join(', ')}.</div><label class="override"><input type="checkbox" id="replaceOverlapping" checked> Replace the earlier report (recommended &mdash; the new one restates those days, so adding both would count them twice)</label>`;
}

function syncFromServer(job) {
  state.job = job;
  renderOverlapNote(job);
  state.flags = new Map((job.reconciliation?.flagged || []).map(f => [`${f.fileId}:${f.index}`, f.reasons]));
  $import('#rowGrid').querySelectorAll('.r[data-row]').forEach(el => {
    const i = Number(el.dataset.row);
    const row = state.rows[i];
    const reasons = row && state.flags.get(`${row.fileId}:${i}`);
    el.classList.toggle('flag', !!reasons);
    const chip = el.querySelector('.needsChip');
    if (reasons && !chip) el.insertAdjacentHTML('beforeend', '<span class="needsChip">REVIEW</span>');
    if (reasons && chip) chip.title = escapeHtml(reasons.join(' • '));
    if (!reasons && chip) chip.remove();
  });
  renderBanner();
  updateConfirmState();
}

$import('#saveDraft').onclick = async () => { await saveDraft(); reviewDialog.close(); };
$import('#closeReview').onclick = () => { saveDraft(); reviewDialog.close(); };

$import('#confirmImport').onclick = async () => {
  const button = $import('#confirmImport');
  button.disabled = true; button.textContent = 'Importing…';
  await saveDraft();
  const response = await fetch(`/api/import-jobs/${state.job.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrideTotals: $import('#overrideTotals').checked, replaceOverlapping: $import('#replaceOverlapping') ? $import('#replaceOverlapping').checked : true }) });
  const body = await response.json().catch(() => ({}));
  if (response.ok) {
    reviewDialog.close();
    alert(`Imported ${body.imported} rows${body.replaced?.length ? ` (replaced ${body.replaced.length} earlier report${body.replaced.length > 1 ? 's' : ''})` : ''}.`);
    if (window.loadRows) loadRows();
    load();
  } else if (body.code === 'totals_mismatch') {
    syncFromServer({ ...state.job, reconciliation: body.reconciliation });
    $import('#reconBanner').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (body.code === 'invalid_rows') {
    (body.bad || []).forEach(b => state.flags.set(`${b.fileId}:${b.index}`, b.reasons));
    syncFromServer(state.job);
  } else {
    alert(body.error || 'Something went wrong on our side. Your draft was saved - try again.');
  }
  button.textContent = 'Confirm import';
  updateConfirmState();
};
