// Checks for new notifications while the app is in the background or closed (Android runs it about every 15+ minutes),
// and shows them in the notification bar. Needs the installed APK / a development build - it does nothing in Expo Go.
// Instant delivery to a fully closed app is only possible with Firebase push; this is the no-Firebase alternative.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, loadToken } from './api';
import { alertNew } from './push';

let TM = null; let BT = null;
try { TM = require('expo-task-manager'); BT = require('expo-background-task'); } catch { /* packages missing: skip */ }

const TASK = 'school-notifications-check';

// must be defined when the app file loads (before anything renders) so Android can run it with the app closed
if (TM && BT) {
  TM.defineTask(TASK, async () => {
    try {
      const t = await loadToken(); if (!t) return BT.BackgroundTaskResult.Success;
      const data = await api.get('/notifications?limit=30');
      await alertNew(data.items);
      return BT.BackgroundTaskResult.Success;
    } catch { return BT.BackgroundTaskResult.Failed; }
  });
}

export async function startBackgroundChecks() {
  try { if (BT) await BT.registerTaskAsync(TASK, { minimumInterval: 15 }); } catch { /* not supported here (e.g. Expo Go) */ }
}
export async function stopBackgroundChecks() {
  try { if (TM && (await TM.isTaskRegisteredAsync(TASK))) await BT.unregisterTaskAsync(TASK); } catch { /* ignore */ }
}

// Ask once: let the app keep running in the background (battery optimisation off). Without it many phones stop the app within minutes.
export async function askBackgroundPermission() {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem('bg.asked')) return;
    await AsyncStorage.setItem('bg.asked', '1');
    require('./ui').confirmAsk('To receive school notifications when the app is closed, allow it to run in the background. On the next screen choose "Allow".', () => openBatterySettings(), { title: 'Get notifications in the background', yes: 'Continue' });
  } catch { /* ignore */ }
}
export async function openBatterySettings() {
  try {
    const L = require('expo-intent-launcher');
    const pkg = require('expo-constants').default.expoConfig?.android?.package || 'com.schoolportal.mobile';
    try { await L.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: `package:${pkg}` }); }
    catch { await L.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'); }
  } catch { /* ignore */ }
}
