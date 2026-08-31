// Data browser API: paginated, sortable, searchable sales rows with edit and delete.
// Sort keys are whitelisted (never interpolated from user input); mutations reuse the
// get-or-create helpers so renaming to a new counter/category creates it dynamically.

const SORT = {
  counter: 'c.name', retailer: 'r.retailer', category: 's.product_category', product: 's.product_name', sku: 's.sku',
  quantity: 's.quantity', sales: 's.sales', cost: 's.cost', profit: 's.profit', period: 'r.period_start'
};
const PAGE_SIZE = 50;

function registerDataRoutes(app, db, { counterId, categoryId, pruneOrphans }) {
  const rowSql = `SELECT s.id, r.retailer, c.name counter, s.product_category category, r.period_start periodStart, r.period_end periodEnd,
                         s.quantity, s.sales, s.cost, s.profit, s.sku, s.product_name productName, r.id reportId, r.source_type sourceType
                  FROM sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id`;
  const base = 'FROM sales_lines s JOIN counters c ON c.id=s.counter_id JOIN reports r ON r.id=s.report_id';

  // One filter builder feeds /api/rows and the CSV/Excel exports, so exports always
  // match exactly what the table is showing.
  function buildWhere(query) {
    const where = [];
    const params = {};
    if (query.retailer) { where.push('r.retailer = @retailer'); params.retailer = String(query.retailer); }
    if (query.category) { where.push('s.product_category = @category'); params.category = String(query.category); }
    if (query.month) { where.push('substr(r.period_end,1,7) = @month'); params.month = String(query.month); }
    if (query.monthOfYear) { where.push('substr(r.period_end,6,2) = @monthOfYear'); params.monthOfYear = String(query.monthOfYear).padStart(2, '0'); }
    if (query.from) { where.push('r.period_end >= @from'); params.from = String(query.from); }
    if (query.to) { where.push('r.period_start <= @to'); params.to = String(query.to); }
    const monthList = value => String(value || '').split(',').map(m => m.trim()).filter(m => /^(0?[1-9]|1[0-2])$/.test(m)).map(m => m.padStart(2, '0'));
    const includeMonths = monthList(query.months);
    const excludeMonths = monthList(query.exMonths);
    if (includeMonths.length) { where.push(`substr(r.period_end,6,2) IN (${includeMonths.map((m, i) => '@m' + i).join(',')})`); includeMonths.forEach((m, i) => params['m' + i] = m); }
    if (excludeMonths.length) { where.push(`substr(r.period_end,6,2) NOT IN (${excludeMonths.map((m, i) => '@x' + i).join(',')})`); excludeMonths.forEach((m, i) => params['x' + i] = m); }
    if (query.q) { where.push('(c.name LIKE @q OR r.retailer LIKE @q OR s.sku LIKE @q OR s.product_name LIKE @q)'); params.q = `%${String(query.q)}%`; }
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  app.get('/api/rows', (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const { whereSql, params } = buildWhere(req.query);
    const orderSql = `ORDER BY ${SORT[req.query.sort] || SORT.period} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}, s.id DESC`;
    const total = db.prepare(`SELECT COUNT(*) count ${base} ${whereSql}`).get(params).count;
    const rows = db.prepare(`${rowSql} ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`).all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    const totals = db.prepare(`SELECT ROUND(COALESCE(SUM(s.quantity),0),2) quantity, ROUND(COALESCE(SUM(s.sales),0),2) sales,
                                      ROUND(COALESCE(SUM(s.cost),0),2) cost, ROUND(COALESCE(SUM(s.profit),0),2) profit ${base} ${whereSql}`).get(params);
    const present = column => db.prepare(`SELECT COUNT(*) count ${base} ${whereSql ? whereSql + ' AND' : 'WHERE'} s.${column} IS NOT NULL`).get(params).count > 0;
    res.json({
      rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE, totals,
      columns: { product: present('product_name'), sku: present('sku'), cost: present('cost'), profit: present('profit') }
    });
  });

  // Export what the table shows: format=csv (with BOM so Excel reads UTF-8) or format=xls
  // (an HTML table Excel opens natively). Not paginated - the whole filtered set.
  app.get('/api/export', (req, res) => {
    const { whereSql, params } = buildWhere(req.query);
    const orderSql = `ORDER BY ${SORT[req.query.sort] || SORT.period} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}, s.id DESC`;
    const rows = db.prepare(`${rowSql} ${whereSql} ${orderSql}`).all(params);
    const headers = ['#', 'Counter', 'Retailer', 'Category', 'Product', 'SKU', 'Qty', 'Sales (RM)', 'Cost', 'Profit', 'Period start', 'Period end'];
    const line = row => [rows.indexOf(row) + 1, row.counter, row.retailer, row.category, row.productName, row.sku, row.quantity, row.sales, row.cost, row.profit, row.periodStart, row.periodEnd];
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.query.format === 'xls') {
      const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const table = `<table border="1"><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${line(r).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
      res.set('Content-Type', 'application/vnd.ms-excel');
      res.set('Content-Disposition', `attachment; filename="sales-${stamp}.xls"`);
      return res.send(`<html><head><meta charset="utf-8"></head><body>${table}</body></html>`);
    }
    const csvEscape = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="sales-${stamp}.csv"`);
    res.send('﻿' + [headers, ...rows.map(line)].map(r => r.map(csvEscape).join(',')).join('\r\n'));
  });

  app.patch('/api/rows/:id', (req, res) => {
    const current = db.prepare(`${rowSql} WHERE s.id = ?`).get(req.params.id);
    if (!current) return res.status(404).json({ error: 'That row no longer exists. Refresh the table.', code: 'not_found' });
    const body = req.body || {};
    const sets = [];
    const params = { id: current.id };
    const bad = (message) => Object.assign(new Error(message), { httpError: true, status: 400, code: 'invalid_value' });
    const num = (key, nullable) => {
      if (body[key] === undefined) return;
      if (body[key] === null || body[key] === '') {
        if (!nullable) throw bad(`${key} can't be empty`);
        sets.push(`${key} = NULL`); return;
      }
      const value = Number(body[key]);
      if (!Number.isFinite(value)) throw bad(`${key} must be a number`);
      sets.push(`${key} = @${key}`); params[key] = value;
    };
    try {
      if (body.counter !== undefined && String(body.counter).trim()) {
        sets.push('counter_id = @counterId'); params.counterId = counterId(String(body.counter), current.retailer);
      }
      // Retailer lives on the whole report: changing it moves every row of that report,
      // and each line's counter is re-bound to a counter of the same name under the new retailer.
      if (body.retailer !== undefined && String(body.retailer).trim() && String(body.retailer).trim() !== current.retailer) {
        const newRetailer = String(body.retailer).trim();
        const affectedRows = db.prepare('SELECT COUNT(*) count FROM sales_lines WHERE report_id = ?').get(current.reportId).count;
        db.prepare('UPDATE reports SET retailer = ? WHERE id = ?').run(newRetailer, current.reportId);
        const newCounterId = counterId(current.counter, newRetailer);
        db.prepare('UPDATE sales_lines SET counter_id = ? WHERE id = ?').run(newCounterId, current.id);
        return res.json({ row: db.prepare(`${rowSql} WHERE s.id = ?`).get(current.id), affectedRows });
      }
      if (body.category !== undefined && String(body.category).trim()) {
        const category = String(body.category).trim();
        sets.push('category_id = @categoryId', 'product_category = @category'); params.categoryId = categoryId(category); params.category = category;
      }
      num('quantity', false); num('sales', false); num('cost', true); num('profit', true);
      if (body.sku !== undefined) { sets.push('sku = @sku'); params.sku = String(body.sku).trim() || null; }
      if (body.productName !== undefined) { sets.push('product_name = @productName'); params.productName = String(body.productName).trim() || null; }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update.', code: 'no_changes' });
      db.prepare(`UPDATE sales_lines SET ${sets.join(', ')} WHERE id = @id`).run(params);
      res.json({ row: db.prepare(`${rowSql} WHERE s.id = ?`).get(current.id) });
    } catch (error) {
      if (error.httpError) return res.status(error.status).json({ error: error.message, code: error.code });
      throw error;
    }
  });

  app.delete('/api/rows/:id', (req, res) => {
    const current = db.prepare('SELECT id, report_id FROM sales_lines WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'That row no longer exists. Refresh the table.', code: 'not_found' });
    // Undo support: report back any report that disappeared with this row so the client can restore it.
    let removedReport = null;
    db.transaction(() => {
      db.prepare('DELETE FROM sales_lines WHERE id = ?').run(current.id);
      if (!db.prepare('SELECT COUNT(*) count FROM sales_lines WHERE report_id = ?').get(current.report_id).count) {
        removedReport = db.prepare('SELECT retailer, period_start, period_end, source_filename, source_type FROM reports WHERE id = ?').get(current.report_id) || null;
        db.prepare('UPDATE import_jobs SET report_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE report_id = ?').run(current.report_id);
        db.prepare('DELETE FROM reports WHERE id = ?').run(current.report_id);
      }
      if (pruneOrphans) pruneOrphans();
    })();
    res.json({ ok: true, removedReport });
  });

  // Remove a whole report (its sales lines cascade). The import job that created it, if any,
  // is marked deimported so history stops offering undo for removed data.
  app.delete('/api/reports/:id', (req, res) => {
    const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'That report no longer exists. Refresh the page.', code: 'not_found' });
    db.transaction(() => {
      const lines = db.prepare('SELECT COUNT(*) count FROM sales_lines WHERE report_id = ?').get(report.id).count;
      db.prepare("UPDATE import_jobs SET status = 'deimported', report_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE report_id = ?").run(report.id);
      db.prepare('DELETE FROM reports WHERE id = ?').run(report.id);
      if (pruneOrphans) pruneOrphans();
      res.json({ ok: true, lines });
    })();
  });

  // Undo for deletes: restore rows, reusing existing reports or recreating deleted reports.
  app.post('/api/rows/restore', (req, res) => {
    const body = req.body || {};
    const reports = Array.isArray(body.reports) ? body.reports : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'Nothing to restore.', code: 'empty' });
    const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
    try {
      const restored = db.transaction(() => {
        // Map any explicitly passed removed reports
        const createdReportIds = reports.map(report => db.prepare(
          'INSERT INTO reports (retailer, period_start, period_end, source_filename, source_type) VALUES (?, ?, ?, ?, ?)'
        ).run(report.retailer, report.period_start || report.periodStart, report.period_end || report.periodEnd, report.source_filename || report.sourceFilename || null, report.source_type || report.sourceType || 'manual').lastInsertRowid);

        let count = 0;
        const insertLine = db.prepare(`
          INSERT INTO sales_lines (report_id, counter_id, category_id, product_category, product_name, sku, quantity, sales, cost, profit, margin_percent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of rows) {
          let targetReportId = null;
          // 1. Check if the row's report still exists in the DB
          if (row.reportId) {
            const exists = db.prepare('SELECT id FROM reports WHERE id = ?').get(row.reportId);
            if (exists) targetReportId = exists.id;
          }
          // 2. Check if created by the reports array
          if (!targetReportId && createdReportIds.length) {
            targetReportId = createdReportIds[row._report ?? 0] ?? createdReportIds[0];
          }
          // 3. Check if an active report matching retailer and period dates exists
          if (!targetReportId && row.retailer && (row.periodStart || row.periodEnd)) {
            const matching = db.prepare('SELECT id FROM reports WHERE retailer = ? AND period_start = ? AND period_end = ? LIMIT 1')
              .get(row.retailer, row.periodStart || '', row.periodEnd || '');
            if (matching) targetReportId = matching.id;
          }
          // 4. If no report found anywhere, create one dynamically
          if (!targetReportId) {
            const newRep = db.prepare(
              'INSERT INTO reports (retailer, period_start, period_end, source_filename, source_type) VALUES (?, ?, ?, ?, ?)'
            ).run(row.retailer || 'Unknown', row.periodStart || new Date().toISOString().slice(0, 10), row.periodEnd || new Date().toISOString().slice(0, 10), row.sourceFilename || null, row.sourceType || 'manual');
            targetReportId = newRep.lastInsertRowid;
          }

          const category = (row.category || 'Uncategorised').trim() || 'Uncategorised';
          insertLine.run(
            targetReportId,
            counterId(row.counter || 'Unknown', row.retailer || 'Unknown'),
            categoryId(category),
            category,
            row.productName || null,
            row.sku || null,
            num(row.quantity),
            num(row.sales),
            num(row.cost),
            num(row.profit),
            num(row.margin_percent)
          );
          count++;
        }
        return count;
      })();
      res.json({ restored });
    } catch (err) {
      console.error('Error in /api/rows/restore:', err);
      res.status(500).json({ error: 'Could not restore rows: ' + err.message });
    }
  });
}

module.exports = registerDataRoutes;
