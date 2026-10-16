import React from 'react';
import { View, Text, Switch } from 'react-native';
import { C } from '../theme';
import { Dim, Sheet, Card } from '../ui';
import { MODULE_UI, allTargets, effectiveShortcuts, visibleModules } from '../modules';

export default function Customize({ me, prefs, update, onClose }) {
  const targets = allTargets(me);
  const pinned = effectiveShortcuts(prefs, targets);
  const togglePin = (id) => update((p) => { const cur = effectiveShortcuts(p, targets); return { ...p, shortcuts: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }; });
  const toggleMod = (k) => update((p) => ({ ...p, hidden: p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k] }));
  const Row = ({ label, sub, value, onChange }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
      <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '600' }}>{label}</Text>{sub ? <Dim>{sub}</Dim> : null}</View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.brand }} />
    </View>
  );
  return (
    <Sheet title="Customize home" onClose={onClose}>
      <Text style={h}>Shortcuts</Text>
      <Card>{targets.map((t) => <Row key={t.id} label={t.label} sub={t.moduleLabel} value={pinned.includes(t.id)} onChange={() => togglePin(t.id)} />)}</Card>
      <Text style={h}>Modules shown on Home</Text>
      <Card>{visibleModules(me).map((m) => <Row key={m.key} label={MODULE_UI[m.key].label} value={!prefs.hidden.includes(m.key)} onChange={() => toggleMod(m.key)} />)}</Card>
    </Sheet>
  );
}
const h = { fontSize: 12, fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 };
