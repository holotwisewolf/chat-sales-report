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

function pruneOrphans() {
  db.prepare('DELETE FROM counters WHERE id NOT IN (SELECT DISTINCT counter_id FROM sales_lines)').run();
  db.prepare('DELETE FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM sales_lines WHERE category_id IS NOT NULL)').run();
}
pruneOrphans();

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

app.use(express.json());
// Prevent stale caching:
// - HTML document and API routes must never be cached so dynamic data and updates appear immediately.
// - Static assets (JS/CSS) have ?v= query strings and can cache.
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
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
  const periods = db.prepare(`SELECT r.id, r.retailer, r.period_start, r.period_end, r.source_filename, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity,
                                     j.id jobId, j.status jobStatus FROM reports r JOIN sales_lines s ON s.report_id=r.id
                                     LEFT JOIN import_jobs j ON j.report_id = r.id AND j.status = 'confirmed' ${where} GROUP BY r.id ORDER BY r.period_end DESC`).all(...params);
  const trend = db.prepare(`SELECT substr(r.period_end,1,7) month, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity FROM sales_lines s JOIN reports r ON r.id=s.report_id ${where} GROUP BY month ORDER BY month`).all(...params);
  const options = {
    retailers: db.prepare('SELECT DISTINCT retailer FROM reports ORDER BY retailer').all().map(row => row.retailer),
    months: db.prepare('SELECT DISTINCT substr(period_end,1,7) month FROM reports ORDER BY month DESC').all().map(row => row.month),
    categories: db.prepare(`SELECT DISTINCT product_category category FROM sales_lines WHERE product_category IS NOT NULL AND product_category != '' ORDER BY category`).all().map(row => row.category),
    counters: db.prepare(`SELECT DISTINCT c.name FROM counters c JOIN sales_lines s ON s.counter_id = c.id ORDER BY c.name`).all().map(row => row.name)
  };
  // Category split ignores the category filter on purpose - it IS the category overview for the current retailer/month.
  const categoryTotals = db.prepare(`SELECT s.product_category category, ROUND(SUM(s.sales),2) sales, ROUND(SUM(s.quantity),0) quantity
                                    FROM sales_lines s JOIN reports r ON r.id=s.report_id
                                    WHERE (? = '' OR r.retailer = ?) AND (? = '' OR substr(r.period_end, 1, 7) = ?)
                                      AND (? = '' OR (r.period_start <= ? AND r.period_end >= ?)) AND (? = '' OR substr(r.period_end, 6, 2) = ?)${monthClauses}
                                      AND s.product_category IS NOT NULL AND s.product_category != ''
                                    GROUP BY s.product_category ORDER BY sales DESC`).all(retailer, retailer, month, month, from, to, from, monthOfYear, monthOfYear, ...monthParams);
  res.json({ summary, ranking: allCounters.slice(0, 10), allCounters, retailers, periods, trend, options, categoryTotals });
});

// AI Insights In-Memory Cache & Rate Limiting Guardrails
let cachedInsights = null;
let lastInsightFetchTime = 0;
let lastInsightDataSignature = '';
const INSIGHT_CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache TTL
const MIN_INSIGHT_API_INTERVAL = 15 * 60 * 1000; // 15 Min minimum interval between live Gemini calls

app.get('/api/ai-insights', async (req, res) => {
  try {
    const summary = db.prepare(`SELECT ROUND(SUM(sales),2) sales, SUM(quantity) quantity, COUNT(DISTINCT counter_id) counters, COUNT(*) total_rows FROM sales_lines`).get() || {};
    const topCounter = db.prepare(`SELECT c.name, SUM(s.sales) sales, SUM(s.quantity) qty FROM sales_lines s JOIN counters c ON c.id=s.counter_id GROUP BY c.name ORDER BY sales DESC LIMIT 1`).get();
    const topCat = db.prepare(`SELECT product_category, SUM(sales) sales FROM sales_lines WHERE product_category IS NOT NULL AND product_category != '' GROUP BY product_category ORDER BY sales DESC LIMIT 1`).get();
    const retailerCount = db.prepare(`SELECT COUNT(DISTINCT retailer) count FROM reports`).get()?.count || 0;
    const lastReport = db.prepare(`SELECT MAX(imported_at) latest FROM reports`).get()?.latest || '';

    // Data fingerprint
    const currentSignature = `${summary.sales}_${summary.quantity}_${summary.total_rows}_${lastReport}`;
    const now = Date.now();

    // Guardrail 1: Check cache validity (Signature match + TTL)
    if (cachedInsights && lastInsightDataSignature === currentSignature && (now - lastInsightFetchTime < INSIGHT_CACHE_TTL)) {
      return res.json({ insights: cachedInsights, cached: true });
    }

    let aiInsights = [];
    const apiKey = process.env.GEMINI_API_KEY;
    
    // Guardrail 2: Rate limit live API calls (at most once every 15 minutes)
    const canCallLiveAi = apiKey && !apiKey.includes('YOUR_API_KEY') && (now - lastInsightFetchTime >= MIN_INSIGHT_API_INTERVAL);

    if (canCallLiveAi) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Analyze these sales figures for a shoe consignment business:
Total Sales: RM ${summary.sales || 0}, Units Sold: ${summary.quantity || 0}, Active Outlets: ${summary.counters || 0}, Retailer Chains: ${retailerCount}.
Top Performing Counter: ${topCounter ? topCounter.name : 'N/A'} (RM ${topCounter ? topCounter.sales : 0}, ${topCounter ? topCounter.qty : 0} units).
Top Category: ${topCat ? topCat.product_category : 'N/A'} (RM ${topCat ? topCat.sales : 0}).

Write 2 concise executive observations highlighting key data insights or growth opportunities (max 25 words each, no emojis). Return valid JSON array: [{"title": "...", "text": "..."}].`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });
        const parsed = JSON.parse(response.text);
        if (Array.isArray(parsed) && parsed.length) {
          aiInsights = parsed.map(item => ({
            type: 'high',
            isAi: true,
            title: String(item.title || 'AI Insight').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|✨|🔮/g, '').trim(),
            text: item.text
          }));
          lastInsightFetchTime = now;
        }
      } catch (e) {
        console.warn('Gemini AI insight generation fallback (rate limit / quota safe):', e.message);
      }
    }

    // Guardrail 3: High-accuracy zero-token local statistical rule engine if API is unavailable or rate-limited
    if (!aiInsights.length && topCounter) {
      const pct = summary.sales ? ((topCounter.sales / summary.sales) * 100).toFixed(1) : 0;
      aiInsights.push({
        type: 'high',
        isAi: true,
        title: 'Top Channel Concentration',
        text: `${topCounter.name} is your leading outlet, driving ${pct}% of total revenue (RM ${Number(topCounter.sales).toLocaleString()}).`
      });
      if (topCat) {
        const catPct = summary.sales ? ((topCat.sales / summary.sales) * 100).toFixed(1) : 0;
        aiInsights.push({
          type: 'high',
          isAi: true,
          title: 'Category Demand',
          text: `${topCat.product_category} represents ${catPct}% of overall volume. Consider expanding stock in mid-tier outlets.`
        });
      }
    }

    // Save to in-memory cache
    cachedInsights = aiInsights;
    lastInsightDataSignature = currentSignature;
    if (!lastInsightFetchTime) lastInsightFetchTime = now;

    res.json({ insights: aiInsights });
  } catch (err) {
    res.json({ insights: [] });
  }
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

require('./lib/importjobs')(app, db, { counterId, categoryId, pruneOrphans });
require('./lib/chat')(app, db, { pruneOrphans });
require('./lib/data')(app, db, { counterId, categoryId, pruneOrphans });
require('./lib/forecast')(app, db);

// Local-only branding: the published repo ships a generic label; BUSINESS_NAME in .env personalizes it.
app.get('/api/config', (req, res) => res.json({ businessName: process.env.BUSINESS_NAME || '' }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Sales Dashboard: http://localhost:${PORT}`));
