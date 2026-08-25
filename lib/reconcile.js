// Pure extraction cleanup and totals reconciliation: sanitize Gemini output into canonical rows,
// merge multi-file drafts, and compare extracted sums against printed totals (qty exact, money ±0.05).

const round2 = value => Math.round(value * 100) / 100;
const TOTAL_LINE = /^(grand\s+)?total$|^jumlah(\s+besar)?$|^sub\s*-?total$/i;

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const cleaned = String(value).replace(/rm|,|\s/gi, '');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const money = value => { const parsed = num(value); return parsed == null ? null : round2(parsed); };
const text = value => (value == null || value === '') ? null : String(value).trim();

// One Gemini result -> canonical rows + warnings + what was printed on that file.
function sanitize(parsed, fileId, filename) {
  const warnings = [...(parsed.warnings || [])];
  const rows = [];
  for (const row of parsed.rows || []) {
    const counter = text(row.counter) || '';
    if (TOTAL_LINE.test(counter)) { warnings.push(`Ignored printed total line "${counter}".`); continue; }
    const quantity = num(row.quantity);
    const sales = money(row.sales);
    const low = !!row.low_confidence || quantity == null || sales == null;
    const note = [text(row.note), (quantity == null ? 'quantity unreadable' : null), (sales == null ? 'sales unreadable' : null)].filter(Boolean).join('; ') || null;
    rows.push({
      fileId, counter, sku: text(row.sku), product_name: text(row.product_name),
      quantity, sales, cost: money(row.cost), profit: money(row.profit), margin_percent: num(row.margin_percent),
      low_confidence: low, note
    });
  }
  return {
    rows, warnings, fileId,
    printedTotals: parsed.printed_totals && (parsed.printed_totals.quantity != null || parsed.printed_totals.sales != null)
      ? { quantity: num(parsed.printed_totals.quantity), sales: money(parsed.printed_totals.sales) } : null,
    documentType: parsed.document_type || 'unknown',
    retailerGuess: text(parsed.retailer_guess) || '',
    periodStart: text(parsed.period_guess_start) || '',
    periodEnd: text(parsed.period_guess_end) || '',
    filename
  };
}

// Several sanitized files -> one draft: flat rows plus per-file printed totals for later checks.
function mergeFiles(results) {
  const rows = results.flatMap(result => result.rows);
  const first = predicate => results.find(predicate) || {};
  return {
    rows,
    documentType: (first(r => r.documentType && r.documentType !== 'unknown').documentType) || 'unknown',
    retailerGuess: first(r => r.retailerGuess).retailerGuess || '',
    periodStart: first(r => r.periodStart).periodStart || '',
    periodEnd: first(r => r.periodEnd).periodEnd || '',
    files: results.map(r => ({ fileId: r.fileId, filename: r.filename, printedTotals: r.printedTotals, documentType: r.documentType })),
    warnings: results.flatMap(r => r.warnings)
  };
}

// Compare current (possibly edited) rows against each file's printed totals; flag rows needing eyes.
function reconcile(merged, rows) {
  const files = (merged.files || []).map(file => {
    const fileRows = rows.filter(row => row.fileId === file.fileId);
    const extractedQty = fileRows.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0);
    const extractedSales = round2(fileRows.reduce((sum, row) => sum + (Number.isFinite(row.sales) ? row.sales : 0), 0));
    const printed = file.printedTotals;
    const has = printed && (printed.quantity != null || printed.sales != null);
    const qtyOk = !has || printed.quantity == null || Math.round(extractedQty) === Math.round(printed.quantity);
    const salesOk = !has || printed.sales == null || Math.abs(extractedSales - round2(printed.sales)) <= 0.05;
    return {
      fileId: file.fileId, filename: file.filename,
      extractedQty, extractedSales, printedQty: printed ? printed.quantity : null, printedSales: printed ? printed.sales : null,
      qtyOk, salesOk, status: !has ? 'no_printed_total' : (qtyOk && salesOk ? 'ok' : 'mismatch')
    };
  });
  const overall = {
    extractedQty: rows.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0),
    extractedSales: round2(rows.reduce((sum, row) => sum + (Number.isFinite(row.sales) ? row.sales : 0), 0))
  };
  const flagged = [];
  rows.forEach((row, index) => {
    const reasons = [];
    if (!row.counter || !String(row.counter).trim()) reasons.push('Counter name is empty');
    if (!Number.isFinite(row.quantity)) reasons.push('Quantity is not a number');
    if (!Number.isFinite(row.sales)) reasons.push('Sales is not a number');
    if (Number.isFinite(row.quantity) && row.quantity < 0) reasons.push('Negative quantity - check this is a real return');
    if (row.low_confidence) reasons.push(row.note || 'The reader was unsure about this row');
    if (reasons.length) flagged.push({ fileId: row.fileId, index, reasons });
  });
  // Same counter twice within ONE counter-table file is usually a duplicated photo page, not a real repeat
  // (SKU reports legitimately repeat the outlet name, so those files are exempt).
  const fileTypes = new Map((merged.files || []).map(file => [file.fileId, file.documentType]));
  const counts = {};
  for (const row of rows) {
    if (fileTypes.get(row.fileId) !== 'counter_table') continue;
    const key = `${row.fileId}|${String(row.counter || '').trim().toLowerCase()}`;
    if (key.split('|')[1]) counts[key] = (counts[key] || 0) + 1;
  }
  rows.forEach((row, index) => {
    const key = `${row.fileId}|${String(row.counter || '').trim().toLowerCase()}`;
    if (!counts[key] || counts[key] < 2) return;
    const reason = `This counter appears ${counts[key]} times in this file - check it is not a duplicated page`;
    const entry = flagged.find(item => item.index === index && item.fileId === row.fileId);
    if (entry) entry.reasons.push(reason); else flagged.push({ fileId: row.fileId, index, reasons: [reason] });
  });
  const anyPrinted = files.some(file => file.status !== 'no_printed_total');
  const status = files.some(file => file.status === 'mismatch') ? 'mismatch' : (anyPrinted ? 'ok' : 'no_printed_total');
  return { status, files, overall, flagged, override: false };
}

module.exports = { sanitize, mergeFiles, reconcile, round2 };
