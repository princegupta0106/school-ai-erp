import React, { useState } from 'react';
import { api } from './api.js';
import { useApi } from './cache.js';
import { Icon, toast, initials } from './ui.jsx';

const pos = (order, id) => { const i = (order || []).indexOf(id); return i < 0 ? 1e6 : i; };
const has = (me, ...f) => f.some((x) => me.features.includes(x));
const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(t)) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`;
};
const nm = (e) => (typeof e === 'string' ? e : e?.full_name || e?.name || e?.login_id || 'Unknown');

function Donut({ pct, size = 128, stroke = 14, color = 'var(--d-blue)', track = 'var(--line)', children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, pct) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s' }} />
      </svg>
      <div className="donut-in">{children}</div>
    </div>
  );
}

function Card({ cls = '', span = 6, onHide, title, icon, action, children }) {
  return (
    <div className={`dcard ${cls}`} style={{ '--s': span }}>
      <div className="dcard-h"><h3>{icon && <span className="dic"><Icon name={icon} size={15} /></span>}{title}</h3><span className="dh-r">{action}{onHide && <button className="dx" title="Remove from dashboard" aria-label="Remove card" onClick={onHide}><Icon name="x" size={15} /></button>}</span></div>
      {children}
    </div>
  );
}

function AttendanceCard({ me, go, span, onHide }) {
  const { data } = useApi('/attendance/reports/daily', has(me, 'view_attendance_reports'));
  const t = data?.totals;
  const present = t ? t.present + t.late : 0;
  const pct = t && t.marked ? Math.round((present / t.marked) * 100) : 0;
  const rows = (data?.classes || []).filter((c) => c.marked > 0).slice(0, 8);
  return (
    <Card span={span} onHide={onHide} title="Today's attendance" icon="attendance" action={<button className="linkbtn" onClick={() => go('attendance/reports')}>Reports</button>}>
      {!t ? <div className="muted small">Loading…</div> : (
        <div className="att">
          <Donut pct={pct} color="var(--d-green)"><b>{t.marked ? `${pct}%` : '—'}</b><span>present</span></Donut>
          <div className="att-side">
            <div className="legend"><i style={{ background: 'var(--d-green)' }} />Present <b>{t.present}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-amber)' }} />Late <b>{t.late}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-red)' }} />Absent <b>{t.absent}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-blue)' }} />On leave <b>{t.leave}</b></div>
            <div className="muted small" style={{ marginTop: 6 }}>{t.classes_marked} of {t.classes} classes marked</div>
          </div>
          <div className="bars">
            {rows.length === 0 ? <div className="muted small">No attendance marked yet today.</div> : rows.map((c) => {
              const p = Math.round(((c.present + c.late) / c.marked) * 100);
              return (
                <div className="bar-row" key={c.id}>
                  <span className="bl">{c.name || c.class_name || 'Class'}</span>
                  <div className="bt"><div className="bf" style={{ width: `${p}%`, background: p >= 85 ? 'var(--d-green)' : p >= 70 ? 'var(--d-amber)' : 'var(--d-red)' }} /></div>
                  <span className="bp">{p}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}


const isKid = (me) => me.role === 'parent' || me.role === 'student';
function useKids(me) {
  const kids = useApi('/users/my-children', me.role === 'parent');
  if (me.role === 'student') return [{ user_id: me.user_id, full_name: me.profile?.full_name }];
  return Array.isArray(kids.data) ? kids.data : [];
}
const kidName = (k) => k.full_name || k.profile?.full_name || k.login_id || 'Student';
const mon = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en', { month: 'short' });
function ChildAtt({ k, showName }) {
  const { data } = useApi(`/attendance/my?student_id=${k.user_id}`);
  const t = data?.summary;
  const pct = t?.percent ?? 0;
  const col = pct >= 85 ? 'var(--d-green)' : pct >= 75 ? 'var(--d-amber)' : 'var(--d-red)';
  const months = (data?.months || []).slice(-6);
  return (
    <div className="kid">
      {showName && <div className="kid-n"><span className="av">{initials(kidName(k))}</span><b>{kidName(k)}</b>{data?.student?.class && <small className="muted">Class {data.student.class.name}{data.student.class.section ? `-${data.student.class.section}` : ''}</small>}</div>}
      {!t ? <div className="muted small">Loading…</div> : t.total === 0 ? <div className="dempty">No attendance recorded yet</div> : (
        <div className="att">
          <Donut pct={pct} color={col}><b>{pct}%</b><span>attendance</span></Donut>
          <div className="att-side">
            <div className="legend"><i style={{ background: 'var(--d-green)' }} />Present <b>{t.present}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-amber)' }} />Late <b>{t.late}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-red)' }} />Absent <b>{t.absent}</b></div>
            <div className="legend"><i style={{ background: 'var(--d-blue)' }} />On leave <b>{t.leave}</b></div>
          </div>
          {months.length > 0 && (
            <div className="bars">
              {months.map((m) => { const p = Math.round(m.percent ?? 0); return (
                <div className="bar-row" key={m.month}><span className="bl">{mon(m.month)}</span>
                  <div className="bt"><div className="bf" style={{ width: `${p}%`, background: p >= 85 ? 'var(--d-green)' : p >= 75 ? 'var(--d-amber)' : 'var(--d-red)' }} /></div><span className="bp">{p}%</span></div>); })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function MyAttendanceCard({ me, span, onHide }) {
  const kids = useKids(me);
  return (
    <Card span={span} onHide={onHide} title={me.role === 'parent' ? (kids.length > 1 ? "Children's attendance" : "Child's attendance") : 'My attendance'} icon="attendance">
      {kids.length === 0 ? <div className="dempty">No students linked to your account yet</div> : kids.map((k) => <ChildAtt key={k.user_id} k={k} showName={kids.length > 1 || me.role === 'parent'} />)}
    </Card>
  );
}

function StatCards({ me, go, hidden, order, onHide }) {
  const att = useApi('/attendance/reports/daily', has(me, 'view_attendance_reports'));
  const leave = useApi('/payroll/leave?status=pending', has(me, 'leave_approve', 'leave_view_all'));
  const notes = useApi('/communication/announcements?limit=5', has(me, 'view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'));
  const kids = useKids(me);
  const kidAtt = useApi(`/attendance/my?student_id=${kids[0]?.user_id}`, isKid(me) && !!kids[0]);
  const ks = kidAtt.data?.summary;
  const t = att.data?.totals;
  const items = [
    isKid(me) && ks && { id: 'stat-att', label: me.role === 'parent' && kids.length > 1 ? `${kidName(kids[0])}'s attendance` : 'Attendance', val: ks.total ? `${ks.percent}%` : '—', icon: 'attendance', c: 'var(--d-green)', to: 'attendance' },
    isKid(me) && ks && { id: 'stat-days', label: 'Days absent', val: ks.absent, icon: 'users', c: 'var(--d-red)', to: 'attendance' },
    t && { id: 'stat-marked', label: 'Students marked', val: `${t.marked}/${t.students}`, icon: 'users', c: 'var(--d-blue)', to: 'attendance' },
    t && { id: 'stat-absent', label: 'Absent today', val: t.absent, icon: 'attendance', c: 'var(--d-red)', to: 'attendance/reports' },
    Array.isArray(leave.data) && { id: 'stat-leave', label: 'Pending leave', val: leave.data.length, icon: 'wallet', c: 'var(--d-amber)', to: 'payroll' },
    notes.data && { id: 'stat-notices', label: 'Notices', val: (notes.data.pinned?.length || 0) + (notes.data.items?.length || 0), icon: 'megaphone', c: 'var(--d-purple)', to: 'communication' },
  ].filter(Boolean).filter((x) => !hidden.includes(x.id));
  items.sort((a, b) => pos(order, a.id) - pos(order, b.id));
  if (!items.length) return null;
  return (
    <div className="stats" style={{ '--n': items.length }}>
      {items.map((s) => (
        <div key={s.id} className="statw">
          <button className="stat" style={{ '--c': s.c }} onClick={() => go(s.to)}>
            <span className="stic"><Icon name={s.icon} size={20} /></span>
            <span><b>{s.val}</b><small>{s.label}</small></span>
          </button>
          <button className="dx" title="Remove from dashboard" aria-label={`Remove ${s.label}`} onClick={() => onHide(s.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function LeaveCard({ me, go, span, onHide }) {
  const { data, set } = useApi('/payroll/leave?status=pending', has(me, 'leave_approve', 'leave_view_all'));
  const [busy, setBusy] = useState('');
  const canAct = has(me, 'leave_approve');
  const act = async (id, what) => {
    setBusy(id + what);
    try {
      await api.post(`/payroll/leave/${id}/${what}`, {});
      set((d) => (d || []).filter((x) => x.id !== id));
      toast(what === 'approve' ? 'Leave approved' : 'Leave rejected');
    } catch (e) { toast(e.message, true); }
    setBusy('');
  };
  const list = Array.isArray(data) ? data : [];
  return (
    <Card span={span} onHide={onHide} title={`Leave requests${list.length ? ` (${list.length})` : ''}`} icon="wallet" action={<button className="linkbtn" onClick={() => go('payroll')}>See all</button>}>
      {!data ? <div className="muted small">Loading…</div> : list.length === 0 ? <div className="dempty">No pending leave requests 🎉</div> : (
        <div className="llist">
          {list.slice(0, 5).map((l) => {
            const who = nm(l.employee);
            const range = l.end_date && l.end_date !== l.start_date ? `${l.start_date} → ${l.end_date}` : l.start_date;
            return (
              <div className="lrow" key={l.id}>
                <span className="av">{initials(who)}</span>
                <div className="lt"><b>{who}</b><small>{range}{l.half_day ? ' · half day' : ''}{l.reason ? ` · ${l.reason}` : ''}</small></div>
                {canAct && (
                  <div className="lbtns">
                    <button className="dbtn ok" disabled={!!busy} onClick={() => act(l.id, 'approve')}>{busy === l.id + 'approve' ? '…' : 'Approve'}</button>
                    <button className="dbtn bad" disabled={!!busy} onClick={() => act(l.id, 'reject')}>{busy === l.id + 'reject' ? '…' : 'Reject'}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function NoticeCard({ me, go, span, onHide }) {
  const ok = has(me, 'view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements');
  const { data } = useApi('/communication/announcements?limit=5', ok);
  const list = data ? [...(data.pinned || []), ...(data.items || [])].slice(0, 3) : [];
  const tones = ['var(--d-purple)', 'var(--d-blue)', 'var(--d-amber)'];
  return (
    <Card span={span} onHide={onHide} title="Notice board" icon="megaphone" action={<button className="linkbtn" onClick={() => go('communication/board')}>View all</button>}>
      {!data ? <div className="muted small">Loading…</div> : list.length === 0 ? <div className="dempty">No notices yet</div> : (
        <div className="nlist">
          {list.map((n, i) => (
            <button className="nrow" key={n.id} style={{ '--c': tones[i % 3] }} onClick={() => go('communication/board')}>
              <i />
              <div><b>{n.pinned ? '📌 ' : ''}{n.title}</b><small>{(n.body || '').slice(0, 70)}{(n.body || '').length > 70 ? '…' : ''}</small></div>
              <em>{n.created_at ? ago(n.created_at) : ''}</em>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function AuditCard({ me, go, span, onHide }) {
  const { data } = useApi('/audit?limit=50', has(me, 'view_audit_logs'));
  const logs = data?.logs || [];
  // activity per hour for the last 12 hours -> area chart
  const now = Date.now(); const B = 12; const bins = Array(B).fill(0);
  logs.forEach((l) => { const h = Math.floor((now - new Date(l.created_at)) / 3600000); if (h >= 0 && h < B) bins[B - 1 - h] += 1; });
  const max = Math.max(1, ...bins); const W = 300; const H = 80;
  const pts = bins.map((v, i) => [(i / (B - 1)) * W, H - 6 - (v / max) * (H - 16)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <Card span={span} onHide={onHide} title="Audit log" icon="shield" action={<button className="linkbtn" onClick={() => go('audit')}>See all</button>}>
      {!data ? <div className="muted small">Loading…</div> : (
        <>
          {logs.length > 0 && <div className="spark">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--d-blue)" stopOpacity=".35" /><stop offset="1" stopColor="var(--d-blue)" stopOpacity="0" /></linearGradient></defs>
              <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#ag)" />
              <path d={line} fill="none" stroke="var(--d-blue)" strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <small className="muted">Activity · last 12 hours</small>
          </div>}
          <div className="alist">
            {logs.slice(0, 5).map((l) => (
              <div className="arow" key={l.id}>
                <span className={`dot ${l.success === false ? 'bad' : ''}`} />
                <div className="at"><b>{l.summary || l.action}</b><small>{l.actor_name || l.actor_login || 'System'}</small></div>
                <em>{ago(l.created_at)}</em>
              </div>
            ))}
            {logs.length === 0 && <div className="dempty">No activity yet</div>}
          </div>
        </>
      )}
    </Card>
  );
}

const NOTICE_F = ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'];
const kid = (me) => me.role === 'parent' || me.role === 'student';
// every dashboard item this person may see (used by the page and by "Customize home")
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

const SPANS = { 1: [12], 2: [7, 5], 3: [7, 5, 12], 4: [7, 5, 5, 7], 5: [7, 5, 5, 7, 12] };
export default function Dashboard({ me, go, prefs, update }) {
  const hidden = prefs?.dashHidden || []; const order = prefs?.dashOrder || [];
  const hide = (id) => { update((p) => ({ ...p, dashHidden: [...new Set([...(p.dashHidden || []), id])] })); toast('Removed. Bring it back anytime from Customize home.'); };
  // only the cards this person can see and has not removed; the width is shared out so the row never has a hole
  const cards = dashItems(me).filter((x) => x.group === 'card' && !hidden.includes(x.id)).sort((a, b) => pos(order, a.id) - pos(order, b.id));
  const anyStat = dashItems(me).some((x) => x.group === 'stat' && !hidden.includes(x.id));
  if (!cards.length && !anyStat) return null;
  const spans = SPANS[Math.min(Math.max(cards.length, 1), 5)];
  return (
    <section className="dash">
      <StatCards me={me} go={go} hidden={hidden} order={order} onHide={hide} />
      <div className="dgrid">
        {cards.map((x, i) => <x.C key={x.id} me={me} go={go} span={spans[i]} onHide={() => hide(x.id)} />)}
      </div>
    </section>
  );
}
