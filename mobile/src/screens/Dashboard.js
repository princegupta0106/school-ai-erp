import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { C, SH, initials } from '../theme';
import { Icon } from '../icons';
import { api } from '../api';
import { useApi } from '../useApi';
import { toast } from '../ui';

// Same dashboard as the web app: stat numbers + attendance / leave / audit / notice cards.
// Every item can be removed with the x (or from Customize home); the choice is saved with the person's prefs.
const D = { blue: '#3B6FD8', green: '#2E9E6B', amber: '#E0932B', red: '#D4503F', purple: '#8B5CD6' };
const has = (me, ...f) => f.some((x) => me.features.includes(x));
const pos = (order, id) => { const i = (order || []).indexOf(id); return i < 0 ? 1e6 : i; };
const NOTICE_F = ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'];
const kid = (me) => me.role === 'parent' || me.role === 'student';
const nm = (e) => (typeof e === 'string' ? e : e?.full_name || e?.name || e?.login_id || 'Unknown');
const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - new Date(t)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pctCol = (p) => (p >= 85 ? D.green : p >= 75 ? D.amber : D.red);

function useKids(me) {
  const kids = useApi(me.role === 'parent' ? '/users/my-children' : null);
  if (me.role === 'student') return [{ user_id: me.user_id, full_name: me.profile?.full_name }];
  return Array.isArray(kids.data) ? kids.data : [];
}
const kidName = (k) => k.full_name || k.profile?.full_name || k.login_id || 'Student';

function Donut({ pct, size = 112, stroke = 12, color, big, small }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.line} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(Math.min(100, pct) / 100) * c} ${c}`} rotation="-90" origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}><Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>{big}</Text><Text style={{ fontSize: 11, color: C.mute }}>{small}</Text></View>
    </View>
  );
}
const Legend = ({ color, label, val }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 }}>
    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} /><Text style={{ color: C.ink, fontSize: 13, flex: 1 }}>{label}</Text><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }}>{val}</Text>
  </View>
);
const Bar = ({ label, p }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 }}>
    <Text style={{ width: 54, color: C.mute, fontSize: 12 }} numberOfLines={1}>{label}</Text>
    <View style={{ flex: 1, height: 9, borderRadius: 5, backgroundColor: C.line, overflow: 'hidden' }}><View style={{ width: `${Math.max(0, Math.min(100, p))}%`, height: '100%', borderRadius: 5, backgroundColor: pctCol(p) }} /></View>
    <Text style={{ width: 38, textAlign: 'right', fontWeight: '700', color: C.ink, fontSize: 12 }}>{p}%</Text>
  </View>
);
const Empty = ({ children }) => <Text style={{ color: C.mute, textAlign: 'center', paddingVertical: 16, fontSize: 13 }}>{children}</Text>;

function Card({ title, icon, onHide, action, children }) {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12, ...SH }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${C.brand}22`, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={15} color={C.brand} /></View>
        <Text style={{ flex: 1, fontWeight: '700', color: C.ink, fontSize: 14.5 }} numberOfLines={1}>{title}</Text>
        {action}
        <Pressable onPress={onHide} hitSlop={10} accessibilityLabel={`Remove ${title}`}><Icon name="x" size={17} color={C.mute} /></Pressable>
      </View>
      {children}
    </View>
  );
}
const Link = ({ label, onPress }) => <Pressable onPress={onPress} hitSlop={8}><Text style={{ color: C.brand, fontWeight: '700', fontSize: 13 }}>{label}</Text></Pressable>;

function ChildAtt({ k, showName }) {
  const { data } = useApi(`/attendance/my?student_id=${k.user_id}`);
  const t = data?.summary; const p = t?.percent ?? 0;
  const months = (data?.months || []).slice(-6);
  return (
    <View style={{ marginBottom: 6 }}>
      {showName && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${D.blue}22`, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: D.blue, fontWeight: '800', fontSize: 11 }}>{initials(kidName(k))}</Text></View>
        <Text style={{ color: C.ink, fontWeight: '700' }}>{kidName(k)}</Text>
        {data?.student?.class && <Text style={{ color: C.mute, fontSize: 12, marginLeft: 'auto' }}>Class {data.student.class.name}{data.student.class.section ? `-${data.student.class.section}` : ''}</Text>}
      </View>}
      {!t ? <Empty>Loading…</Empty> : t.total === 0 ? <Empty>No attendance recorded yet</Empty> : (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Donut pct={p} color={pctCol(p)} big={`${p}%`} small="attendance" />
          <View style={{ flex: 1 }}>
            <Legend color={D.green} label="Present" val={t.present} /><Legend color={D.amber} label="Late" val={t.late} />
            <Legend color={D.red} label="Absent" val={t.absent} /><Legend color={D.blue} label="On leave" val={t.leave} />
          </View>
        </View>
        {months.length > 0 && <View style={{ marginTop: 10 }}>{months.map((m) => <Bar key={m.month} label={MON[Number(m.month.slice(5, 7)) - 1]} p={Math.round(m.percent ?? 0)} />)}</View>}
      </>)}
    </View>
  );
}
function MyAttendanceCard({ me, onHide }) {
  const kids = useKids(me);
  return (
    <Card title={me.role === 'parent' ? (kids.length > 1 ? "Children's attendance" : "Child's attendance") : 'My attendance'} icon="attendance" onHide={onHide}>
      {kids.length === 0 ? <Empty>No students linked to your account yet</Empty> : kids.map((k) => <ChildAtt key={k.user_id} k={k} showName={kids.length > 1 || me.role === 'parent'} />)}
    </Card>
  );
}

function AttendanceCard({ me, go, onHide }) {
  const { data } = useApi('/attendance/reports/daily');
  const t = data?.totals; const present = t ? t.present + t.late : 0; const p = t && t.marked ? Math.round((present / t.marked) * 100) : 0;
  const rows = (data?.classes || []).filter((c) => c.marked > 0).slice(0, 6);
  return (
    <Card title="Today's attendance" icon="attendance" onHide={onHide} action={<Link label="Reports" onPress={() => go('attendance/reports')} />}>
      {!t ? <Empty>Loading…</Empty> : (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Donut pct={p} color={D.green} big={t.marked ? `${p}%` : '—'} small="present" />
          <View style={{ flex: 1 }}>
            <Legend color={D.green} label="Present" val={t.present} /><Legend color={D.amber} label="Late" val={t.late} />
            <Legend color={D.red} label="Absent" val={t.absent} /><Legend color={D.blue} label="On leave" val={t.leave} />
          </View>
        </View>
        <Text style={{ color: C.mute, fontSize: 12, marginTop: 8 }}>{t.classes_marked} of {t.classes} classes marked</Text>
        {rows.length > 0 && <View style={{ marginTop: 6 }}>{rows.map((c) => <Bar key={c.id} label={c.name || c.class_name || 'Class'} p={Math.round(((c.present + c.late) / c.marked) * 100)} />)}</View>}
      </>)}
    </Card>
  );
}

function LeaveCard({ me, go, onHide }) {
  const { data, reload } = useApi('/payroll/leave?status=pending');
  const [busy, setBusy] = useState(''); const [gone, setGone] = useState([]);
  const canAct = has(me, 'leave_approve');
  const act = async (id, what) => {
    setBusy(id + what);
    try { await api.post(`/payroll/leave/${id}/${what}`, {}); setGone((g) => [...g, id]); reload(); toast(what === 'approve' ? 'Leave approved' : 'Leave rejected'); }
    catch (e) { toast(e.message, true); }
    setBusy('');
  };
  const list = (Array.isArray(data) ? data : []).filter((l) => !gone.includes(l.id));
  return (
    <Card title={`Leave requests${list.length ? ` (${list.length})` : ''}`} icon="wallet" onHide={onHide} action={<Link label="See all" onPress={() => go('payroll')} />}>
      {!data ? <Empty>Loading…</Empty> : list.length === 0 ? <Empty>No pending leave requests 🎉</Empty> : list.slice(0, 5).map((l, i) => {
        const who = nm(l.employee);
        const range = l.end_date && l.end_date !== l.start_date ? `${l.start_date} → ${l.end_date}` : l.start_date;
        return (
          <View key={l.id} style={{ paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${D.blue}22`, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: D.blue, fontWeight: '800', fontSize: 12 }}>{initials(who)}</Text></View>
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{who}</Text><Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={1}>{range}{l.half_day ? ' · half day' : ''}{l.reason ? ` · ${l.reason}` : ''}</Text></View>
            </View>
            {canAct && <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginLeft: 44 }}>
              <Pressable disabled={!!busy} onPress={() => act(l.id, 'approve')} style={{ backgroundColor: D.blue, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{busy === l.id + 'approve' ? '…' : 'Approve'}</Text></Pressable>
              <Pressable disabled={!!busy} onPress={() => act(l.id, 'reject')} style={{ backgroundColor: D.red, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{busy === l.id + 'reject' ? '…' : 'Reject'}</Text></Pressable>
            </View>}
          </View>
        );
      })}
    </Card>
  );
}

function AuditCard({ go, onHide }) {
  const { data } = useApi('/audit?limit=50');
  const logs = data?.logs || [];
  const now = Date.now(); const B = 12; const bins = Array(B).fill(0);
  logs.forEach((l) => { const h = Math.floor((now - new Date(l.created_at)) / 3600000); if (h >= 0 && h < B) bins[B - 1 - h] += 1; });
  const max = Math.max(1, ...bins); const W = 300; const H = 70;
  const pts = bins.map((v, i) => [(i / (B - 1)) * W, H - 6 - (v / max) * (H - 16)]);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  return (
    <Card title="Audit log" icon="shield" onHide={onHide} action={<Link label="See all" onPress={() => go('audit')} />}>
      {!data ? <Empty>Loading…</Empty> : (<>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <Defs><LinearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={D.blue} stopOpacity="0.35" /><Stop offset="1" stopColor={D.blue} stopOpacity="0" /></LinearGradient></Defs>
          <Path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#ag)" /><Path d={line} fill="none" stroke={D.blue} strokeWidth={2.2} strokeLinejoin="round" />
        </Svg>
        <Text style={{ color: C.mute, fontSize: 11.5, marginBottom: 6 }}>Activity · last 12 hours</Text>
        {logs.slice(0, 5).map((l, i) => (
          <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.success === false ? D.red : D.green }} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{l.summary || l.action}</Text><Text style={{ color: C.mute, fontSize: 11.5 }}>{l.actor_name || l.actor_login || 'System'}</Text></View>
            <Text style={{ color: C.mute, fontSize: 11.5 }}>{ago(l.created_at)}</Text>
          </View>
        ))}
        {logs.length === 0 && <Empty>No activity yet</Empty>}
      </>)}
    </Card>
  );
}

function NoticeCard({ go, onHide }) {
  const { data } = useApi('/communication/announcements?limit=5');
  const list = data ? [...(data.pinned || []), ...(data.items || [])].slice(0, 3) : [];
  const tones = [D.purple, D.blue, D.amber];
  return (
    <Card title="Notice board" icon="megaphone" onHide={onHide} action={<Link label="View all" onPress={() => go('communication/board')} />}>
      {!data ? <Empty>Loading…</Empty> : list.length === 0 ? <Empty>No notices yet</Empty> : list.map((n, i) => (
        <Pressable key={n.id} onPress={() => go('communication/board')} style={{ flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: tones[i % 3] }} />
          <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{n.pinned ? '📌 ' : ''}{n.title}</Text><Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={2}>{n.body}</Text></View>
          <Text style={{ color: C.mute, fontSize: 11.5 }}>{n.created_at ? ago(n.created_at) : ''}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

function Stats({ me, go, hidden, order, onHide }) {
  const att = useApi(has(me, 'view_attendance_reports') ? '/attendance/reports/daily' : null);
  const leave = useApi(has(me, 'leave_approve', 'leave_view_all') ? '/payroll/leave?status=pending' : null);
  const notes = useApi(has(me, ...NOTICE_F) ? '/communication/announcements?limit=5' : null);
  const kids = useKids(me);
  const kidAtt = useApi(kid(me) && kids[0] ? `/attendance/my?student_id=${kids[0].user_id}` : null);
  const ks = kidAtt.data?.summary; const t = att.data?.totals;
  const items = [
    kid(me) && ks && { id: 'stat-att', label: me.role === 'parent' && kids.length > 1 ? `${kidName(kids[0])}'s attendance` : 'Attendance', val: ks.total ? `${ks.percent}%` : '—', icon: 'attendance', c: D.green, to: me.role === 'student' ? '' : '' },
    kid(me) && ks && { id: 'stat-days', label: 'Days absent', val: ks.absent, icon: 'users', c: D.red, to: '' },
    t && { id: 'stat-marked', label: 'Students marked', val: `${t.marked}/${t.students}`, icon: 'users', c: D.blue, to: 'attendance' },
    t && { id: 'stat-absent', label: 'Absent today', val: t.absent, icon: 'attendance', c: D.red, to: 'attendance/reports' },
    Array.isArray(leave.data) && { id: 'stat-leave', label: 'Pending leave', val: leave.data.length, icon: 'wallet', c: D.amber, to: 'payroll' },
    notes.data && { id: 'stat-notices', label: 'Notices', val: (notes.data.pinned?.length || 0) + (notes.data.items?.length || 0), icon: 'megaphone', c: D.purple, to: 'communication' },
  ].filter(Boolean).filter((x) => !hidden.includes(x.id)).sort((a, b) => pos(order, a.id) - pos(order, b.id));
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
      {items.map((s, i) => {
        const full = items.length === 1 || (items.length % 2 === 1 && i === items.length - 1);
        return (
          <Pressable key={s.id} onPress={() => s.to && go(s.to)} style={{ flexBasis: full ? '100%' : '47%', flexGrow: 1, backgroundColor: `${s.c}18`, borderRadius: 16, borderWidth: 1, borderColor: `${s.c}33`, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: `${s.c}2A`, alignItems: 'center', justifyContent: 'center' }}><Icon name={s.icon} size={19} color={s.c} /></View>
            <View style={{ flex: 1 }}><Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>{s.val}</Text><Text style={{ fontSize: 12, color: C.mute }} numberOfLines={1}>{s.label}</Text></View>
            <Pressable onPress={() => onHide(s.id)} hitSlop={10} accessibilityLabel={`Remove ${s.label}`} style={{ alignSelf: 'flex-start' }}><Icon name="x" size={15} color={C.mute} /></Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

// every dashboard item this person may see (also used by Customize home)
export function dashItems(me) {
  return [
    kid(me) && { id: 'stat-att', label: 'Attendance %', group: 'stat' },
    kid(me) && { id: 'stat-days', label: 'Days absent', group: 'stat' },
    has(me, 'view_attendance_reports') && { id: 'stat-marked', label: 'Students marked', group: 'stat' },
    has(me, 'view_attendance_reports') && { id: 'stat-absent', label: 'Absent today', group: 'stat' },
    has(me, 'leave_approve', 'leave_view_all') && { id: 'stat-leave', label: 'Pending leave', group: 'stat' },
    has(me, ...NOTICE_F) && { id: 'stat-notices', label: 'Notices count', group: 'stat' },
    kid(me) && { id: 'c-myatt', label: me.role === 'parent' ? "Child's attendance" : 'My attendance', group: 'card', C: MyAttendanceCard },
    has(me, 'view_attendance_reports') && { id: 'c-att', label: "Today's attendance", group: 'card', C: AttendanceCard },
    has(me, 'leave_approve', 'leave_view_all') && { id: 'c-leave', label: 'Leave requests', group: 'card', C: LeaveCard },
    has(me, 'view_audit_logs') && { id: 'c-audit', label: 'Audit log', group: 'card', C: AuditCard },
    has(me, ...NOTICE_F) && { id: 'c-notice', label: 'Notice board', group: 'card', C: NoticeCard },
  ].filter(Boolean);
}

export default function Dashboard({ me, go, prefs, update }) {
  const hidden = prefs.dashHidden || []; const order = prefs.dashOrder || [];
  const hide = (id) => { update((p) => ({ ...p, dashHidden: [...new Set([...(p.dashHidden || []), id])] })); };
  const all = dashItems(me);
  const cards = all.filter((x) => x.group === 'card' && !hidden.includes(x.id)).sort((a, b) => pos(order, a.id) - pos(order, b.id));
  if (!cards.length && !all.some((x) => x.group === 'stat' && !hidden.includes(x.id))) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Stats me={me} go={go} hidden={hidden} order={order} onHide={hide} />
      {cards.map((x) => <x.C key={x.id} me={me} go={go} onHide={() => hide(x.id)} />)}
    </View>
  );
}
