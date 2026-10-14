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
  await Sharing.shareAsync(uri, { mimeType, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text', dialogTitle: fileName });
}
