// Turns a document's HTML into a PDF on the phone and opens the share / print sheet (Save to Files, WhatsApp, Print...).
import { buildHTML } from './docRender';

const size = (content) => (content?.orientation === 'landscape' ? { width: 1123, height: 794 } : { width: 794, height: 1123 }); // A4 at 96 dpi

export async function shareDocumentPdf(content, opts = {}) {
  let Print; let Sharing;
  try { Print = await import('expo-print'); Sharing = await import('expo-sharing'); } catch { throw new Error('PDF support is not installed. Run run-mobile again so expo-print is installed.'); }
  const html = buildHTML(content, opts);
  const { uri } = await Print.printToFileAsync({ html, ...size(content) });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: content?.title || 'Document' });
}

// Opens the system print dialog directly (AirPrint / Android print service).
export async function printDocument(content, opts = {}) {
  let Print;
  try { Print = await import('expo-print'); } catch { throw new Error('Printing is not installed. Run run-mobile again so expo-print is installed.'); }
  await Print.printAsync({ html: buildHTML(content, opts) });
}

// HTML for the on-screen preview: the page is laid out at its real width and scaled down to fit the phone.
export function previewHTML(content, opts, scale) {
  const w = content?.orientation === 'landscape' ? 1123 : 794;
  const meta = `<meta name="viewport" content="width=${w}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no">`;
  return buildHTML(content, opts).replace('<head>', `<head>${meta}`);
}
