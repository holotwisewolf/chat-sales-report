// Chat over the sales data: Gemini picks a TOOL, the backend runs a safe parameterized query,
// and Gemini only turns the result into plain English. Gemini never sees the whole database and
// never does math - the logic is here, on bound SQLite statements.

const path = require('path');
const Database = require('better-sqlite3');
const { Type } = require('@google/genai');
const { generateRaw, mockEnabled } = require('./gemini');

const JOIN = 'FROM sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id';

// Shared filter builder - every value is a bound parameter, never interpolated.
function filterSql(args, params) {
  const where = [];
  if (args.retailer) { where.push('r.retailer LIKE @retailer'); params.retailer = `%${args.retailer}%`; }
  if (args.category) { where.push('s.product_category LIKE @category'); params.category = `%${args.category}%`; }
  if (args.from) { where.push('r.period_end >= @from'); params.from = args.from; }
  if (args.to) { where.push('r.period_start <= @to'); params.to = args.to; }
  if (args.monthOfYear) { params.monthOfYear = String(args.monthOfYear).padStart(2, '0'); where.push('substr(r.period_end, 6, 2) = @monthOfYear'); }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

const TOOLS = {
  sales_summary: {
    description: 'Total money earned, total pairs sold, and how many counters sold anything. Use for questions like "how much did we sell", "total for Mydin", "August sales".',
    args: { retailer: 'Retailer name (optional)', category: 'Category like School Shoes (optional)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)', monthOfYear: 'Month number 1-12, any year (optional)' },
    run(db, args) {
      const params = {};
      return db.prepare(`SELECT ROUND(COALESCE(SUM(s.sales),0),2) total_sales, COALESCE(SUM(s.quantity),0) total_units, COUNT(DISTINCT s.counter_id) counters ${JOIN} ${filterSql(args, params)}`).all(params);
    }
  },
  top_counters: {
    description: 'Best or worst counters ranked by money earned. Use for "top counters", "which store sold the most", "best in Mydin", "worst performers".',
    args: { retailer: 'Retailer name (optional)', category: 'Category (optional)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)', monthOfYear: 'Month 1-12 any year (optional)', direction: '"best" (default) or "worst"', limit: 'How many to show, default 10, max 50' },
    run(db, args) {
      const params = { limit: Math.min(50, Math.max(1, Number(args.limit) || 10)) };
      const order = args.direction === 'worst' ? 'ASC' : 'DESC';
      return db.prepare(`SELECT c.name counter, r.retailer, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units ${JOIN} ${filterSql(args, params)}
                         GROUP BY c.id ORDER BY sales ${order} LIMIT @limit`).all(params);
    }
  },
  sales_by_period: {
    description: 'Money earned grouped by month or by year. Use for "sales each month", "trend", "compare this year and last year", "monthly totals".',
    args: { retailer: 'Retailer name (optional)', category: 'Category (optional)', granularity: '"month" (default) or "year"' },
    run(db, args) {
      const params = {};
      const unit = args.granularity === 'year' ? 'substr(r.period_end,1,4)' : 'substr(r.period_end,1,7)';
      return db.prepare(`SELECT ${unit} period, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units ${JOIN} ${filterSql(args, params)}
                         GROUP BY period ORDER BY period`).all(params);
    }
  },
  sales_by_retailer: {
    description: 'Money earned by each retail chain (Mydin, Hero Market, ...). Use for "sales by retailer" or comparing chains.',
    args: { category: 'Category (optional)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)', monthOfYear: 'Month 1-12 any year (optional)' },
    run(db, args) {
      const params = {};
      return db.prepare(`SELECT r.retailer, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units ${JOIN} ${filterSql(args, params)}
                         GROUP BY r.retailer ORDER BY sales DESC`).all(params);
    }
  },
  sales_by_category: {
    description: 'Money earned by product category (School Shoes, Other Shoes, ...). Use for "school shoes vs other shoes".',
    args: { retailer: 'Retailer name (optional)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)', monthOfYear: 'Month 1-12 any year (optional)' },
    run(db, args) {
      const params = {};
      return db.prepare(`SELECT s.product_category category, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units ${JOIN} ${filterSql(args, params)}
                         GROUP BY s.product_category ORDER BY sales DESC`).all(params);
    }
  },
  compare_periods: {
    description: 'Compare two years (or the same month of two years) and get which is bigger, by how much, and the percent change - all computed for you. Use for "is this year better than last year", "compare this August and last August".',
    args: { yearA: 'The later year, e.g. 2026 (required)', yearB: 'The earlier year, e.g. 2025 (required)', monthOfYear: 'Month number 1-12 to compare just that month of both years (optional)', retailer: 'Retailer name (optional)', category: 'Category like School Shoes (optional)' },
    run(db, args) {
      const yearA = String(args.yearA || '').trim(), yearB = String(args.yearB || '').trim();
      if (!/^\d{4}$/.test(yearA) || !/^\d{4}$/.test(yearB)) return [{ error: 'yearA and yearB must be 4-digit years, e.g. 2026 and 2025' }];
      const mm = args.monthOfYear ? String(args.monthOfYear).padStart(2, '0') : '';
      const label = year => mm ? `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm)] || mm} ${year}` : year;
      const sumFor = year => {
        const params = { from: mm ? `${year}-${mm}-01` : `${year}-01-01`, to: mm ? `${year}-${mm}-31` : `${year}-12-31` };
        const where = ['r.period_start <= @to', 'r.period_end >= @from'];
        if (args.retailer) { where.push('r.retailer LIKE @retailer'); params.retailer = `%${args.retailer}%`; }
        if (args.category) { where.push('s.product_category LIKE @category'); params.category = `%${args.category}%`; }
        return db.prepare(`SELECT ROUND(COALESCE(SUM(s.sales),0),2) sales, COALESCE(SUM(s.quantity),0) units ${JOIN} WHERE ${where.join(' AND ')}`).get(params);
      };
      const a = sumFor(yearA), b = sumFor(yearB);
      const difference = Math.round((a.sales - b.sales) * 100) / 100;
      const percentChange = b.sales > 0 ? Math.round(difference / b.sales * 1000) / 10 : null;
      return [{ period_a: label(yearA), sales_a: a.sales, units_a: a.units, period_b: label(yearB), sales_b: b.sales, units_b: b.units, higher: difference >= 0 ? label(yearA) : label(yearB), difference_rm: difference, percent_change: percentChange }];
    }
  },
  counter_details: {
    description: 'Numbers for ONE counter (store) by name. Use when she asks about a specific store.',
    args: { name: 'Counter/store name (part of the name is enough)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)' },
    run(db, args) {
      const params = { name: `%${args.name || ''}%` };
      if (args.from) params.from = args.from;
      if (args.to) params.to = args.to;
      return db.prepare(`SELECT c.name counter, r.retailer, s.product_category category, r.period_start, r.period_end, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units
                         ${JOIN} WHERE c.name LIKE @name ${args.from ? 'AND r.period_end >= @from' : ''} ${args.to ? 'AND r.period_start <= @to' : ''}
                         GROUP BY c.id, s.product_category, r.id ORDER BY sales DESC LIMIT 50`).all(params);
    }
  }
};

const DECLARATIONS = Object.entries(TOOLS).map(([name, tool]) => ({
  name,
  description: tool.description,
  parameters: {
    type: Type.OBJECT,
    properties: Object.fromEntries(Object.entries(tool.args).map(([arg, description]) => [arg, { type: Type.STRING, description }])),
    required: name === 'counter_details' ? ['name'] : []
  }
}));

const CHAT_PROMPT = `You are the friendly voice of a sales dashboard used by a Malaysian auntie who sells shoes in retail stores. She is NOT technical and English is not her first language.

You will be given a question and a set of tools. Pick ONE tool and fill in its arguments from the question. Do not guess numbers - the tool result will contain every number you need.

When the tool result comes back, answer her question with the result:
- Plain, simple English. Short sentences. No jargon ever (never say median, aggregate, query, SQL, dataset, metric).
- Money is Malaysian Ringgit. Say "RM 12,345" style. Round to whole RM when you speak.
- Talk like a helpful niece explaining to an auntie: warm, direct, concrete.
- Mention the biggest numbers by name (which store, which month). If she asked to compare, say plainly which one is bigger and by roughly how much.
- To compare two times, use the compare_periods tool - it already worked out which is bigger, by how much (difference_rm), and the percent change. Read those out simply: "this year is RM 12,000 higher, about 18% up". Never calculate differences yourself; only read numbers the tools gave you.
- If the result is empty, say kindly that there is no data for that yet, and suggest what she could ask instead.
- Keep it under 6 sentences. Never invent numbers that are not in the tool result.`;

function runTool(db, name, args) {
  const tool = TOOLS[name];
  if (!tool) return { error: `unknown tool ${name}` };
  const clean = {};
  for (const [key, value] of Object.entries(args || {})) if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  const rows = tool.run(db, clean);
  return { rows: rows.slice(0, 200), rowCount: rows.length };
}

const MOCK_ROUTES = [
  { match: /compare|versus|\bvs\b|last year|previous year|this year.*last|higher|lower|better than/i, tool: 'compare_periods', args: { yearA: '2026', yearB: '2025' } },
  { match: /top|best|worst|highest|rank/i, tool: 'top_counters', args: { limit: '5' } },
  { match: /school|category|other shoes/i, tool: 'sales_by_category', args: {} },
  { match: /month|trend|year|compare/i, tool: 'sales_by_period', args: { granularity: 'month' } },
  { match: /mydin|hero|tf|retailer|store chain/i, tool: 'sales_by_retailer', args: {} },
  { match: /.*/, tool: 'sales_summary', args: {} }
];

function registerChatRoutes(app, db) {
  const readonly = new Database(path.join(__dirname, '..', 'sales.db'), { readonly: true });

  app.post('/api/chat', async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Type a question first.' });
    try {
      let toolName, args, rows;
      if (mockEnabled()) {
        if (process.env.GEMINI_MOCK === 'fail') throw Object.assign(new Error('offline'), { code: 'read_timeout' });
        const route = MOCK_ROUTES.find(r => r.match.test(question));
        toolName = route.tool; args = route.args;
        const result = runTool(readonly, toolName, args);
        rows = result.rows;
        var narration = `Here is what the data says (mock answer - no API key set).`;
      } else {
        // Tool-calling loop: Gemini may ask several tools for one question (e.g. "total AND best
        // store") before writing the answer. The backend runs every tool; Gemini only narrates.
        const contents = [{ role: 'user', parts: [{ text: `${CHAT_PROMPT}\n\nHer question: ${question}` }] }];
        const usedTools = [];
        for (let step = 0; step < 4; step++) {
          const response = await generateRaw({ contents, config: { tools: [{ functionDeclarations: DECLARATIONS }] } });
          const calls = response.functionCalls || [];
          if (!calls.length) { narration = response.text; break; }
          const responseParts = [];
          for (const call of calls.slice(0, 2)) {
            const result = runTool(readonly, call.name, call.args);
            usedTools.push(call.name);
            if (result.rows.length) { rows = result.rows; args = call.args || {}; }
            responseParts.push({ functionResponse: { name: call.name, response: result } });
          }
          contents.push({ role: 'model', parts: calls.slice(0, 2).map(call => ({ functionCall: { name: call.name, args: call.args || {} } })) });
          contents.push({ role: 'user', parts: responseParts });
        }
        if (!narration) narration = 'Here is what the data says.';
        toolName = usedTools.join(', ') || 'none';
      }
      res.json({
        answer: narration, tool: toolName, args,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows, rowCount: rows.length
      });
    } catch (error) {
      if (error.code === 'read_timeout' || error.code === 'provider_error') {
        return res.status(503).json({ error: 'The answer service is temporarily unavailable. Try again later.' });
      }
      console.error('chat error', error);
      res.status(500).json({ error: 'Something went wrong answering that question. Try asking it a different way.' });
    }
  });
}

module.exports = registerChatRoutes;
