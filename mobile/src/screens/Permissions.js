import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, AppState, Linking, Platform, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, SH, live } from '../theme';
import { Sheet, Btn, Dim } from '../ui';
import { Icon } from '../icons';
import { registerPush, enableLocalAlerts } from '../push';
import { openBatterySettings } from '../background';

// "App permissions": shows what the app is allowed to do on this phone and lets the person grant what is missing from here.
// status: 'ok' (allowed) | 'bad' (not allowed) | 'unknown' (the phone does not let apps read this; tap to review)
let N = null; let BT = null;
try { N = require('expo-notifications'); } catch { /* not installed */ }
try { BT = require('expo-background-task'); } catch { /* not installed */ }

const openSettings = () => Linking.openSettings().catch(() => {});

async function readAll() {
  const out = [];
  // 1. Notifications (the permission Android 13+ asks for)
  if (N) {
    try {
      const p = await N.getPermissionsAsync();
      let blocked = false;
      if (p.status === 'granted' && Platform.OS === 'android') {
        const ch = await N.getNotificationChannelAsync?.('default').catch(() => null);
        blocked = !!ch && ch.importance === N.AndroidImportance.NONE;
      }
      out.push({ key: 'notif', icon: 'bell', title: 'Notifications', why: 'Fees, homework, notices and messages show up in your notification bar.',
        status: p.status === 'granted' && !blocked ? 'ok' : 'bad', note: blocked ? 'Allowed, but the "School updates" channel is switched off in phone settings.' : p.status === 'granted' ? 'Allowed' : p.canAskAgain === false ? 'Blocked: turn it on in phone settings.' : 'Not allowed yet',
        fix: p.status === 'granted' && !blocked ? null : p.canAskAgain === false || blocked ? { label: 'Open settings', run: async () => { openSettings(); } } : { label: 'Allow', run: async () => { await enableLocalAlerts(); } } });
    } catch { /* skip */ }
  }
  // 2. Push registration for this phone
  try {
    const tok = await AsyncStorage.getItem('push.token');
    out.push({ key: 'push', icon: 'bolt', title: 'Instant push alerts', why: 'Lets the school reach this phone even when the app is closed.',
      status: tok ? 'ok' : 'bad', note: tok ? 'This phone is registered' : 'Not registered (needs notifications allowed and a real phone with the installed app)',
      fix: tok ? null : { label: 'Register', run: async () => { const r = await registerPush(); if (!r.ok) return r.why; } } });
  } catch { /* skip */ }
  // 3. Background checks the phone allows
  if (BT) {
    try {
      const st = await BT.getStatusAsync();
      const ok = st === BT.BackgroundTaskStatus.Available;
      out.push({ key: 'bgtask', icon: 'grid', title: 'Background refresh', why: 'Checks for new notifications every ~15 minutes while the app is closed.',
        status: ok ? 'ok' : 'bad', note: ok ? 'Available' : 'Restricted by the phone (Background restrictions / data saver).',
        fix: ok ? null : { label: 'Open settings', run: async () => { openSettings(); } } });
    } catch { /* skip */ }
  }
  // 4. Battery optimisation (Android can't tell apps whether this is on, so we cannot read it)
  if (Platform.OS === 'android') {
    out.push({ key: 'battery', icon: 'shield', title: 'Run in background (battery)', why: 'Without this many phones stop the app after a few minutes.',
      status: 'unknown', note: 'The phone does not let apps check this. Tap Review and choose "Allow" / "Unrestricted".',
      fix: { label: 'Review', run: async () => { await openBatterySettings(); } } });
  }
  return out;
}

// Permissions the phone grants at install time (declared in app.json). They cannot be switched off from inside the app,
// so they are shown for information only.
const autoList = () => {
  const out = [
    { key: 'net', icon: 'upload', title: 'Internet access', why: 'Loads your school data and sends your changes to the server.' },
    { key: 'files', icon: 'file', title: 'Files and documents', why: 'Attach, download and share PDFs and photos. The app only sees files you pick yourself; it never browses your storage.' },
  ];
  if (Platform.OS === 'android') out.push(
    { key: 'vib', icon: 'bell', title: 'Vibration', why: 'Lets notifications vibrate your phone.' },
    { key: 'wake', icon: 'bolt', title: 'Keep phone awake for a moment', why: 'Lets the background check finish while the screen is off.' },
    { key: 'boot', icon: 'grid', title: 'Start after phone restarts', why: 'Keeps the background notification check running after a reboot.' },
  );
  return out;
};

const sectionH = live(() => ({ color: C.mute, fontSize: 12, fontWeight: '700', marginBottom: 8 }));
const TONE = { ok: () => [C.ok, C.okBg, 'Allowed'], bad: () => [C.bad, C.badBg, 'Not allowed'], unknown: () => [C.warn, C.warnBg, 'Check'] };

export default function Permissions({ onClose }) {
  const [rows, setRows] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const load = useCallback(async () => { setRows(await readAll()); }, []);
  useEffect(() => { load(); }, [load]);
  // coming back from the phone's settings: check again straight away
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); }); return () => sub.remove(); }, [load]);

  const act = async (r) => { setBusy(true); setMsg(''); try { const why = await r.fix.run(); if (why) setMsg(why); } finally { await load(); setBusy(false); } };
  const missing = (rows || []).filter((r) => r.status === 'bad' && r.fix);
  // grant everything that can be asked for in-app, one after another. Items that need the phone's settings page open it last.
  const grantAll = async () => {
    setBusy(true); setMsg('');
    try {
      const inApp = missing.filter((r) => r.fix.label !== 'Open settings');
      for (const r of inApp) { const why = await r.fix.run(); if (why) setMsg(why); }
      const fresh = await readAll(); setRows(fresh);
      const stuck = fresh.filter((r) => r.status === 'bad' && r.fix?.label === 'Open settings');
      if (stuck.length) { setMsg(`${stuck.map((r) => r.title).join(', ')} must be turned on in phone settings. Opening it now.`); openSettings(); }
    } finally { await load(); setBusy(false); }
  };

  const allOk = rows && rows.every((r) => r.status !== 'bad');
  const badCount = rows ? rows.filter((r) => r.status === 'bad').length : 0;
  return (
    <Sheet title="App permissions" onClose={onClose}>
      {!rows ? <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} /> : (<>
        <View style={{ backgroundColor: allOk ? C.okBg : C.warnBg, borderRadius: 14, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name={allOk ? 'check' : 'shield'} size={24} color={allOk ? C.ok : C.warn} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{allOk ? 'All set' : `${badCount} permission${badCount === 1 ? '' : 's'} missing`}</Text>
            <Dim>{allOk ? (rows.some((r) => r.status === 'unknown') ? 'Everything we can check is allowed. Please review the item marked Check.' : 'Everything the app needs is allowed on this phone.') : 'Allow these so you do not miss school updates.'}</Dim>
          </View>
        </View>
        {missing.length > 0 && <View style={{ marginBottom: 14 }}><Btn title={busy ? 'Working…' : 'Allow all missing permissions'} disabled={busy} onPress={grantAll} /></View>}
        {!!msg && <Text style={{ color: C.warn, backgroundColor: C.warnBg, padding: 10, borderRadius: 10, marginBottom: 12 }}>{msg}</Text>}
        <Text style={sectionH}>NEEDS YOUR APPROVAL</Text>
        {rows.map((r) => {
          const [fg, bg, label] = TONE[r.status]();
          return (
            <View key={r.key} style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 10, ...SH }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={r.icon} size={20} color={fg} /></View>
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{r.title}</Text><Dim>{r.why}</Dim></View>
                <Text style={{ color: fg, backgroundColor: bg, fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden' }}>{label}</Text>
              </View>
              <Text style={{ color: C.mute, fontSize: 12, marginTop: 8 }}>{r.note}</Text>
              {r.fix && <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn small kind={r.status === 'bad' ? undefined : 'ghost'} title={r.fix.label} disabled={busy} onPress={() => act(r)} /></View>}
            </View>
          );
        })}
        <Text style={[sectionH, { marginTop: 8 }]}>ALLOWED AUTOMATICALLY WHEN INSTALLED</Text>
        {autoList().map((r) => {
          const [fg, bg] = TONE.ok();
          return (
            <View key={r.key} style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 10, ...SH }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={r.icon} size={20} color={fg} /></View>
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{r.title}</Text><Dim>{r.why}</Dim></View>
                <Text style={{ color: fg, backgroundColor: bg, fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden' }}>Allowed</Text>
              </View>
            </View>
          );
        })}
        <View style={{ backgroundColor: C.muteBg, borderRadius: 12, padding: 12, marginTop: 4 }}>
          <Text style={{ color: C.mute, fontSize: 12 }}>This app does not use your camera, microphone, location, contacts, SMS or call history, and never asks for them.</Text>
        </View>
        <Pressable onPress={openSettings} style={{ alignSelf: 'center', paddingVertical: 12 }}><Text style={{ color: C.brand, fontWeight: '700' }}>Open phone settings for this app</Text></Pressable>
      </>)}
    </Sheet>
  );
}
