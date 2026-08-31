// Chat over the sales data: Gemini picks a TOOL, the backend runs a safe parameterized query,
// and Gemini only turns the result into plain English. Gemini never sees the whole database and
// never does math - the logic is here, on bound SQLite statements.

const path = require('path');
const Database = require('better-sqlite3');
const { Type } = require('@google/genai');
const { generateRaw, mockEnabled } = require('./gemini');
const { round2 } = require('./reconcile');

const JOIN = 'FROM sales_lines s JOIN counters c ON c.id = s.counter_id JOIN reports r ON r.id = s.report_id';
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// One month parser everywhere: '8', 8, or 'August' -> '08'; anything else -> null.
function resolveMonth(value) {
  const raw = String(value).trim().toLowerCase();
  const byName = MONTH_NAMES.findIndex(name => raw.startsWith(name));
  const n = byName >= 0 ? byName + 1 : parseInt(raw, 10);
  return n >= 1 && n <= 12 ? String(n).padStart(2, '0') : null;
}

// Shared filter builder - every value is a bound parameter, never interpolated.
// Adding a filter here applies it to every tool at once; that is the whole point.
function filterSql(args, params) {
  const where = [];
  if (args.retailer) {
    const list = String(args.retailer).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length > 1) {
      const clauses = list.map((item, idx) => {
        params[`ret_${idx}`] = `%${item}%`;
        return `r.retailer LIKE @ret_${idx}`;
      });
      where.push(`(${clauses.join(' OR ')})`);
    } else {
      where.push('r.retailer LIKE @retailer');
      params.retailer = `%${args.retailer}%`;
    }
  }
  if (args.counter) {
    const list = String(args.counter).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length > 1) {
      const clauses = list.map((item, idx) => {
        params[`cnt_${idx}`] = `%${item}%`;
        return `c.name LIKE @cnt_${idx}`;
      });
      where.push(`(${clauses.join(' OR ')})`);
    } else {
      where.push('c.name LIKE @counter');
      params.counter = `%${args.counter}%`;
    }
  }
  if (args.category) { where.push('s.product_category LIKE @category'); params.category = `%${args.category}%`; }
  if (args.from) { where.push('r.period_end >= @from'); params.from = args.from; }
  if (args.to) { where.push('r.period_start <= @to'); params.to = args.to; }
  if (args.monthOfYear) {
    const tokens = String(args.monthOfYear).split(',').map(resolveMonth).filter(Boolean);
    if (tokens.length > 1) {
      tokens.forEach((m, idx) => params[`m_${idx}`] = m);
      where.push(`substr(r.period_end, 6, 2) IN (${tokens.map((_, idx) => `@m_${idx}`).join(',')})`);
    } else if (tokens.length === 1) {
      where.push('substr(r.period_end, 6, 2) = @monthOfYear'); params.monthOfYear = tokens[0];
    }
  }
  if (args.year) { where.push('substr(r.period_end, 1, 4) = @year'); params.year = args.year; }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

const TOOLS = {
  sales_summary: {
    description: 'Total money earned, total pairs sold, and how many counters sold anything. Computes mathematical sums and totals. Use for questions like "how much did we sell", "total quantity for June and July", "total pairs sold across Mydin Subang and Mydin Klang", "sales for Mydin and Hero Market".',
    args: {
      retailer: 'One or more retailer names, comma-separated if multiple (optional)',
      counter: 'One or more counter names, comma-separated if multiple (optional)',
      category: 'Category like School Shoes (optional)',
      from: 'Start date YYYY-MM-DD (optional)',
      to: 'End date YYYY-MM-DD (optional)',
      monthOfYear: 'Month number 1-12 or month name, comma-separated if multiple months (optional)',
      year: '4-digit year (optional)'
    },
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
    description: 'Money earned grouped by month or by year, shown as a list over time. Use for "sales each month", "monthly totals", "yearly totals". For comparing two periods as a single answer, use compare_periods instead.',
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
    args: { yearA: 'The later year, e.g. 2026 (required)', yearB: 'The earlier year, e.g. 2025 (required)', monthOfYear: 'Month to compare in both years: number 1-12 or a name like August (optional)', retailer: 'Retailer name (optional)', category: 'Category like School Shoes (optional)' },
    required: ['yearA', 'yearB'],
    run(db, args) {
      if (!/^\d{4}$/.test(args.yearA || '') || !/^\d{4}$/.test(args.yearB || '')) return [{ error: 'yearA and yearB must be 4-digit years, e.g. 2026 and 2025' }];
      const mm = args.monthOfYear ? resolveMonth(args.monthOfYear) : '';
      if (args.monthOfYear && !mm) return [{ error: 'monthOfYear must be a month number 1-12 or a month name like August' }];
      // One scan returns both years; shared filters come from filterSql so attribution always
      // matches every other tool (period_end month/year).
      const params = { yearA: args.yearA, yearB: args.yearB };
      const shared = filterSql({ retailer: args.retailer, category: args.category, monthOfYear: mm }, params);
      const rows = db.prepare(`SELECT substr(r.period_end,1,4) yr, ROUND(COALESCE(SUM(s.sales),0),2) sales, COALESCE(SUM(s.quantity),0) units
                               ${JOIN} WHERE substr(r.period_end,1,4) IN (@yearA, @yearB)${shared ? ` AND ${shared.slice(6)}` : ''}
                               GROUP BY yr`).all(params);
      const a = rows.find(row => row.yr === args.yearA) || { sales: 0, units: 0 };
      const b = rows.find(row => row.yr === args.yearB) || { sales: 0, units: 0 };
      const monthName = mm ? MONTH_NAMES[Number(mm) - 1] : '';
      const label = year => monthName ? `${monthName[0].toUpperCase()}${monthName.slice(1)} ${year}` : year;
      const labelA = label(args.yearA), labelB = label(args.yearB);
      const difference = round2(a.sales - b.sales);
      const tie = Math.abs(difference) < 0.005;
      const noData = a.sales === 0 && b.sales === 0;
      return [{
        period_a: labelA, sales_a: a.sales, units_a: a.units,
        period_b: labelB, sales_b: b.sales, units_b: b.units,
        higher: tie ? null : (difference > 0 ? labelA : labelB),
        no_data: noData || null,
        difference_rm: difference,
        // Percent only on a meaningful base (>= RM 1) - never a 30-million-percent explosion.
        percent_change: !tie && b.sales >= 1 ? Math.round(difference / b.sales * 1000) / 10 : null
      }];
    }
  },
  counter_details: {
    description: 'Numbers for ONE counter (store) by name. Use when the user asks about a specific store.',
    args: { name: 'Counter/store name (part of the name is enough)', from: 'Start date YYYY-MM-DD (optional)', to: 'End date YYYY-MM-DD (optional)' },
    required: ['name'],
    run(db, args) {
      const params = { name: `%${args.name || ''}%` };
      if (args.from) params.from = args.from;
      if (args.to) params.to = args.to;
      return db.prepare(`SELECT c.name counter, r.retailer, s.product_category category, r.period_start, r.period_end, ROUND(SUM(s.sales),2) sales, SUM(s.quantity) units
                         ${JOIN} WHERE c.name LIKE @name ${args.from ? 'AND r.period_end >= @from' : ''} ${args.to ? 'AND r.period_start <= @to' : ''}
                         GROUP BY c.id, s.product_category, r.id ORDER BY sales DESC LIMIT 50`).all(params);
    }
  },
  update_record: {
    description: 'Correct ONE number (quantity, sales, cost, or profit) on a recorded row, e.g. "change Mydin Subang sales to 5000". If several rows match you get a list back - show it and ask which one, then narrow with category, month, or year.',
    args: { counter: 'Counter name (required)', field: '"quantity", "sales", "cost", or "profit" (required)', new_value: 'The corrected number (required)', category: 'Category like School Shoes (optional)', month: 'Month number or name (optional)', year: '4-digit year (optional)' },
    required: ['counter', 'field', 'new_value'],
    write: true,
    run(db, args) {
      const fields = ['quantity', 'sales', 'cost', 'profit'];
      const field = String(args.field || '').toLowerCase();
      if (!fields.includes(field)) return [{ error: `field must be one of: ${fields.join(', ')}` }];
      const value = Number(args.new_value);
      if (!Number.isFinite(value)) return [{ error: 'new_value must be a number' }];
      const params = { name: `%${args.counter || ''}%` };
      if (args.category) params.category = `%${args.category}%`;
      if (args.month) { const mm = resolveMonth(args.month); if (mm) params.mm = mm; }
      if (args.year && /^\d{4}$/.test(args.year)) params.yr = args.year;
      const matches = db.prepare(`SELECT s.id, c.name counter, r.period_start, r.period_end, s.product_category category, s.quantity, s.sales, s.cost, s.profit
                                  ${JOIN} WHERE c.name LIKE @name ${args.category && params.category ? 'AND s.product_category LIKE @category' : ''}
                                  ${params.mm ? 'AND substr(r.period_end,6,2) = @mm' : ''} ${params.yr ? 'AND substr(r.period_end,1,4) = @yr' : ''}
                                  LIMIT 20`).all(params);
      if (!matches.length) return [{ error: 'No recorded sales match that counter and those filters.' }];
      if (matches.length > 1) return matches.map(m => ({ counter: m.counter, category: m.category, period: `${m.period_start} to ${m.period_end}`, current: m[field], note: 'several rows match - narrow it down with category, month, or year' }));
      const row = matches[0];
      db.prepare(`UPDATE sales_lines SET ${field} = ? WHERE id = ?`).run(value, row.id); // field is whitelisted above
      return [{ counter: row.counter, category: row.category, period: `${row.period_start} to ${row.period_end}`, field, old_value: row[field], new_value: value, updated: 1 }];
    }
  },
  // ---- Write tools: the only ones allowed to change data. The route passes the read-write db. ----
  add_counter: {
    description: 'Create a new counter (store) so reports can record sales for it. Use when the user asks to add a store/counter.',
    args: { name: 'Full counter name (required)', retailer: 'Retailer chain it belongs to, e.g. Mydin (required)' },
    required: ['name', 'retailer'],
    write: true,
    run(db, args) {
      const existing = db.prepare('SELECT id, name, retailer FROM counters WHERE name = ? COLLATE NOCASE').get(args.name);
      if (existing) return [{ counter: existing.name, retailer: existing.retailer, created: 0, note: 'already exists - nothing was changed' }];
      db.prepare('INSERT INTO counters (name, retailer) VALUES (?, ?)').run(args.name.trim(), args.retailer.trim());
      return [{ counter: args.name.trim(), retailer: args.retailer.trim(), created: 1, note: 'created' }];
    }
  },
  rename_counter: {
    description: 'Rename a counter, or merge two counters into one when the user says they are duplicates. Moves every record to the new name.',
    args: { from: 'Current counter name (required)', to: 'New name (required)' },
    required: ['from', 'to'],
    write: true,
    run(db, args) {
      const matches = db.prepare('SELECT id, name, retailer FROM counters WHERE name LIKE ? ORDER BY name LIMIT 10').all(`%${args.from}%`);
      if (matches.length === 0) return [{ error: `No counter found matching "${args.from}"` }];
      if (matches.length > 1) return [{ error: `That matches ${matches.length} counters - ${matches.map(m => m.name).join(', ')}. Please give the full exact name.` }];
      const source = matches[0];
      const target = db.prepare('SELECT id, name FROM counters WHERE name = ? COLLATE NOCASE').get(args.to);
      if (target && target.id !== source.id) {
        db.prepare('UPDATE sales_lines SET counter_id = ? WHERE counter_id = ?').run(target.id, source.id);
        db.prepare('DELETE FROM counters WHERE id = ?').run(source.id);
        return [{ renamed_from: source.name, renamed_to: target.name, merged: 1, note: 'records moved to the existing counter and the duplicate removed' }];
      }
      db.prepare('UPDATE counters SET name = ? WHERE id = ?').run(args.to.trim(), source.id);
      return [{ renamed_from: source.name, renamed_to: args.to.trim(), merged: 0, note: 'renamed' }];
    }
  },
  delete_counter: {
    description: 'Delete a counter and all its recorded sales. ALWAYS two steps: call WITHOUT confirm first to get the readback, show it, and only call again with confirm "true" after the user clearly agrees.',
    args: { name: 'Full counter name (required)', confirm: 'Send "true" ONLY on the second call, after the user explicitly confirmed the readback' },
    required: ['name'],
    write: true,
    run(db, args) {
      const matches = db.prepare('SELECT id, name, retailer FROM counters WHERE name LIKE ? ORDER BY name LIMIT 10').all(`%${args.name}%`);
      if (matches.length === 0) return [{ error: `No counter found matching "${args.name}"` }];
      if (matches.length > 1) return [{ error: `That matches ${matches.length} counters - ${matches.map(m => m.name).join(', ')}. Please give the full exact name.` }];
      const counter = matches[0];
      const stats = db.prepare(`SELECT COUNT(*) records, ROUND(COALESCE(SUM(s.sales),0),2) total_sales ${JOIN} WHERE c.id = @id`).get({ id: counter.id });
      const readback = { counter: counter.name, retailer: counter.retailer, records: stats.records, total_sales: stats.total_sales, action: args.confirm === 'true' ? 'DELETED' : 'readback' };
      if (args.confirm !== 'true') {
        return [{ ...readback, note: 'NOT deleted yet - read this back, then ask the user to confirm before calling again with confirm "true"' }];
      }
      const pending = pendingDeletes.get(counter.id);
      if (!pending || Date.now() > pending) return [{ error: 'No recent readback for this counter - do the readback step first, then confirm.' }];
      db.transaction(() => {
        const reportIds = db.prepare('SELECT DISTINCT report_id FROM sales_lines WHERE counter_id = ?').all(counter.id).map(r => r.report_id);
        db.prepare('DELETE FROM sales_lines WHERE counter_id = ?').run(counter.id);
        for (const reportId of reportIds) {
          if (!db.prepare('SELECT COUNT(*) count FROM sales_lines WHERE report_id = ?').get(reportId).count) {
            db.prepare('UPDATE import_jobs SET report_id = NULL WHERE report_id = ?').run(reportId);
            db.prepare('DELETE FROM reports WHERE id = ?').run(reportId);
          }
        }
        db.prepare('DELETE FROM counters WHERE id = ?').run(counter.id);
        if (chatOptions.pruneOrphans) chatOptions.pruneOrphans();
      })();
      pendingDeletes.delete(counter.id);
      return [readback];
    }
  }
};

// delete_counter readbacks valid for 10 minutes: a confirmation must follow a fresh readback.
const pendingDeletes = new Map();
const oldDeleteRun = TOOLS.delete_counter.run;
TOOLS.delete_counter.run = (db, args) => {
  if (args.confirm !== 'true') {
    const result = oldDeleteRun(db, { ...args, confirm: 'false' });
    const row = result[0];
    if (row && !row.error) {
      const id = db.prepare('SELECT id FROM counters WHERE name = ? COLLATE NOCASE').get(row.counter)?.id;
      if (id != null) pendingDeletes.set(id, Date.now() + 10 * 60 * 1000);
    }
    return result;
  }
  return oldDeleteRun(db, args);
};

const DECLARATIONS = Object.entries(TOOLS).map(([name, tool]) => ({
  name,
  description: tool.description,
  parameters: {
    type: Type.OBJECT,
    properties: Object.fromEntries(Object.entries(tool.args).map(([arg, description]) => [arg, { type: Type.STRING, description }])),
    required: tool.required || []
  }
}));

const CHAT_PROMPT = `You are the assistant of a sales dashboard used by the owner of a shoe business in Malaysia. They are not technical and English is not their first language.

You will be given a question and a set of tools. Pick ONE tool and fill in its arguments from the question. Do not guess numbers - the tool result will contain every number you need.

When the tool result comes back, answer the question with the result:
- Plain, simple English. Short sentences. No jargon ever (never say median, aggregate, query, SQL, dataset, metric).
- Money is Malaysian Ringgit. Say "RM 12,345" style. Round to whole RM when you speak.
- Warm, direct, professional. Address the user as "you".
- Mention the biggest numbers by name (which store, which month). You may compare numbers you were given (say which store is bigger), but never work out NEW numbers like differences or percentages yourself - for that, use the compare_periods tool.
- compare_periods gives you which period is higher, difference_rm, and percent_change, all worked out. Read them simply: "this year is RM 12,000 higher, about 18% up". If percent_change is null, or "higher" is null, or no_data is true, do NOT invent a percent or a winner - say kindly there is not enough data to compare fairly yet.
- If the user asks you to add up or calculate totals for multiple months, multiple counters, or multiple retailers (e.g. "total pairs for June and July", "sales for Subang and Klang", "total units across Mydin and Hero Market"), use sales_summary with comma-separated values (e.g. monthOfYear: "6,7", counter: "Subang,Klang", retailer: "Mydin,Hero Market"). The database computes the exact math for you.
- If the result is empty, say kindly that there is no data for that yet, and suggest what they could ask instead.
- Some tools CHANGE DATA. Deleting is always two steps: first call delete_counter WITHOUT confirm and read back exactly what would be deleted (counter name, how many records, their total value), then ask the user to confirm. Only after they clearly agree, call delete_counter again with confirm "true". If they hesitate at all, do not delete.
- update_record corrects one number. If it returns several matching rows, show the list and ask which one - do not guess. When it succeeds, state plainly what changed: "Sales for X, August, changed from RM 1,200 to RM 1,500."
- Keep answers under 6 sentences. Never invent numbers that are not in the tool result.`;

// runTool normalizes args once, runs the tool, and partitions error rows out of the data -
// callers never see {error:...} rows mixed into output. Write tools get the read-write db.
function runTool(readonlyDb, rwDb, name, args) {
  const tool = TOOLS[name];
  if (!tool) return { rows: [], rowCount: 0, errors: [`unknown tool ${name}`] };
  const db = tool.write ? rwDb : readonlyDb;
  const clean = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = String(value);
  }
  const rows = [];
  const errors = [];
  for (const row of tool.run(db, clean).slice(0, 200)) row.error ? errors.push(row.error) : rows.push(row);
  return { rows, rowCount: rows.length, errors };
}

// A compare question needs a TIME word too, so "School shoes vs other shoes" stays sales_by_category.
const COMPARE_QUESTION = new RegExp(`^(?=.*(?:compare|versus|\\bvs\\b|higher|lower|better than))(?=.*(?:year|\\b20\\d\\d\\b|month|${MONTH_NAMES.join('|')}))`, 'i');
const MOCK_ROUTES = [
  { match: COMPARE_QUESTION, tool: 'compare_periods', args: { yearA: '2026', yearB: '2025' } },
  { match: /add (a )?counter|create (a )?counter|new counter/i, tool: 'add_counter', args: { name: 'Test Counter From Chat', retailer: 'TestRetail' } },
  { match: /(edit|change|fix|update|correct).*(number|sales|qty|quantity|record)/i, tool: 'update_record', args: { counter: 'Mydin Sejati Ujana Hypermarket', field: 'sales', new_value: '7000' } },
  { match: /confirm delete/i, tool: 'delete_counter', args: { name: 'Test Counter From Chat', confirm: 'true' } },
  { match: /delete (the )?counter|remove (the )?counter/i, tool: 'delete_counter', args: { name: 'Test Counter From Chat' } },
  { match: /rename counter|merge counter/i, tool: 'rename_counter', args: { from: 'Test Counter From Chat', to: 'Renamed Test Counter' } },
  { match: /top|best|worst|highest|rank/i, tool: 'top_counters', args: { limit: '5' } },
  { match: /school|category|other shoes/i, tool: 'sales_by_category', args: {} },
  { match: /month|trend|year/i, tool: 'sales_by_period', args: { granularity: 'month' } },
  { match: /mydin|hero|tf|retailer|store chain/i, tool: 'sales_by_retailer', args: {} },
  { match: /.*/, tool: 'sales_summary', args: {} }
];

let chatOptions = {};

function registerChatRoutes(app, db, options = {}) {
  chatOptions = options;
  const readonly = new Database(path.join(__dirname, '..', 'sales.db'), { readonly: true });

  app.post('/api/chat', async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Type a question first.' });
    try {
      let toolName, args, rows = [], toolError = '', narration;
      if (mockEnabled()) {
        if (process.env.GEMINI_MOCK === 'fail') throw Object.assign(new Error('offline'), { code: 'read_timeout' });
        const route = MOCK_ROUTES.find(r => r.match.test(question));
        toolName = route.tool; args = route.args;
        const result = runTool(readonly, db, toolName, args);
        rows = result.rows; toolError = result.errors[0] || '';
        narration = 'Here is what the data says (mock answer - no API key set).';
      } else {
        // Tool-calling loop: Gemini may ask several tools for one question (e.g. "total AND best
        // store") before writing the answer. The model cannot know "this year" without today's date.
        const contents = [{ role: 'user', parts: [{ text: `${CHAT_PROMPT}\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.\n\nHer question: ${question}` }] }];
        const usedTools = [];
        // If she presses Stop, the browser drops the connection - stop making Gemini calls too.
        // NOTE: 'close' on the REQUEST fires as soon as its body finishes (Node >=16), which would
        // abort every answer - watch the RESPONSE stream and only treat it as gone if we never
        // finished writing.
        let clientGone = false;
        res.on('close', () => { if (!res.writableEnded) clientGone = true; });
        for (let step = 0; step < 4; step++) {
          const response = await generateRaw({ contents, config: { tools: [{ functionDeclarations: DECLARATIONS }] } });
          if (clientGone) return;
          const calls = response.functionCalls || [];
          if (!calls.length) { narration = response.text; break; }
          const batch = calls.slice(0, 2);
          const responseParts = batch.map(call => {
            const result = runTool(readonly, db, call.name, call.args);
            usedTools.push(call.name);
            toolError ||= result.errors[0] || '';
            if (result.rows.length) { rows = result.rows; args = call.args || {}; }
            return { functionResponse: { name: call.name, response: result } };
          });
          contents.push({ role: 'model', parts: batch.map(call => ({ functionCall: { name: call.name, args: call.args || {} } })) });
          contents.push({ role: 'user', parts: responseParts });
        }
        if (!narration) narration = toolError ? `I could not work that out - ${toolError}` : 'Here is what the data says.';
        toolName = usedTools.join(', ') || 'none';
      }
      res.json({
        answer: narration, tool: toolName, args,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows, rowCount: rows.length
      });
    } catch (error) {
      if (error.code === 'quota') {
        return res.status(429).json({ error: error.message });
      }
      if (error.code === 'invalid_key' || error.code === 'network_error') {
        return res.status(400).json({ error: error.message });
      }
      if (error.code === 'read_timeout' || error.code === 'provider_error') {
        return res.status(503).json({ error: 'The answer service is temporarily unavailable. Try again later.' });
      }
      console.error('chat error', error);
      res.status(500).json({ error: 'Something went wrong answering that question. Try asking it a different way.' });
    }
  });
}

module.exports = registerChatRoutes;
