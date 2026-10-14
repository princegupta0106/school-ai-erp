import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C, when } from '../theme';
import { Icon } from '../icons';
import { Dim, Empty, Loading, Btn, Sheet, toast } from '../ui';
import { registerPush } from '../push';

const KIND_ICON = { notice: 'megaphone', message: 'chat', homework: 'file', marks: 'academics', fees: 'rupee', document: 'doc', leave: 'wallet', general: 'bell' };
const KIND_COLOR = { notice: '#e11d48', message: '#0891b2', homework: '#c026d3', marks: '#2563eb', fees: '#059669', document: '#65a30d', leave: '#d97706', general: C.brand };

// The inbox behind the bell: everything sent to this person, newest first. Works even when phone push is off.
export default function Notifications({ data, reload, onClose, onOpen }) {
  const [busy, setBusy] = useState(false);
  const items = data?.items || [];
  const open = async (n) => {
    if (!n.read_at) { api.post('/notifications/read', { ids: [n.id] }).then(reload).catch(() => {}); }
    onOpen(n);
  };
  const readAll = async () => { setBusy(true); try { await api.post('/notifications/read', { all: true }); await reload(); } catch (e) { toast(e.message, true); } finally { setBusy(false); } };
  const enable = async () => { setBusy(true); const r = await registerPush(); setBusy(false); toast(r.ok ? 'Phone alerts are on for this phone.' : r.why, !r.ok); };
  return (
    <Sheet title="Notifications" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Btn small kind="ghost" title="Mark all as read" onPress={readAll} disabled={busy || !data?.unread} />
        <Btn small kind="ghost" title="Turn on phone alerts" onPress={enable} disabled={busy} />
      </View>
      {!data ? <Loading /> : items.length === 0 ? <Empty>Nothing yet. Notices, homework, marks, fees and documents will show up here.</Empty> : items.map((n) => (
        <Pressable key={n.id} onPress={() => open(n)} style={{ flexDirection: 'row', gap: 12, backgroundColor: n.read_at ? '#fff' : C.soft, borderRadius: 14, borderWidth: 1, borderColor: n.read_at ? C.line : C.brand, padding: 12, marginBottom: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: `${KIND_COLOR[n.kind] || C.brand}22`, alignItems: 'center', justifyContent: 'center' }}><Icon name={KIND_ICON[n.kind] || 'bell'} size={19} color={KIND_COLOR[n.kind] || C.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: n.read_at ? '600' : '800' }} numberOfLines={2}>{n.title}</Text>
            {!!n.body && <Text style={{ color: C.mute, marginTop: 2 }} numberOfLines={3}>{n.body}</Text>}
            <Dim style={{ marginTop: 4, fontSize: 12 }}>{when(n.created_at)}</Dim>
          </View>
          {!n.read_at && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.brand, marginTop: 4 }} />}
        </Pressable>))}
    </Sheet>
  );
}
