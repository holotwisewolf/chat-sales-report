// Chat over the sales database: question -> Gemini -> validated read-only SQL -> rows + explanation.
// Two independent walls: SQL validation here, and a separate readonly SQLite connection for execution.

const path = require('path');
const Database = require('better-sqlite3');
const { Type } = require('@google/genai');
const { generateJson, mockEnabled } = require('./gemini');

const CHAT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sql: { type: Type.STRING },
    explanation: { type: Type.STRING }
  },
  required: ['sql', 'explanation'],
  propertyOrdering: ['sql', 'explanation']
};

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i;
const CANT_PARSE = 'I couldn\'t turn that question into a safe query. Try rephrasing it - for example "total sales by retailer" or "top counters this month".';

function validateSql(sql) {
  const clean = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!clean) return { error: 'empty query' };
  if (clean.includes(';')) return { error: 'only one statement is allowed' };
  if (!/^(select|with)\b/i.test(clean)) return { error: 'only SELECT queries are allowed' };
  if (FORBIDDEN.test(clean)) return { error: 'only SELECT queries are allowed' };
  return { sql: /\blimit\b/i.test(clean) ? clean : `${clean}\nLIMIT 200` };
}

function buildPrompt(db, question) {
  const list = (sql) => db.prepare(sql).all().map(row => Object.values(row)[0]);
  const retailers = list('SELECT DISTINCT retailer FROM reports ORDER BY retailer').join(', ') || 'none yet';
  const categories = list(`SELECT DISTINCT product_category FROM sales_lines WHERE product_category IS NOT NULL ORDER BY product_category`).join(', ') || 'none yet';
  const counters = db.prepare('SELECT COUNT(DISTINCT id) count FROM counters').get().count;
  const range = db.prepare('SELECT MIN(period_end) a, MAX(period_end) b FROM reports').get();
  return `You turn questions about a Malaysian shoe consignment sales database into ONE read-only SQLite query.

Schema:
- counters(id, name, retailer, active, created_at)
- reports(id, retailer, period_start TEXT 'YYYY-MM-DD', period_end TEXT 'YYYY-MM-DD', source_filename, source_type, created_at)
- sales_lines(id, report_id -> reports.id, counter_id -> counters.id, product_name, product_category, category_id -> categories.id, sku, quantity REAL, sales REAL, cost REAL, profit REAL, margin_percent REAL)
- categories(id, name)

Money columns (sales, cost, profit) are Malaysian Ringgit (RM). quantity can be negative (returns/adjustments).
Standard join: sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id.
Month filtering: substr(r.period_end, 1, 7) = 'YYYY-MM'.
Current data: retailers: ${retailers}. Categories: ${categories}. ${counters} counters. Report periods: ${range.a || 'none'} to ${range.b || 'none'}.

Rules: return exactly ONE SELECT statement (WITH...SELECT is fine), no semicolon, always include a LIMIT (<= 200), alias result columns with readable names (e.g. "SUM(s.sales) AS total_sales"), use ROUND(...,2) for money. If the question is ambiguous, choose the most natural interpretation and say so in the explanation.

Question: ${question}`;
}

const MOCK_ANSWERS = [
  { match: /top|best|highest|rank/i, sql: `SELECT c.name AS counter, r.retailer, ROUND(SUM(s.sales),2) AS total_sales, SUM(s.quantity) AS units\nFROM sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id\nGROUP BY c.id ORDER BY total_sales DESC LIMIT 10`, explanation: 'Top counters by total sales (mock answer - no API key set).' },
  { match: /school/i, sql: `SELECT r.retailer, s.product_category, ROUND(SUM(s.sales),2) AS total_sales, SUM(s.quantity) AS units\nFROM sales_lines s JOIN reports r ON r.id = s.report_id\nWHERE s.product_category LIKE '%school%'\nGROUP BY r.retailer, s.product_category ORDER BY total_sales DESC LIMIT 50`, explanation: 'School-shoe sales by retailer (mock answer - no API key set).' },
  { match: /.*/, sql: `SELECT substr(r.period_end,1,7) AS month, ROUND(SUM(s.sales),2) AS total_sales, SUM(s.quantity) AS units\nFROM sales_lines s JOIN reports r ON r.id = s.report_id\nGROUP BY month ORDER BY month LIMIT 24`, explanation: 'Total sales by month (mock answer - no API key set).' }
];

function registerChatRoutes(app, db) {
  const readonly = new Database(path.join(__dirname, '..', 'sales.db'), { readonly: true });

  app.post('/api/chat', async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Type a question first.' });
    try {
      let sql, explanation;
      if (mockEnabled()) {
        if (process.env.GEMINI_MOCK === 'fail') throw Object.assign(new Error('reader offline'), { code: 'read_timeout' });
        const canned = MOCK_ANSWERS.find(answer => answer.match.test(question));
        sql = canned.sql; explanation = canned.explanation;
      } else {
        const { parsed } = await generateJson({ parts: [{ text: buildPrompt(db, question) }], schema: CHAT_SCHEMA, maxOutputTokens: 4096 });
        sql = parsed.sql; explanation = parsed.explanation;
      }
      const check = validateSql(sql);
      if (check.error) return res.status(400).json({ error: CANT_PARSE, detail: check.error, sql });
      let rows;
      try {
        rows = readonly.prepare(check.sql).all();
      } catch (error) {
        return res.status(400).json({ error: CANT_PARSE, detail: error.message, sql: check.sql });
      }
      res.json({
        sql: check.sql, explanation,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows: rows.slice(0, 200), rowCount: rows.length, truncated: rows.length > 200
      });
    } catch (error) {
      if (error.code === 'read_timeout' || error.code === 'provider_error') {
        return res.status(503).json({ error: 'The answer service is temporarily unavailable. Try again later.' });
      }
      res.status(500).json({ error: 'Something went wrong answering that question. Try rephrasing it.' });
    }
  });
}

module.exports = registerChatRoutes;
module.exports.validateSql = validateSql;
