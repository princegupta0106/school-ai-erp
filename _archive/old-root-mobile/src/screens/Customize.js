import React from 'react';
import { View, Text, Switch } from 'react-native';
import { C, live } from '../theme';
import { Dim, Sheet, Card } from '../ui';
import { dashItems } from './Dashboard';
import { MODULE_UI, allTargets, effectiveShortcuts, visibleModules } from '../modules';

export default function Customize({ me, prefs, update, onClose }) {
  const targets = allTargets(me);
  const pinned = effectiveShortcuts(prefs, targets);
  const togglePin = (id) => update((p) => { const cur = effectiveShortcuts(p, targets); return { ...p, shortcuts: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }; });
  const toggleMod = (k) => update((p) => ({ ...p, hidden: p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k] }));
  const di = dashItems(me);
  const toggleDash = (id) => update((p) => ({ ...p, dashHidden: (p.dashHidden || []).includes(id) ? p.dashHidden.filter((x) => x !== id) : [...(p.dashHidden || []), id] }));
  const Row = ({ label, sub, value, onChange }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
      <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '600' }}>{label}</Text>{sub ? <Dim>{sub}</Dim> : null}</View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.brand, false: C.line }} />
    </View>
  );
  return (
    <Sheet title="Customize home" onClose={onClose}>
      {di.some((x) => x.group === 'stat') && (<><Text style={h}>Dashboard numbers</Text><Card>{di.filter((x) => x.group === 'stat').map((x) => <Row key={x.id} label={x.label} value={!(prefs.dashHidden || []).includes(x.id)} onChange={() => toggleDash(x.id)} />)}</Card></>)}
      {di.some((x) => x.group === 'card') && (<><Text style={h}>Dashboard cards</Text><Card>{di.filter((x) => x.group === 'card').map((x) => <Row key={x.id} label={x.label} value={!(prefs.dashHidden || []).includes(x.id)} onChange={() => toggleDash(x.id)} />)}</Card></>)}
      <Text style={h}>Shortcuts</Text>
      <Card>{targets.map((t) => <Row key={t.id} label={t.label} sub={t.moduleLabel} value={pinned.includes(t.id)} onChange={() => togglePin(t.id)} />)}</Card>
      <Text style={h}>Modules shown on Home</Text>
      <Card>{visibleModules(me).map((m) => <Row key={m.key} label={MODULE_UI[m.key].label} value={!prefs.hidden.includes(m.key)} onChange={() => toggleMod(m.key)} />)}</Card>
    </Sheet>
  );
}
const h = live(() => ({ fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: 8, marginTop: 4 }));
