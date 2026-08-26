// Data browser API: paginated, sortable, searchable sales rows with edit and delete.
// Sort keys are whitelisted (never interpolated from user input); mutations reuse the
// get-or-create helpers so renaming to a new counter/category creates it dynamically.

const SORT = {
  counter: 'c.name', retailer: 'r.retailer', category: 's.product_category', product: 's.product_name', sku: 's.sku',
  quantity: 's.quantity', sales: 's.sales', cost: 's.cost', profit: 's.profit', period: 'r.period_start'
};
const PAGE_SIZE = 50;

function registerDataRoutes(app, db, { counterId, categoryId }) {
  const rowSql = `SELECT s.id, r.retailer, c.name counter, s.product_category category, r.period_start periodStart, r.period_end periodEnd,
                         s.quantity, s.sales, s.cost, s.profit, s.sku, s.product_name productName, r.id reportId, r.source_type sourceType
                  FROM sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id`;

  app.get('/api/rows', (req, res) => {
    const { retailer = '', category = '', month = '', q = '', sort = 'period', dir = 'desc' } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const where = [];
    const params = {};
    if (retailer) { where.push('r.retailer = @retailer'); params.retailer = String(retailer); }
    if (category) { where.push('s.product_category = @category'); params.category = String(category); }
    if (month) { where.push('substr(r.period_end,1,7) = @month'); params.month = String(month); }
    if (q) { where.push('(c.name LIKE @q OR r.retailer LIKE @q OR s.sku LIKE @q OR s.product_name LIKE @q)'); params.q = `%${String(q)}%`; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = `ORDER BY ${SORT[sort] || SORT.period} ${dir === 'asc' ? 'ASC' : 'DESC'}, s.id DESC`;
    const total = db.prepare(`SELECT COUNT(*) count FROM sales_lines s JOIN counters c ON c.id=s.counter_id JOIN reports r ON r.id=s.report_id ${whereSql}`).get(params).count;
    const rows = db.prepare(`${rowSql} ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`).all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
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
    db.transaction(() => {
      db.prepare('DELETE FROM sales_lines WHERE id = ?').run(current.id);
      if (!db.prepare('SELECT COUNT(*) count FROM sales_lines WHERE report_id = ?').get(current.report_id).count) {
        db.prepare('UPDATE import_jobs SET report_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE report_id = ?').run(current.report_id);
        db.prepare('DELETE FROM reports WHERE id = ?').run(current.report_id);
      }
    })();
    res.json({ ok: true });
  });
}

module.exports = registerDataRoutes;
