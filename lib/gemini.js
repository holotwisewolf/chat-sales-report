// Gemini report reader: prompt + strict response schema, retry/timeout handling, and a quota-free mock mode.
// Mock activates when GEMINI_API_KEY is absent or GEMINI_MOCK is set (1|empty|fail); output shape is identical either way.

const fs = require('fs');
const path = require('path');
const { GoogleGenAI, Type } = require('@google/genai');

const MODEL = 'gemini-2.5-flash';
const UNAVAILABLE = 'The report reader is temporarily unavailable. Your file was not imported; try again later.';

const PROMPT = `You read photos and PDFs of Malaysian retail consignment sales reports for a shoe consignment business. Extract every row exactly as printed.

Documents come in two shapes:
1. Counter tables (usually photos): columns like Counter | Qty | Sales. Emit one row per counter; "counter" is the printed counter name. Leave sku/product/cost/profit empty.
2. SKU-level consignment reports (usually PDFs, one outlet per page): "counter" is the outlet name printed on that page's header (e.g. an outlet code and town). Fill sku, product_name, unit_price, cost, profit, margin_percent where printed.

Rules:
- Exclude total, subtotal, grand-total, and "Jumlah" lines from rows. Instead put the grand total printed on THIS file/page into printed_totals (null if none is printed).
- Numbers are plain numbers: no "RM", no thousands separators, no currency symbols. Quantities are integers unless visibly not; keep negative signs exactly as printed (returns). Money to 2 decimal places.
- Never guess digits. If a value is blurred, cut off, or ambiguous, still emit your best guess BUT set low_confidence true and describe the doubt in note (e.g. "qty could be 7 or 1"). Never leave out a row because it is hard to read.
- Dates: Malaysian convention is DD/MM/YYYY. Put the report's period into period_guess_start / period_guess_end as YYYY-MM-DD. "1/8/2026 - 17/8/2026" means 2026-08-01 and 2026-08-17. Month-only means first and last day of that month. Unknown -> empty string.
- retailer_guess comes only from letterhead/branding visible in the document (e.g. the retailer chain name); empty string if not visible.
- category_guess: if the document's title or header names what is being reported (e.g. "School Shoes", "Other Shoes", "Men's Shoes"), copy it verbatim. Otherwise use a short plain label like "Shoes". Empty string only if the document gives no clue at all.
- If the file has no sales table at all, return document_type "unknown" with an empty rows array.
- Transcribe counter and product names as printed, even if truncated or misspelled. Do not expand abbreviations.`;

const rowSchema = {
  type: Type.OBJECT,
  properties: {
    counter: { type: Type.STRING },
    sku: { type: Type.STRING, nullable: true },
    product_name: { type: Type.STRING, nullable: true },
    quantity: { type: Type.NUMBER },
    unit_price: { type: Type.NUMBER, nullable: true },
    sales: { type: Type.NUMBER },
    cost: { type: Type.NUMBER, nullable: true },
    profit: { type: Type.NUMBER, nullable: true },
    margin_percent: { type: Type.NUMBER, nullable: true },
    low_confidence: { type: Type.BOOLEAN },
    note: { type: Type.STRING, nullable: true }
  },
  required: ['counter', 'quantity', 'sales', 'low_confidence'],
  propertyOrdering: ['counter', 'sku', 'product_name', 'quantity', 'unit_price', 'sales', 'cost', 'profit', 'margin_percent', 'low_confidence', 'note']
};

const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    document_type: { type: Type.STRING, enum: ['counter_table', 'sku_by_outlet', 'unknown'] },
    retailer_guess: { type: Type.STRING },
    category_guess: { type: Type.STRING },
    period_guess_start: { type: Type.STRING },
    period_guess_end: { type: Type.STRING },
    printed_totals: {
      type: Type.OBJECT, nullable: true,
      properties: { quantity: { type: Type.NUMBER, nullable: true }, sales: { type: Type.NUMBER, nullable: true } },
      required: ['quantity', 'sales'], propertyOrdering: ['quantity', 'sales']
    },
    rows: { type: Type.ARRAY, items: rowSchema },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['document_type', 'rows', 'warnings'],
  propertyOrdering: ['document_type', 'retailer_guess', 'category_guess', 'period_guess_start', 'period_guess_end', 'printed_totals', 'rows', 'warnings']
};

const fail = (code, message) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mockEnabled = () => process.env.GEMINI_MOCK === '1' || process.env.GEMINI_MOCK === 'empty' || process.env.GEMINI_MOCK === 'fail' || !process.env.GEMINI_API_KEY;

// Shared real-API path for any JSON-constrained Gemini call (report reading, chat SQL, future uses).
async function generateJson({ parts, schema, maxOutputTokens = 32768 }) {
  const response = await generateRaw({
    parts,
    config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, maxOutputTokens, thinkingConfig: { thinkingBudget: 4096 } }
  });
  return { parsed: JSON.parse(response.text), raw: { model: MODEL, finishReason: response.finishReason ?? null, usage: response.usageMetadata ?? null, text: response.text } };
}

// Raw generateContent with one retry - used directly for function calling, which needs freeform output.
async function generateRaw({ parts, config = {}, contents = null }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const call = thinkingBudget => ai.models.generateContent({
    model: MODEL,
    contents: contents || [{ role: 'user', parts }],
    config: { temperature: 0, maxOutputTokens: 8192, ...config, thinkingConfig: { thinkingBudget, ...(config.thinkingConfig || {}) }, httpOptions: { timeout: 90_000 } }
  });
  try {
    return await call(2048);
  } catch (first) {
    try { return await (await sleep(2000), call(2048)); }
    catch {
      const timedOut = /timeout|aborted|etimedout/i.test(String(first?.message ?? '') + String(first?.cause?.message ?? ''));
      throw fail(timedOut ? 'read_timeout' : 'provider_error', UNAVAILABLE);
    }
  }
}

async function mockRead({ mime, filename }) {
  await sleep(1200);
  const mode = process.env.GEMINI_MOCK;
  if (mode === 'fail') throw fail('read_timeout', UNAVAILABLE);
  const name = mode === 'empty' ? 'empty.json'
    : /mismatch/i.test(filename || '') ? 'counter-photo-mismatch.json'
    : mime === 'application/pdf' ? (/\(page (?!1 of)/.test(filename || '') ? 'empty.json' : 'tf-mart-pdf.json')
    : 'counter-photo.json';
  const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gemini', name), 'utf8'));
  return { parsed, raw: { model: 'mock', finishReason: 'STOP', usage: null, fixture: name, text: JSON.stringify(parsed) } };
}

// Reads one report file. `note` is free context from the uploader (e.g. the year, when the photo
// doesn't show it) and is trusted over the document's own claims. Retry lives inside generateJson.
async function readReport({ buffer, mime, filename, note }) {
  if (mockEnabled()) return mockRead({ mime, filename });
  return generateJson({
    parts: [
      { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
      { text: PROMPT + (note ? `\n\nAdditional context from the person who uploaded this file (trust this over what the document itself shows): ${note}` : '') }
    ],
    schema: REPORT_SCHEMA,
    maxOutputTokens: 32768
  });
}

module.exports = { readReport, generateJson, generateRaw, mockEnabled, REPORT_SCHEMA, UNAVAILABLE };
