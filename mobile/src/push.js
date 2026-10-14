// Push notifications. Everything here is optional and safe: if expo-notifications is missing (or the phone / Expo Go
// cannot do remote push) the app still works, and notifications still arrive in the in-app inbox (the bell).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

let N = null; // the expo-notifications module, loaded on first use
async function lib() {
  if (N !== null) return N;
  try { N = await import('expo-notifications'); } catch { N = false; }
  return N;
}

// show alerts even while the app is open, and react when one arrives or is tapped
export async function setupPush({ onReceive, onTap }) {
  const n = await lib();
  if (!n) return () => {};
  try {
    n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    const a = n.addNotificationReceivedListener(() => onReceive?.());
    const b = n.addNotificationResponseReceivedListener((r) => onTap?.(r.notification.request.content.data || {}));
    // the app was closed and the person tapped a notification to open it (handle each tap only once)
    n.getLastNotificationResponseAsync?.().then(async (r) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if ((await AsyncStorage.getItem('push.lastTap')) === id) return;
      await AsyncStorage.setItem('push.lastTap', id);
      onTap?.(r.notification.request.content.data || {});
    }).catch(() => {});
    return () => { a.remove(); b.remove(); };
  } catch { return () => {}; }
}

// ask permission, get this phone's Expo push token and give it to the server. Returns { ok, why }.
export async function registerPush() {
  try {
    const n = await lib();
    if (!n) return { ok: false, why: 'Push alerts need the expo-notifications package. Run run-mobile again to install it.' };
    const Device = await import('expo-device').catch(() => null);
    if (Device && Device.isDevice === false) return { ok: false, why: 'Push alerts work on a real phone, not on an emulator.' };
    if (Platform.OS === 'android') await n.setNotificationChannelAsync('default', { name: 'School updates', importance: n.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: '#15663f' });
    let { status } = await n.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await n.requestPermissionsAsync());
    if (status !== 'granted') return { ok: false, why: 'Notifications are turned off for this app. Turn them on in your phone settings.' };
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const t = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post('/notifications/push-token', { token: t.data, platform: Platform.OS, device_name: Device?.modelName || null });
    await AsyncStorage.setItem('push.token', t.data);
    return { ok: true };
  } catch (e) {
    return { ok: false, why: `Could not switch on phone alerts: ${e.message}. (Expo Go on Android cannot receive push - use a development build. Notifications still show in the bell.)` };
  }
}

// on sign-out: this phone stops receiving this person's alerts
export async function unregisterPush() {
  try {
    const t = await AsyncStorage.getItem('push.token'); if (!t) return;
    await Promise.race([api.post('/notifications/push-token/remove', { token: t }), new Promise((r) => setTimeout(r, 1500))]);
    await AsyncStorage.removeItem('push.token');
  } catch { /* ignore */ }
}
