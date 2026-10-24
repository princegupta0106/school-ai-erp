// Mirrors client/src/registry.js. A module is "live" when its views have a component; others show a placeholder.
import MyLeave from './screens/MyLeave';
import LeaveRequests from './screens/LeaveRequests';
import Balances from './screens/Balances';
import Payroll from './screens/Payroll';
import PaySettings from './screens/PaySettings';
import ComingSoon from './screens/ComingSoon';
import NoticeBoard from './screens/NoticeBoard';
import Messages from './screens/Messages';
import SendNotification from './screens/SendNotification';
import { TakeAttendance, AttendanceReports, RollNumbers, ClassTeachers } from './screens/Attendance';
import { MyMarks, TestsAndMarks, AcademicReports, ExamManager, SubjectManager } from './screens/Academics';
import { MyFees, StudentFees, FeeStructure } from './screens/Fees';
import { UserList, UserAdd, ClassManager } from './screens/Users';
import { IssueDocument, IssuedList, Templates, Letterhead, MyDocuments } from './screens/Documents';
import { MyHomework, Homework } from './screens/Homework';
import { VisitorList, AddVisitor } from './screens/Visitors';
import { AuditLogs } from './screens/Audit';
import { Backup } from './screens/Backup';
import { SchoolList, SchoolNew, Calendar, Promotion } from './screens/School';
import { prevMonth } from './theme';

const soon = (v) => ({ ...v, component: ComingSoon });

export const MODULE_UI = {
  school: { label: 'School', color: '#0d9488', icon: 'school', views: [
    { key: 'list', label: 'Schools', need: ['get_school', 'edit_school'], component: SchoolList },
    { key: 'new', label: 'Create school', need: ['create_school'], component: SchoolNew },
    { key: 'calendar', label: 'Sessions & holidays', need: ['get_calendar', 'manage_calendar'], component: Calendar },
    { key: 'promote', label: 'Promotion', need: ['promote_students'], component: Promotion }] },
  users: { label: 'Users', color: '#4f46e5', icon: 'users', views: [
    { key: 'list', label: 'Users', component: UserList },
    { key: 'add', label: 'Add user', need: ['create_user'], component: UserAdd },
    { key: 'classes', label: 'Classes', need: ['edit_user'], component: ClassManager }] },
  attendance: { label: 'Attendance', color: '#0891b2', icon: 'attendance', views: [
    { key: 'take', label: 'Take attendance', need: ['mark_attendance', 'view_attendance_reports'], component: TakeAttendance },
    { key: 'reports', label: 'Reports', need: ['view_attendance_reports'], component: AttendanceReports },
    { key: 'rolls', label: 'Roll numbers', need: ['manage_roll_numbers'], component: RollNumbers },
    { key: 'teachers', label: 'Class teachers', need: ['manage_class_teachers'], component: ClassTeachers }] },
  visitors: { label: 'Visitors', color: '#7c3aed', icon: 'users', views: [
    { key: 'list', label: 'Visitors', need: ['view_visitors'], component: VisitorList },
    { key: 'add', label: 'Add visitor', need: ['add_visitor'], component: AddVisitor }] },
  fees: { label: 'Fees', color: '#059669', icon: 'rupee', views: [
    { key: 'my', label: 'My fees', need: ['view_my_fees'], component: MyFees },
    { key: 'students', label: 'Student fees', need: ['view_student_fees', 'collect_fees', 'adjust_fees'], component: StudentFees },
    { key: 'structure', label: 'Fee structure', need: ['manage_fee_structure'], component: FeeStructure }] },
  communication: { label: 'Communication', color: '#e11d48', icon: 'megaphone', views: [
    { key: 'board', label: 'Notice board', need: ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'], component: NoticeBoard },
    { key: 'messages', label: 'Messages', need: ['use_messages'], component: Messages },
    { key: 'notify', label: 'Send notification', need: ['send_notification', 'send_school_notification'], component: SendNotification }] },
  academics: { label: 'Academics', color: '#2563eb', icon: 'academics', views: [
    { key: 'my', label: 'My marks', need: ['view_my_academics'], roles: ['student', 'parent'], component: MyMarks },
    { key: 'tests', label: 'Tests & marks', need: ['manage_assessments', 'view_academic_reports'], component: TestsAndMarks },
    { key: 'reports', label: 'Reports', need: ['view_academic_reports'], component: AcademicReports },
    { key: 'exams', label: 'Exams', need: ['manage_exams'], component: ExamManager },
    { key: 'subjects', label: 'Subjects', need: ['manage_subjects'], component: SubjectManager }] },
  payroll: { label: 'Payroll & Leave', color: '#d97706', icon: 'wallet', views: [
    { key: 'my', label: 'My leave & pay', need: ['my_leave'], component: MyLeave },
    { key: 'requests', label: 'Leave requests', need: ['leave_approve', 'leave_view_all'], component: LeaveRequests },
    { key: 'balances', label: 'Balances & grants', need: ['leave_view_all', 'leave_grant', 'leave_approve'], component: Balances },
    { key: 'payroll', label: 'Payroll', need: ['payroll_view', 'payroll_manage'], component: Payroll },
    { key: 'settings', label: 'Leave rules', need: ['payroll_settings'], component: PaySettings }] },
  documents: { label: 'Documents', color: '#65a30d', icon: 'doc', views: [
    { key: 'issue', label: 'Issue document', need: ['issue_documents'], component: IssueDocument },
    { key: 'issued', label: 'Issued documents', need: ['view_issued_documents', 'issue_documents'], component: IssuedList },
    { key: 'templates', label: 'Templates & designs', need: ['manage_doc_templates'], component: Templates },
    { key: 'letterhead', label: 'School letterhead', need: ['manage_doc_templates'], component: Letterhead },
    { key: 'my', label: 'My documents', need: ['view_my_documents'], component: MyDocuments }] },
  homework: { label: 'Homework', color: '#c026d3', icon: 'file', views: [
    { key: 'my', label: 'My homework', need: ['view_my_homework'], roles: ['student'], component: MyHomework },
    { key: 'manage', label: 'Homework', need: ['manage_homework'], component: Homework }] },
  audit: { label: 'Audit logs', color: '#475569', icon: 'shield', views: [
    { key: 'log', label: 'Activity log', need: ['view_audit_logs'], component: AuditLogs }] },
  backup: { label: 'Backup', color: '#0369a1', icon: 'download', views: [
    { key: 'backup', label: 'Backup & restore', need: ['manage_backups'], component: Backup }] },
};

// Safety net for a server that is older than this app: add the permissions every role gets by default on the current
// server, so their screens still show up (a screen on an old server then says the server needs updating).
const MIRROR = { student: ['view_my_homework'], staff: ['manage_homework'], school_admin: ['manage_homework', 'send_notification', 'send_school_notification'], super_admin: ['manage_homework', 'send_notification', 'send_school_notification'] };
export const withClientDefaults = (me) => ({ ...me, features: [...new Set([...(me.features || []), ...(MIRROR[me.role] || [])])] });

// Modules this person can open, worked out from the features they hold (me.features) rather than only trusting the
// server's `modules` list - so a module like Homework appears as soon as the person holds one of its features.
// A module counts only if at least one view that *requires* a feature is satisfied (views without `need` don't count).
export function visibleModules(me) {
  const feats = me.features || []; const fromServer = new Map((me.modules || []).map((m) => [m.key, m]));
  const out = [];
  for (const key of Object.keys(MODULE_UI)) {
    const byFeature = MODULE_UI[key].views.some((v) => v.need && v.need.some((f) => feats.includes(f)) && (!v.roles || v.roles.includes(me.role)));
    if (byFeature || fromServer.has(key)) out.push(fromServer.get(key) || { key, label: MODULE_UI[key].label });
  }
  return out;
}

// which modules sit in the bottom bar (3 slots) - the ones each role uses daily come first
const DOCK_FIRST = { student: ['homework', 'academics', 'communication'], parent: ['fees', 'academics', 'communication'], staff: ['attendance', 'homework', 'communication'] };
export function dockModules(me, shown) {
  const first = DOCK_FIRST[me.role] || [];
  const rank = (m) => { const i = first.indexOf(m.key); return i === -1 ? 99 : i; };
  return [...shown].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

export const viewsFor = (me, key) => (MODULE_UI[key]?.views || []).filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role)));

// one-tap actions that can be pinned (same ids as the web app, so pins sync)
export const ACTIONS = [{ id: 'payroll/my/apply', label: 'Apply for leave', icon: 'plus', need: ['my_leave'], base: 'payroll/my' }];

export function allTargets(me) {
  const out = [];
  for (const m of visibleModules(me)) {
    const ui = MODULE_UI[m.key]; if (!ui) continue;
    for (const v of viewsFor(me, m.key)) {
      out.push({ id: `${m.key}/${v.key}`, label: v.label, module: m.key, moduleLabel: ui.label, icon: ui.icon, color: ui.color });
      for (const a of ACTIONS) if (a.base === `${m.key}/${v.key}` && a.need.some((f) => me.features.includes(f))) out.push({ id: a.id, label: a.label, module: m.key, moduleLabel: ui.label, icon: a.icon, color: ui.color, action: true });
    }
  }
  return out;
}
const SMART_DEFAULTS = ['homework/my', 'homework/manage', 'payroll/my/apply', 'attendance/take', 'communication/board', 'fees/students', 'academics/tests'];
export const effectiveShortcuts = (prefs, targets) => {
  const ids = new Set(targets.map((t) => t.id));
  return (prefs.shortcuts ?? SMART_DEFAULTS.filter((id) => ids.has(id)).slice(0, 4)).filter((id) => ids.has(id));
};

// URLs each live screen reads first (must match the screens exactly) so they can be fetched before the tab is opened.
// Only for people fixed to one school; a super admin picks a school first.
export function prefetchUrls(me, mKey, vKey) {
  if (!me.school_id || me.role === 'super_admin') return [];
  if (mKey === 'school') return vKey === 'list' ? ['/schools'] : vKey === 'calendar' ? [`/calendar/sessions?school_id=${me.school_id}`, `/calendar/holidays?school_id=${me.school_id}`] : [];
  if (mKey === 'users') { const ok = me.features.some((f) => ['get_all_users_school', 'get_user', 'create_user', 'edit_user'].includes(f)); return vKey === 'list' ? [...(me.features.includes('get_all_users_school') ? ['/users'] : []), ...(ok ? ['/classes'] : [])] : ok ? ['/classes'] : []; }
  if (mKey === 'documents') return vKey === 'my' ? ['/documents/my'] : vKey === 'issued' ? ['/documents/issued?page=0'] : vKey === 'issue' ? ['/documents/meta'] : [];
  if (mKey === 'audit') return ['/audit'];
  if (mKey === 'visitors') return vKey === 'list' ? ['/visitors'] : [];
  if (mKey === 'homework') return vKey === 'my' ? ['/homework/my'] : vKey === 'manage' ? ['/homework/assignments'] : [];
  if (mKey === 'fees') return vKey === 'my' ? ['/fees/my'] : vKey === 'students' ? ['/fees/students', '/fees/classes'] : vKey === 'structure' ? ['/fees/structure'] : [];
  if (mKey === 'academics') return vKey === 'my' ? (me.role === 'student' ? [`/academics/my?student_id=${me.user_id}`] : ['/users/my-children']) : vKey === 'tests' ? ['/academics/meta', '/academics/assessments'] : ['/academics/meta'];
  if (mKey === 'attendance') return vKey === 'teachers' ? ['/attendance/teachers'] : ['/attendance/classes'];
  if (mKey === 'communication') return vKey === 'board' ? ['/communication/announcements'] : vKey === 'messages' ? ['/communication/conversations'] : [];
  if (mKey !== 'payroll') return [];
  const has = (f) => me.features.includes(f); const pm = prevMonth();
  if (vKey === 'my') return ['/payroll/me'];
  if (vKey === 'requests') return ['/payroll/leave?status=pending', '/payroll/settings', ...(has('leave_approve') ? ['/payroll/employees'] : [])];
  if (vKey === 'balances') return ['/payroll/balances', '/payroll/settings'];
  if (vKey === 'payroll') return [`/payroll/payslips?period=${pm}`, `/payroll/adjustments?period=${pm}`, '/payroll/employees', ...(has('payroll_manage') ? ['/payroll/audit'] : [])];
  if (vKey === 'settings') return ['/payroll/settings'];
  return [];
}
