// Downloads a protected file (e.g. a PDF receipt) with the sign-in token, then opens the phone's share / open sheet.
import { API_URL, authHeader } from './api';

export async function downloadAndShare(apiPath, fileName, mimeType = 'application/pdf') {
  const url = `${API_URL}/api${apiPath}`;
  const headers = authHeader();
  let uri;
  try { // current expo-file-system API
    const { File, Paths } = await import('expo-file-system');
    const dest = new File(Paths.cache, fileName);
    if (dest.exists) dest.delete();
    uri = (await File.downloadFileAsync(url, dest, { headers })).uri;
  } catch (first) {
    try { // older SDKs
      const FS = await import('expo-file-system/legacy');
      const res = await FS.downloadAsync(url, `${FS.cacheDirectory}${fileName}`, { headers });
      if (res.status && res.status >= 400) throw new Error(res.status === 403 ? "You don't have access to this file" : `Download failed (${res.status})`);
      uri = res.uri;
    } catch (second) { throw new Error(second?.message || first?.message || 'Could not download the file'); }
  }
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : mimeType === 'text/csv' ? 'public.comma-separated-values-text' : mimeType === 'application/zip' ? 'public.zip-archive' : mimeType === 'application/gzip' ? 'org.gnu.gnu-zip-archive' : 'public.data', dialogTitle: fileName });
}

// Turns an HTML page into a PDF on the phone and opens the share / print sheet (receipts, stock reports).
export async function sharePdfHtml(html, title = 'Document', size = { width: 794, height: 1123 }) {
  let Print; let Sharing;
  try { Print = await import('expo-print'); Sharing = await import('expo-sharing'); } catch { throw new Error('PDF support is not installed. Run run-mobile again so expo-print is installed.'); }
  const { uri } = await Print.printToFileAsync({ html, width: size.width, height: size.height });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}

// Saves text (e.g. a CSV for Excel) as a file and opens the share sheet. Falls back to sharing the text itself.
export async function shareTextFile(fileName, text, mimeType = 'text/csv') {
  let uri = '';
  try {
    const FS = await import('expo-file-system/legacy');
    uri = `${FS.cacheDirectory}${fileName}`;
    await FS.writeAsStringAsync(uri, text, { encoding: 'utf8' });
  } catch {
    try {
      const { File, Paths } = await import('expo-file-system');
      const f = new File(Paths.cache, fileName);
      if (f.exists) f.delete();
      f.create(); f.write(text); uri = f.uri;
    } catch { uri = ''; }
  }
  if (uri) {
    try {
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) { await Sharing.shareAsync(uri, { mimeType, UTI: 'public.comma-separated-values-text', dialogTitle: fileName }); return; }
    } catch { /* fall through to plain text share */ }
  }
  const { Share } = await import('react-native');
  await Share.share({ title: fileName, message: text });
}
