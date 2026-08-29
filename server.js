// Sales dashboard backend: SQLite store, dashboard API, manual import, and the AI upload/review pipeline.
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
try { process.loadEnvFile(); } catch {}

const app = express();
const db = new Database(path.join(__dirname, 'sales.db'));
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS counters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    retailer TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    retailer TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    source_filename TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sales_lines (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    counter_id INTEGER NOT NULL REFERENCES counters(id),
    product_name TEXT,
    product_category TEXT,
    sku TEXT,
    quantity REAL NOT NULL,
    sales REAL NOT NULL,
    cost REAL,
    profit REAL,
    margin_percent REAL
  );
`);

if (!db.prepare("PRAGMA table_info(sales_lines)").all().some(column => column.name === 'category_id')) {
  db.exec('ALTER TABLE sales_lines ADD COLUMN category_id INTEGER REFERENCES categories(id)');
}
db.prepare(`INSERT OR IGNORE INTO categories (name)
            SELECT DISTINCT product_category FROM sales_lines
            WHERE product_category IS NOT NULL AND trim(product_category) != ''`).run();
db.prepare(`UPDATE sales_lines
            SET category_id = (SELECT id FROM categories WHERE categories.name = sales_lines.product_category)
            WHERE category_id IS NULL AND product_category IS NOT NULL`).run();

function counterId(name, retailer) {
  const existing = db.prepare('SELECT id FROM counters WHERE name = ?').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO counters (name, retailer) VALUES (?, ?)').run(name.trim(), retailer.trim()).lastInsertRowid;
}

function categoryId(name) {
  const cleanName = name.trim() || 'Uncategorised';
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(cleanName);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO categories (name) VALUES (?)').run(cleanName).lastInsertRowid;
}

function seed() {
  if (db.prepare('SELECT COUNT(*) count FROM reports').get().count) return;
  const rows = [
    ['Mydin Sejati Ujana Hypermarket',157,7376.77],['Mydin Subang Jaya Hypermarket',97,5226.03],['Mydin Tunjong Hypermarket',88,4964.12],['Mydin Melaka Hypermarket',80,4145.21],['Mydin Ruru Raya Hypermarket',79,4069.01],['Mydin Bertam Hypermarket',64,3244.36],['Mydin Seremban 2 Hypermarket',60,3243.41],['Mydin Jasin Hypermarket',47,2404.55],['Mydin Kuala Terengganu Hypermarket',48,2337.52],['Mydin Taman Saga Hypermarket',44,2321.56],['Mydin Cantar Emporium',44,2241.58],['Mydin Sinar Kota Emporium',36,2192.71],['Mydin Sawangan Hypermarket',38,2006.66],['Mydin Bukit Mertajam Hypermarket',31,1699.69],['Mydin Semenyih Hypermarket',28,1470.72],['Mydin Shah Alam',30,1444.77],['Mydin Wholesale Teman Gopeng',16,831.84],['Mydin Mutiara Rini Hypermarket',14,827.87],['Mydin Mart Sri Muda',14,662.86],['Mydin Wholesale Emporium Penang',11,489.89],['Mydin Jalan Sebang Hypermarket',9,472.95],['Mydin Gong Badak Hypermarket',7,338.93]
  ];
  const hero = [['MY HERO HYPERMARKET SDN BHD (PUCHONG BT14)',84,2762.78],['MY HERO HYPERMARKET SDN BHD (PUTRAJAYA)',65,2140.13],['MY HERO HYPERMARKET SDN BHD (BANDAR PUTERI PUCHONG)',53,2124.61],['MY HERO HYPERMARKET SDN BHD (SUNGAI MAS PLAZA)',27,989.39],['MY HERO HYPERMARKET SDN BHD (ANGSANA JOHOR BAHRU)',22,852.98],['MY HERO HYPERMARKET SDN BHD (H031 SELAYANG)',23,651.88],['MY HERO HYPERMARKET SDN BHD (KIMPAL BANGUN)',9,449.65],['MY HERO HYPERMARKET SDN BHD (KOTA KEMUNING)',16,373.49],['MY HERO HYPERMARKET SDN BHD (JELUTONG SHAH ALAM)',15,350.50],['MY HERO HYPERMARKET SDN BHD (WANGSA MAJU)',10,272.10]];
  const insertReport = db.prepare('INSERT INTO reports (retailer, period_start, period_end, source_filename, source_type) VALUES (?, ?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO sales_lines (report_id,counter_id,product_category,quantity,sales) VALUES (?, ?, ?, ?, ?)');
  for (const [retailer, list, filename] of [['Mydin', rows, 'mydin sales report.jpg'], ['Hero Market', hero, 'hero market sales report.jpg']]) {
    const reportId = insertReport.run(retailer, '2026-08-01', '2026-08-17', filename, 'image-review').lastInsertRowid;
    for (const [name, quantity, sales] of list) insertLine.run(reportId, counterId(name, retailer), 'School Shoes', quantity, sales);
  }
}
seed();

app.use(express.json());
// The HTML document must never be cached (it carries the asset version numbers);
// the versioned JS/CSS behind it can cache forever.
app.use((req, res, next) => { if (req.path === '/' || req.path === '/index.html') res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

// '08,09' -> validated ['08','09']; invalid tokens dropped.
const monthList = value => String(value || '').split(',').map(m => m.trim()).filter(m => /^(0?[1-9]|1[0-2])$/.test(m)).map(m => m.padStart(2, '0'));

app.get('/api/dashboard', (req, res) => {
  const retailer = req.query.retailer || '';
  const month = req.query.month || '';
  const category = req.query.category || '';
  const from = req.query.from || '';
  const to = req.query.to || '';
  const monthOfYear = req.query.monthOfYear || '';
  // A report belongs to a range when its period overlaps it (period_start <= to AND period_end >= from).
  // monthOfYear ('08') matches that month in EVERY year, for year-over-year comparison.
  const includeMonths = monthList(req.query.months);
  const excludeMonths = monthList(req.query.exMonths);
  let monthClauses = '';
  const monthParams = [];
  if (includeMonths.length) { monthClauses += ` AND substr(r.period_end, 6, 2) IN (${includeMonths.map(() => '?').join(',')})`; monthParams.push(...includeMonths); }
  if (excludeMonths.length) { monthClauses += ` AND substr(r.period_end, 6, 2) NOT IN (${excludeMonths.map(() => '?').join(',')})`; monthParams.push(...excludeMonths); }
  const where = `WHERE (? = '' OR r.retailer = ?) AND (? = '' OR substr(r.period_end, 1, 7) = ?) AND (? = '' OR s.product_category = ?) AND (? = '' OR (r.period_start <= ? AND r.period_end >= ?)) AND (? = '' OR substr(r.period_end, 6, 2) = ?)${monthClauses}`;
  const params = [retailer, retailer, month, month, category, category, from, to, from, monthOfYear, monthOfYear, ...monthParams];
  const summary = db.prepare(`SELECT COALESCE(SUM(s.sales),0) sales, COALESCE(SUM(s.quantity),0) quantity, COUNT(DISTINCT s.counter_id) counters FROM sales_lines s JOIN reports r ON r.id=s.report_id ${where}`).get(...params);
  const allCounters = db.prepare(`SELECT c.name, r.retailer, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity, ROUND(SUM(s.sales)/NULLIF(SUM(s.quantity),0),2) average_price FROM sales_lines s JOIN counters c ON c.id=s.counter_id JOIN reports r ON r.id=s.report_id ${where} GROUP BY c.id, r.retailer ORDER BY sales DESC`).all(...params);
  const retailers = db.prepare(`SELECT r.retailer, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity FROM sales_lines s JOIN reports r ON r.id=s.report_id ${where} GROUP BY r.retailer ORDER BY sales DESC`).all(...params);
  const periods = db.prepare(`SELECT r.id, r.retailer, r.period_start, r.period_end, r.source_filename, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity FROM reports r JOIN sales_lines s ON s.report_id=r.id ${where} GROUP BY r.id ORDER BY r.period_end DESC`).all(...params);
  const trend = db.prepare(`SELECT substr(r.period_end,1,7) month, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity FROM sales_lines s JOIN reports r ON r.id=s.report_id ${where} GROUP BY month ORDER BY month`).all(...params);
  const options = {
    retailers: db.prepare('SELECT DISTINCT retailer FROM reports ORDER BY retailer').all().map(row => row.retailer),
    months: db.prepare('SELECT DISTINCT substr(period_end,1,7) month FROM reports ORDER BY month DESC').all().map(row => row.month),
    categories: db.prepare(`SELECT DISTINCT product_category category FROM sales_lines WHERE product_category IS NOT NULL AND product_category != '' ORDER BY category`).all().map(row => row.category),
    counters: db.prepare('SELECT name FROM counters ORDER BY name LIMIT 1000').all().map(row => row.name)
  };
  // Category split ignores the category filter on purpose - it IS the category overview for the current retailer/month.
  const categoryTotals = db.prepare(`SELECT s.product_category category, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity
                                    FROM sales_lines s JOIN reports r ON r.id=s.report_id
                                    WHERE (? = '' OR r.retailer = ?) AND (? = '' OR substr(r.period_end, 1, 7) = ?)
                                      AND (? = '' OR (r.period_start <= ? AND r.period_end >= ?)) AND (? = '' OR substr(r.period_end, 6, 2) = ?)${monthClauses}
                                      AND s.product_category IS NOT NULL AND s.product_category != ''
                                    GROUP BY s.product_category ORDER BY sales DESC`).all(retailer, retailer, month, month, from, to, from, monthOfYear, monthOfYear, ...monthParams);
  res.json({ summary, ranking: allCounters.slice(0, 12), allCounters, retailers, periods, trend, options, categoryTotals });
});

app.post('/api/import/manual', (req, res) => {
  const { retailer, periodStart, periodEnd, category = 'Uncategorised', rows } = req.body;
  if (!retailer || !periodStart || !periodEnd || !Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Retailer, dates, and at least one row are required.' });
  const save = db.transaction(() => {
    const reportId = db.prepare('INSERT INTO reports (retailer, period_start, period_end, source_type) VALUES (?, ?, ?, ?)').run(retailer.trim(), periodStart, periodEnd, 'manual').lastInsertRowid;
    const categoryKey = categoryId(category);
    const insert = db.prepare('INSERT INTO sales_lines (report_id,counter_id,category_id,product_category,quantity,sales) VALUES (?, ?, ?, ?, ?, ?)');
    let count = 0;
    for (const row of rows) {
      if (!row.counter || !Number.isFinite(Number(row.quantity)) || !Number.isFinite(Number(row.sales))) continue;
      insert.run(reportId, counterId(row.counter, retailer), categoryKey, category, Number(row.quantity), Number(row.sales)); count++;
    }
    return count;
  });
  const count = save();
  if (!count) return res.status(400).json({ error: 'No valid rows found.' });
  res.json({ imported: count });
});

require('./lib/importjobs')(app, db, { counterId, categoryId });
require('./lib/chat')(app, db);
require('./lib/data')(app, db, { counterId, categoryId });

// Local-only branding: the published repo ships a generic label; BUSINESS_NAME in .env personalizes it.
app.get('/api/config', (req, res) => res.json({ businessName: process.env.BUSINESS_NAME || '' }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Sales Dashboard: http://localhost:${PORT}`));
