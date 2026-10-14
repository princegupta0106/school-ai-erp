// Files the user attaches in the assistant chat (like ChatGPT): we read the TEXT out of PDFs, Word
// files and text files on the server and keep that text as context (cheap: text only).
// Photos and scanned PDFs (no text inside) are sent to Gemini as-is, for the next message only.
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { httpError } from '../db.js';

export const MAX_DOC_CHARS = 12000;   // per document kept as context (~3k tokens)
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

const clean = (t) => String(t || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export async function readUpload(file) {
  const name = file.originalname || 'file';
  const mime = file.mimetype || '';
  if (/^image\/(png|jpe?g|webp)$/.test(mime)) {
    if (file.size > MAX_INLINE_BYTES) throw httpError(400, 'Photo is too big (4 MB max). Send a smaller one.');
    return { name, kind: 'inline', mime, data: file.buffer.toString('base64') };
  }
  let text;
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
    try { text = clean((await pdf(file.buffer, { max: 40 })).text); } catch { text = ''; } // unreadable here? let Gemini try it directly below
    if (text.length < 40) { // scanned PDF: let Gemini look at it directly, this message only
      if (file.size > MAX_INLINE_BYTES) throw httpError(400, 'This PDF has no readable text (scanned?) and is over 4 MB. Send a smaller one.');
      return { name, kind: 'inline', mime: 'application/pdf', data: file.buffer.toString('base64') };
    }
  } else if (/\.docx$/i.test(name) || mime.includes('wordprocessingml')) {
    try { text = clean((await mammoth.extractRawText({ buffer: file.buffer })).value); } catch { throw httpError(400, 'Could not read this Word file'); }
  } else if (/^text\//.test(mime) || /\.(txt|md|csv|tsv|json|log)$/i.test(name)) {
    text = clean(file.buffer.toString('utf8'));
  } else throw httpError(400, 'Attach a PDF, Word (.docx), text / CSV file, or a photo (PNG, JPG, WebP)');
  if (!text) throw httpError(400, 'No readable text found in this file');
  const truncated = text.length > MAX_DOC_CHARS;
  return { name, kind: 'text', text: truncated ? text.slice(0, MAX_DOC_CHARS) : text, truncated, chars: text.length };
}
