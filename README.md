# Sales Dashboard

Single-user local sales dashboard for consignment counter performance and report entry. Drop photos or PDFs of retailer sales reports, let the AI reader transcribe them, check the numbers side by side with the original, and only then import.

## Run it

Requires Node.js 20+ (built on 24).

```powershell
npm install
npm start
```

Open http://localhost:3000 in a browser. Use `PORT=3001` style env vars if 3000 is taken.

## AI report reader (optional)

The upload flow can send your report photos/PDFs to Google Gemini for transcription.

1. Create a free API key at https://aistudio.google.com (Get API key - no credit card needed; the free tier is far more than a monthly report needs).
2. Put it in `.env` (this file is gitignored):

```
GEMINI_API_KEY=your-key-here
BUSINESS_NAME=Whatever You Want The Header To Say
```

Without a key the app runs in **mock mode** with sample data, so the whole upload-review-confirm flow can be tried without an account. `BUSINESS_NAME` is a local-only label for the header; the repo itself stays generic.

## How an import works

1. **Upload** — photos (JPG/PNG, up to 10 MB each) or PDFs (up to 8 pages). Multi-page PDFs are split and read page by page. One upload = one retailer + one period + one category, so upload the School Shoes pages and Other Shoes pages as two separate uploads.
2. **Read** — the reader proposes rows; it never writes anything. Files, raw provider responses, and warnings are kept as an audit trail.
3. **Review** — an editable grid beside the original file. Uncertain values arrive flagged "Needs review"; duplicate counter lines and negative quantities are flagged too.
4. **Reconcile** — extracted sums are compared with the printed grand totals (per file). If they disagree, confirmation is blocked until the numbers are fixed or the mismatch is explicitly overridden.
5. **Confirm** — the only step that writes to the database. Drafts survive restarts and can be resumed.

Errors are always specific: an unopenable file, an unavailable reader, a file with no sales table, ambiguous rows, or disagreeing totals each get their own message and a retry or edit path - never a generic "import failed".

## Data model

- Local SQLite (`sales.db`); no cloud account required.
- Dynamic retailers, counter names, and categories: anything new typed in a reviewed report is created automatically.
- School Shoes and Other Shoes are separate category rows for the same counter and period, so school-shoe performance filters cleanly and "all categories" sums to total shoes.
- Same counter + same dates with different categories is normal, not a duplicate. Re-uploading an already-imported file is detected and warned about, but never silently merged.

## Development notes

- `GEMINI_MOCK=1|empty|fail` forces mock scenarios (sample table / no table found / reader unavailable) for testing without quota.
- Originals live in `uploads/` (gitignored) and import audit data in the `import_jobs` / `import_files` tables.
