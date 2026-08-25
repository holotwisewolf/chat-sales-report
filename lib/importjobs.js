// Import job routes: upload -> AI read -> reviewable draft -> confirm transaction. Owns its tables,
// the uploads/ folder, and the background read pipeline. Nothing touches reports/sales_lines until confirm.

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const { validateBatch } = require('./validate');
const { readReport } = require('./gemini');
const { sanitize, mergeFiles, reconcile } = require('./reconcile');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 12 } });
const UNAVAILABLE = 'The report reader is temporarily unavailable. Your file was not imported; try again later.';
const NO_TABLE = 'I could read the file, but couldn\'t find a sales table to import.';
const NOT_FOUND = 'This import no longer exists.';
const OPEN_STATUSES = ['reading', 'review', 'failed_read', 'failed_no_table'];

const httpError = (status, code, message, extra) => Object.assign(new Error(message), { httpError: true, status, code, extra });
const parseJson = value => { try { return JSON.parse(value || 'null'); } catch { return null; } };
const safeName = name => path.basename(String(name || 'file')).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);

function registerImportRoutes(app, db, { counterId, categoryId }) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'reading',
      error_code TEXT,
      error_message TEXT,
      retailer TEXT,
      category TEXT,
      period_start TEXT,
      period_end TEXT,
      extracted_json TEXT,
      edited_json TEXT,
      reconciliation_json TEXT,
      report_id INTEGER REFERENCES reports(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
    CREATE TABLE IF NOT EXISTS import_files (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      sort INTEGER NOT NULL DEFAULT 0,
      filename TEXT,
      path TEXT,
      mime TEXT,
      size_bytes INTEGER,
      page_count INTEGER,
      status TEXT NOT NULL DEFAULT 'reading',
      error_code TEXT,
      error_message TEXT,
      provider_model TEXT,
      provider_raw_json TEXT,
      printed_totals_json TEXT,
      rows_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_import_files_job ON import_files(job_id);
  `);
  // A crash must never leave a draft stuck on "reading" forever.
  db.prepare("UPDATE import_jobs SET status='failed_read', error_code='read_failed', error_message=? WHERE status='reading'").run(`Interrupted by a server restart. ${UNAVAILABLE}`);
  db.prepare("UPDATE import_files SET status='failed_read', error_code='read_failed', error_message=? WHERE status='reading'").run(`Interrupted by a server restart. ${UNAVAILABLE}`);

  const q = {
    job: db.prepare('SELECT * FROM import_jobs WHERE id = ?'),
    openJobs: db.prepare(`SELECT j.* FROM import_jobs j WHERE j.status IN ('reading','review','failed_read','failed_no_table') ORDER BY j.id DESC LIMIT 20`),
    insertJob: db.prepare("INSERT INTO import_jobs (status) VALUES ('reading')"),
    insertFile: db.prepare('INSERT INTO import_files (job_id, sort, filename, path, mime, size_bytes, page_count) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    files: db.prepare('SELECT * FROM import_files WHERE job_id = ? ORDER BY sort, id'),
    file: db.prepare('SELECT * FROM import_files WHERE id = ? AND job_id = ?'),
    readFileRow: db.prepare('SELECT * FROM import_files WHERE id = ?'),
    updateFile: db.prepare('UPDATE import_files SET status = ?, error_code = ?, error_message = ?, provider_model = ?, provider_raw_json = ?, printed_totals_json = ?, rows_json = ? WHERE id = ?'),
    readFiles: db.prepare("SELECT * FROM import_files WHERE job_id = ? AND status = 'read' ORDER BY sort, id"),
    resetFile: db.prepare("UPDATE import_files SET status = 'reading', error_code = NULL, error_message = NULL WHERE id = ?"),
    updateJobMeta: db.prepare('UPDATE import_jobs SET retailer = ?, category = ?, period_start = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    updateJobState: db.prepare('UPDATE import_jobs SET status = ?, error_code = ?, error_message = ?, extracted_json = ?, edited_json = ?, reconciliation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    patchJob: db.prepare('UPDATE import_jobs SET retailer = COALESCE(?, retailer), category = COALESCE(?, category), period_start = COALESCE(?, period_start), period_end = COALESCE(?, period_end), edited_json = ?, reconciliation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    confirmJob: db.prepare("UPDATE import_jobs SET status = 'confirmed', report_id = ?, confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
    discardJob: db.prepare("UPDATE import_jobs SET status = 'discarded', updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
    dupReport: db.prepare(`SELECT r.id, r.retailer, r.period_start, r.period_end FROM reports r JOIN import_jobs j ON j.report_id = r.id AND j.status = 'confirmed'
                           WHERE r.retailer = ? AND r.period_start = ? AND r.period_end = ? AND r.source_filename = ? LIMIT 1`)
  };

  const mismatchMessage = recon => {
    const file = recon.files.find(f => f.status === 'mismatch');
    if (!file) return 'The extracted rows and the printed totals disagree.';
    const money = value => Number(value || 0).toFixed(2);
    return file.qtyOk === false
      ? `The extracted rows total ${Math.round(file.extractedQty)} units, but the report says ${Math.round(file.printedQty)} (RM ${money(file.extractedSales)} vs RM ${money(file.printedSales)}).`
      : `The extracted rows total RM ${money(file.extractedSales)}, but the report says RM ${money(file.printedSales)}.`;
  };

  const jobJson = row => {
    const extracted = parseJson(row.extracted_json);
    const edited = parseJson(row.edited_json);
    const files = q.files.all(row.id).map(file => ({
      id: file.id, filename: file.filename, mime: file.mime, status: file.status,
      errorCode: file.error_code, errorMessage: file.error_message, pageCount: file.page_count,
      fileUrl: `/api/import-jobs/${row.id}/file/${file.id}`, printedTotals: parseJson(file.printed_totals_json)
    }));
    return {
      id: row.id, status: row.status, errorCode: row.error_code, errorMessage: row.error_message,
      retailer: row.retailer, category: row.category, periodStart: row.period_start, periodEnd: row.period_end,
      documentType: extracted?.documentType || 'unknown',
      warnings: extracted?.warnings || [],
      rows: edited ?? extracted?.rows ?? [],
      reconciliation: parseJson(row.reconciliation_json),
      reportId: row.report_id, createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at,
      duplicateOf: row.status === 'review' && row.retailer && row.period_start && row.period_end && files[0]
        ? (q.dupReport.get(row.retailer, row.period_start, row.period_end, files[0].filename) || null)
        : null,
      files
    };
  };

  // Rebuild job-level state from every successfully read file; decides review vs failed_* statuses.
  function rebuildJob(jobId) {
    const results = q.readFiles.all(jobId).map(file => parseJson(file.rows_json)).filter(Boolean);
    if (results.length) {
      const merged = mergeFiles(results);
      const job = q.job.get(jobId);
      const rows = merged.rows;
      const recon = reconcile(merged, rows);
      q.updateJobState.run('review', null, null, JSON.stringify(merged), null, JSON.stringify(recon), jobId);
      q.updateJobMeta.run(job.retailer ?? (merged.retailerGuess || null), job.category ?? null, job.period_start ?? (merged.periodStart || null), job.period_end ?? (merged.periodEnd || null), jobId);
    } else {
      const files = q.files.all(jobId);
      const anyFailed = files.some(file => file.status === 'failed_read');
      const code = anyFailed ? 'read_failed' : 'no_table';
      const message = anyFailed ? UNAVAILABLE : NO_TABLE;
      q.updateJobState.run(anyFailed ? 'failed_read' : 'failed_no_table', code, message, null, null, null, jobId);
    }
  }

  async function readFileRow(file) {
    const buffer = fs.readFileSync(file.path);
    const { parsed, raw } = await readReport({ buffer, mime: file.mime, filename: file.filename });
    const clean = sanitize(parsed, file.id, file.filename);
    if (clean.documentType === 'unknown' || !clean.rows.length) {
      q.updateFile.run('no_table', 'no_table', NO_TABLE, raw.model, JSON.stringify(raw), JSON.stringify(clean.printedTotals), JSON.stringify(clean), file.id);
      return;
    }
    q.updateFile.run('read', null, null, raw.model, JSON.stringify(raw), JSON.stringify(clean.printedTotals), JSON.stringify(clean), file.id);
  }

  // Sequential per-file reads; every async step is caught so this floating promise can never die silently.
  async function processJob(jobId, onlyFileId) {
    try {
      const pending = q.files.all(jobId).filter(file => file.status !== 'read' && (!onlyFileId || file.id === onlyFileId));
      for (const file of pending) {
        try { await readFileRow(file); }
        catch (error) { q.updateFile.run('failed_read', error.code || 'read_failed', error.message || UNAVAILABLE, null, null, null, null, file.id); }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      rebuildJob(jobId);
    } catch (error) {
      q.updateJobState.run('failed_read', 'read_failed', UNAVAILABLE, null, null, null, jobId);
    }
  }

  // Multi-page PDFs are split into one file row per page: every page gets read (models skip trailing
  // pages when handed a whole document) and each page reconciles against its own printed totals.
  async function splitPdfPages(buffer) {
    const src = await PDFDocument.load(buffer);
    const pages = [];
    for (let i = 0; i < src.getPageCount(); i++) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [i]);
      doc.addPage(page);
      pages.push(Buffer.from(await doc.save()));
    }
    return pages;
  }

  app.post('/api/import-jobs', upload.array('files', 12), async (req, res) => {
    try {
      const check = await validateBatch(req.files || []);
      if (!check.ok) return res.status(check.code === 'file_too_large' ? 413 : 400).json({ error: check.message, code: check.code, fileErrors: check.fileErrors });
      const payloads = [];
      for (const [index, file] of (req.files || []).entries()) {
        const result = check.results[index];
        if (result.mime === 'application/pdf' && result.pageCount > 1) {
          const pages = await splitPdfPages(file.buffer);
          pages.forEach((pageBuffer, pageIndex) => payloads.push({
            buffer: pageBuffer, originalname: `${file.originalname} (page ${pageIndex + 1} of ${pages.length})`,
            size: pageBuffer.length, mime: 'application/pdf', pageCount: 1
          }));
        } else {
          payloads.push({ buffer: file.buffer, originalname: file.originalname, size: file.size, mime: result.mime, pageCount: result.pageCount });
        }
      }
      const create = db.transaction(() => {
        const jobId = q.insertJob.run().lastInsertRowid;
        payloads.forEach((payload, index) => {
          const fileId = q.insertFile.run(jobId, index, payload.originalname, '', payload.mime, payload.size, payload.pageCount).lastInsertRowid;
          const stored = path.join(UPLOADS_DIR, `${fileId}-${safeName(payload.originalname)}`);
          fs.writeFileSync(stored, payload.buffer);
          db.prepare('UPDATE import_files SET path = ? WHERE id = ?').run(stored, fileId);
        });
        return jobId;
      });
      const jobId = create();
      processJob(jobId);
      res.status(201).json({ job: jobJson(q.job.get(jobId)) });
    } catch (error) {
      res.status(500).json({ error: `Something went wrong on our side. Your file was saved as a draft - try again. (${error.message})`, code: 'internal_error' });
    }
  });

  app.get('/api/import-jobs', (req, res) => {
    res.json({ jobs: q.openJobs.all().map(jobJson) });
  });

  app.get('/api/import-jobs/:id', (req, res) => {
    const job = q.job.get(req.params.id);
    if (!job) return res.status(404).json({ error: NOT_FOUND, code: 'not_found' });
    res.json({ job: jobJson(job) });
  });

  app.get('/api/import-jobs/:id/file/:fileId', (req, res) => {
    const file = q.file.get(req.params.fileId, req.params.id);
    if (!file || !file.path || !fs.existsSync(file.path)) return res.status(404).json({ error: NOT_FOUND, code: 'not_found' });
    res.type(file.mime);
    res.sendFile(path.resolve(file.path));
  });

  app.patch('/api/import-jobs/:id', (req, res) => {
    const job = q.job.get(req.params.id);
    if (!job) return res.status(404).json({ error: NOT_FOUND, code: 'not_found' });
    if (job.status !== 'review') return res.status(409).json({ error: job.status === 'confirmed' ? 'This report was already imported.' : 'This draft is not ready for edits yet.', code: 'not_in_review' });
    const body = req.body || {};
    const extracted = parseJson(job.extracted_json) || { files: [] };
    const rows = Array.isArray(body.rows) ? body.rows : parseJson(job.edited_json) ?? extracted.rows ?? [];
    const firstFileId = q.files.all(job.id)[0]?.id ?? null;
    for (const row of rows) if (row && row.fileId == null) row.fileId = firstFileId;
    const recon = reconcile(extracted, rows);
    recon.override = !!body.overrideTotals || !!parseJson(job.reconciliation_json)?.override;
    q.patchJob.run(body.retailer?.trim() || null, body.category?.trim() || null, body.periodStart || null, body.periodEnd || null,
      Array.isArray(body.rows) ? JSON.stringify(rows) : job.edited_json, JSON.stringify(recon), job.id);
    res.json({ job: jobJson(q.job.get(job.id)) });
  });

  app.post('/api/import-jobs/:id/confirm', (req, res) => {
    const body = req.body || {};
    const run = db.transaction(() => {
      const job = q.job.get(req.params.id);
      if (!job) throw httpError(404, 'not_found', NOT_FOUND);
      if (job.status !== 'review') throw httpError(409, 'not_in_review', job.status === 'confirmed' ? 'This report was already imported.' : 'This draft is still being read.');
      const retailer = (job.retailer || '').trim(), periodStart = job.period_start, periodEnd = job.period_end;
      if (!retailer || !periodStart || !periodEnd) throw httpError(409, 'missing_meta', 'Set the retailer and the report period before importing.');
      const extracted = parseJson(job.extracted_json) || { files: [] };
      const rows = parseJson(job.edited_json) ?? extracted.rows ?? [];
      // Row problems are actionable data entry - surface them before the (derived) totals disagreement.
      const bad = [];
      rows.forEach((row, index) => {
        const reasons = [];
        if (!row.counter || !String(row.counter).trim()) reasons.push('Counter name is empty');
        if (row.quantity == null || row.quantity === '' || !Number.isFinite(row.quantity)) reasons.push('Quantity is missing or not a number');
        if (row.sales == null || row.sales === '' || !Number.isFinite(row.sales)) reasons.push('Sales is missing or not a number');
        if (reasons.length) bad.push({ fileId: row.fileId, index, reasons });
      });
      if (bad.length) throw httpError(409, 'invalid_rows', 'Fix the highlighted rows before importing.', { bad });
      const recon = reconcile(extracted, rows);
      if (recon.status === 'mismatch' && !body.overrideTotals && !parseJson(job.reconciliation_json)?.override) throw httpError(409, 'totals_mismatch', mismatchMessage(recon), { reconciliation: recon });
      const files = q.files.all(job.id);
      const reportId = db.prepare("INSERT INTO reports (retailer, period_start, period_end, source_filename, source_type) VALUES (?, ?, ?, ?, 'ai-review')")
        .run(retailer, periodStart, periodEnd, files[0]?.filename || null).lastInsertRowid;
      const category = (job.category || '').trim() || 'Uncategorised';
      const categoryKey = categoryId(category);
      const insertLine = db.prepare('INSERT INTO sales_lines (report_id, counter_id, category_id, product_category, product_name, sku, quantity, sales, cost, profit, margin_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of rows) insertLine.run(reportId, counterId(row.counter, retailer), categoryKey, category, row.product_name || null, row.sku || null, Number(row.quantity), Number(row.sales), row.cost ?? null, row.profit ?? null, row.margin_percent ?? null);
      q.confirmJob.run(reportId, job.id);
      return { imported: rows.length, reportId, totals: recon.overall };
    });
    try { res.json(run()); } catch (error) {
      if (error.httpError) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.extra || {}) });
      throw error;
    }
  });

  app.post('/api/import-jobs/:id/retry', (req, res) => {
    const job = q.job.get(req.params.id);
    if (!job) return res.status(404).json({ error: NOT_FOUND, code: 'not_found' });
    const fileId = req.body?.fileId;
    if (fileId) {
      const file = q.file.get(fileId, job.id);
      if (!file || file.status === 'read') return res.status(409).json({ error: 'This file does not need to be re-read.', code: 'not_retryable' });
      q.resetFile.run(fileId);
      processJob(job.id, fileId);
    } else {
      if (!['failed_read', 'failed_no_table'].includes(job.status)) return res.status(409).json({ error: 'This draft cannot be re-read.', code: 'not_retryable' });
      q.files.all(job.id).filter(file => file.status !== 'read').forEach(file => q.resetFile.run(file.id));
      q.updateJobState.run('reading', null, null, null, null, null, job.id);
      processJob(job.id);
    }
    res.status(202).json({ job: jobJson(q.job.get(job.id)) });
  });

  app.delete('/api/import-jobs/:id', (req, res) => {
    const job = q.job.get(req.params.id);
    if (!job) return res.status(404).json({ error: NOT_FOUND, code: 'not_found' });
    q.discardJob.run(job.id);
    res.json({ ok: true });
  });

  // Map multer/body-parser failures on our routes to their exact UI strings.
  app.use((err, req, res, next) => {
    if (!req.path.startsWith('/api/import-jobs')) return next(err);
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'This file is bigger than the 10 MB limit. Please upload a smaller photo or PDF.', code: 'file_too_large' });
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Upload up to 12 files at a time.', code: 'too_many_files' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'We couldn\'t open this file. Please upload a PDF, JPG, or PNG.', code: 'unsupported_file_type' });
    next(err);
  });
}

module.exports = registerImportRoutes;
