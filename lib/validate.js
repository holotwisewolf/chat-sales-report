// File validation for report uploads: magic-byte type sniffing, size and PDF page limits.
// Pure/synchronous except PDF load; every rejection carries the exact UI message for its cause.

const { PDFDocument } = require('pdf-lib');

const LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 8, maxFiles: 12 };
const MSG = {
  unsupported: 'We couldn\'t open this file. Please upload a PDF, JPG, or PNG.',
  corrupt: 'We couldn\'t open this file. Please upload a PDF, JPG, or PNG.',
  tooLarge: 'This file is bigger than the 10 MB limit. Please upload a smaller photo or PDF.',
  tooManyPages: n => `This PDF has ${n} pages; the reader handles up to ${LIMITS.maxPages}.`
};

function sniff(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  // PDFs may carry leading junk; the spec allows the header within the first 1024 bytes.
  if (buffer.subarray(0, 1024).indexOf('%PDF-') !== -1) return 'application/pdf';
  return null;
}

async function validateFile(file) {
  const type = sniff(file.buffer);
  if (!type) return { ok: false, code: 'unsupported_file_type', message: `${file.originalname}: ${MSG.unsupported}` };
  if (file.size > LIMITS.maxBytes) return { ok: false, code: 'file_too_large', message: `${file.originalname}: ${MSG.tooLarge}` };
  let pageCount = null;
  if (type === 'application/pdf') {
    try {
      pageCount = (await PDFDocument.load(file.buffer, { ignoreEncryption: false })).getPageCount();
    } catch {
      return { ok: false, code: 'corrupt_file', message: `${file.originalname}: ${MSG.corrupt}` };
    }
    if (pageCount > LIMITS.maxPages) return { ok: false, code: 'too_many_pages', message: `${file.originalname}: ${MSG.tooManyPages(pageCount)}` };
  }
  return { ok: true, mime: type, pageCount };
}

// Atomic batch check: one bad file rejects the whole upload so nothing is half-staged.
async function validateBatch(files) {
  if (!files.length) return { ok: false, code: 'no_files', message: 'Choose at least one file to upload.' };
  if (files.length > LIMITS.maxFiles) return { ok: false, code: 'too_many_files', message: `Upload up to ${LIMITS.maxFiles} files at a time.` };
  const results = [];
  for (const file of files) {
    const result = await validateFile(file);
    if (!result.ok) return { ok: false, code: result.code, message: result.message, fileErrors: [{ filename: file.originalname, code: result.code, error: result.message }] };
    results.push(result);
  }
  return { ok: true, results };
}

module.exports = { validateFile, validateBatch, LIMITS, sniff };
