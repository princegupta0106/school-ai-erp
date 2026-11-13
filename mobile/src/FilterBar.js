import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SH } from './theme';
import { Icon } from './icons';
import { DateField } from './ui';

/* ============================================================================================
   FilterBar - the ONE search + filter pattern for every mobile list screen (same API as the web FilterBar).

   <FilterBar
     q={q} onQ={setQ} placeholder="Search..."            // omit onQ for screens with no search
     filters={[{ key:'cls', label:'Class', value:cls, onChange:setCls, options:[{value:'1',label:'Class 1'}], all:'All classes' }]}
     sort={{ value:sortBy, onChange:setSortBy, def:'name', options:[{value:'name',label:'Name A-Z'}] }}
     count={rows.length}                                  // optional: shown in the sheet header
     end={<Btn .../>}                                     // optional: extra control under the bar
     inline />                                            // inline = inside a scrolling <Pad> (no outer padding); omit when it sits above the list

   Filter spec: key, label, value, onChange, options (strings or {value,label}), all (label of the empty option, null = no "all"),
                def (default value, '' unless given), chip(v) (custom active-chip text), type: 'date' for a date picker.
   IMPORTANT: Apply can call several onChange in a row, so state setters for object state must be functional:
                (v) => setF((p) => ({ ...p, module: v }))
   ============================================================================================ */
const norm = (o) => (o !== null && typeof o === 'object' ? o : { value: o, label: String(o) });
const dv = (f) => f.def ?? '';
const isOn = (f) => String(f.value ?? '') !== String(dv(f));
const labelOf = (f) => { const o = (f.options || []).map(norm).find((x) => String(x.value) === String(f.value)); return o ? o.label : String(f.value); };
const sortDef = (sort) => sort.def ?? norm(sort.options[0]).value;

const Pill = ({ on, label, onPress }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
    style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.card, opacity: pressed ? 0.7 : 1 })}>
    <Text style={{ color: on ? '#fff' : C.ink, fontSize: 14, fontWeight: on ? '700' : '500' }}>{label}</Text>
  </Pressable>
);
const Group = ({ label, children }) => (
  <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
    <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: C.mute, marginBottom: 10 }}>{label}</Text>
    {children}
  </View>
);

function Sheet({ filters, sort, count, onClose }) {
  const inset = useSafeAreaInsets();
  const [d, setD] = useState(() => { const x = {}; filters.forEach((f) => { x[f.key] = f.value ?? ''; }); if (sort) x.__sort = sort.value; return x; });
  const apply = () => {
    filters.forEach((f) => { if (String(d[f.key]) !== String(f.value ?? '')) f.onChange(d[f.key]); });
    if (sort && d.__sort !== sort.value) sort.onChange(d.__sort);
    onClose();
  };
  const reset = () => { const x = {}; filters.forEach((f) => { x[f.key] = dv(f); }); if (sort) x.__sort = sortDef(sort); setD(x); };
  const Opts = ({ value, set, options, all }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {all !== null && <Pill on={String(value) === ''} label={all} onPress={() => set('')} />}
      {options.map(norm).map((o) => <Pill key={String(o.value)} on={String(value) === String(o.value)} label={o.label} onPress={() => set(o.value)} />)}
    </View>
  );
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: C.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close filters" />
        <View style={{ maxHeight: '86%', backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>Filters</Text>
              {count != null && <Text style={{ color: C.mute, fontSize: 12.5, marginTop: 1 }}>{count} result{count === 1 ? '' : 's'} now</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={{ padding: 8 }}><Icon name="x" size={20} color={C.ink} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {sort && <Group label="Sort by"><Opts value={d.__sort} set={(v) => setD((p) => ({ ...p, __sort: v }))} options={sort.options} all={null} /></Group>}
            {filters.map((f) => (
              <Group key={f.key} label={f.label}>
                {f.type === 'date'
                  ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <DateField value={d[f.key]} onChange={(v) => setD((p) => ({ ...p, [f.key]: v }))} />
                    {!!d[f.key] && <Pressable onPress={() => setD((p) => ({ ...p, [f.key]: '' }))} hitSlop={8}><Text style={{ color: C.brand, fontWeight: '700' }}>Clear</Text></Pressable>}
                  </View>
                  : <Opts value={d[f.key]} set={(v) => setD((p) => ({ ...p, [f.key]: v }))} options={f.options || []} all={f.all === undefined ? 'All' : f.all} />}
              </Group>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 + inset.bottom, borderTopWidth: 1, borderTopColor: C.line }}>
            <Pressable onPress={reset} style={{ height: 48, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>Reset</Text></Pressable>
            <Pressable onPress={apply} style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Apply filters</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function FilterBar({ q, onQ, placeholder = 'Search...', filters = [], sort, count, end, style, inline }) {
  const [open, setOpen] = useState(false);
  const fs = filters.filter(Boolean);
  const act = fs.filter(isOn);
  const sortOn = !!sort && String(sort.value) !== String(sortDef(sort));
  const n = act.length + (sortOn ? 1 : 0);
  const has = fs.length > 0 || !!sort;
  const clear = () => { act.forEach((f) => f.onChange(dv(f))); if (sortOn) sort.onChange(sortDef(sort)); };
  const Tag = ({ text, onX, label }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.soft, borderRadius: 999, paddingLeft: 12, paddingRight: 4, height: 32 }}>
      <Text style={{ color: C.ink, fontSize: 13, fontWeight: '600' }}>{text}</Text>
      <Pressable onPress={onX} hitSlop={6} accessibilityLabel={label} style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={14} color={C.mute} /></Pressable>
    </View>
  );
  return (
    <View style={[inline ? { gap: 10, marginBottom: 12 } : { paddingHorizontal: 16, paddingTop: 12, gap: 10 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {onQ && (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, ...SH }}>
            <Icon name="search" size={18} color={C.mute} />
            <TextInput value={q} onChangeText={onQ} placeholder={placeholder} placeholderTextColor={C.hint} style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: C.ink }} autoCorrect={false} />
            {!!q && <Pressable onPress={() => onQ('')} hitSlop={8}><Icon name="x" size={16} color={C.mute} /></Pressable>}
          </View>)}
        {has && (
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={n ? `Filters, ${n} active` : 'Filters'}
            style={({ pressed }) => ({ height: 46, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: n ? C.brand : C.line, backgroundColor: n ? C.soft : C.card, opacity: pressed ? 0.7 : 1, ...SH })}>
            <Icon name="sliders" size={18} color={n ? C.brand : C.ink} />
            <Text style={{ color: n ? C.brand : C.ink, fontWeight: '700', fontSize: 14 }}>Filter</Text>
            {n > 0 && <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{n}</Text></View>}
          </Pressable>)}
      </View>
      {!!end && <View>{end}</View>}
      {n > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {act.map((f) => <Tag key={f.key} label={`Remove ${f.label} filter`} text={f.chip ? f.chip(f.value) : `${f.label}: ${f.type === 'date' ? f.value : labelOf(f)}`} onX={() => f.onChange(dv(f))} />)}
          {sortOn && <Tag label="Reset sort" text={`Sort: ${norm(sort.options.map(norm).find((o) => String(o.value) === String(sort.value)) || { label: sort.value }).label}`} onX={() => sort.onChange(sortDef(sort))} />}
          <Pressable onPress={clear} hitSlop={6} style={{ paddingHorizontal: 4, paddingVertical: 6 }}><Text style={{ color: C.mute, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' }}>Clear all</Text></Pressable>
        </View>)}
      {open && <Sheet filters={fs} sort={sort} count={count} onClose={() => setOpen(false)} />}
    </View>
  );
}
export default FilterBar;
