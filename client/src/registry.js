// Every module on the dashboard is declared here. To add a module later:
// add its features in server/src/features.js, then add an entry below.
import { prefetch, prefetchApi } from './cache.js';
import { api } from './api.js';
import { SchoolList, SchoolNew, Calendar, Promotion } from './modules/SchoolModule.jsx';
import { UserList, UserAdd, ClassManager } from './modules/UsersModule.jsx';
import { TakeAttendance, AttendanceReports, ClassTeachers, RollNumbers } from './modules/AttendanceModule.jsx';

import { AddVisitor, VisitorList } from './modules/VisitorsModule.jsx';
import { NewQuery, QueryList, QuerySettings } from './modules/QueriesModule.jsx';
import { NoticeBoard, Messages, SendNotification } from './modules/CommunicationModule.jsx';
import { FeeStructure, StudentFees, MyFees } from './modules/FeesModule.jsx';
import { ExamStructure, ExamMarks, ExamResults, ExamAnalysis, MyReportCards, SubjectManager } from './modules/ExamModule.jsx';
import { MyLeave, LeaveRequests, Balances, Payroll, PaySettings } from './modules/PayrollModule.jsx';
import { Homework, MyHomework } from './modules/HomeworkModule.jsx';
import { AuditLogs } from './modules/AuditModule.jsx';
import { Backup } from './modules/BackupModule.jsx';
import { IssueDocument, IssuedList, MyDocuments, Templates, Letterhead } from './modules/DocumentsModule.jsx';
import { AdmissionsHome, EnquiryList, Pipeline, AddEnquiry, AdmissionReports } from './modules/AdmissionsModule.jsx';
import { StudentProfile, MyStudentProfile } from './modules/StudentProfileModule.jsx';
import { TransportOverview, Vehicles, Routes, Students as TransportStudents, MyTransport } from './modules/TransportModule.jsx';
import { InventoryHome, Items as InventoryItems, Setup as InventorySetup, Orders as InventoryOrders, IssueItems, InventoryReports } from './modules/InventoryModule.jsx';
import { TimetableHome, TimetableSetup, ClassTimetable, ClassPlan, AutoTimetable, TeacherTimetable, SchoolTimetable, Substitutions, MyTimetable } from './modules/TimetableModule.jsx';
import { fetchers } from './fetchers.js';

// Per-tab prefetch warms what that tab's first screen reads (same URLs the screens use, so they hit the cache).
// Only for people fixed to one school; a super admin picks a school first, so there is nothing to guess.
const own = (me) => me.role !== 'super_admin' && !!me.school_id;
const has = (me, ...f) => f.some((x) => me.features.includes(x));
const INVENTORY_ANY = ['view_inventory', 'manage_inventory', 'manage_purchase_orders', 'issue_inventory'];
const TT_SEE = ['view_timetable', 'manage_timetable', 'manage_timetable_setup', 'manage_substitutions'];
const TRANSPORT_STAFF = ['view_transport', 'manage_transport', 'assign_transport'];

export const MODULE_UI = {
  school: {
    label: 'School', desc: 'School profile, sessions, holidays and year-end promotion', color: '#0d9488', icon: 'school',
    views: [
      { key: 'list', label: 'Schools', need: ['get_school', 'edit_school'], component: SchoolList },
      { key: 'new', label: 'Create school', need: ['create_school'], component: SchoolNew },
      { key: 'calendar', label: 'Sessions & holidays', need: ['get_calendar', 'manage_calendar'], component: Calendar },
      { key: 'promote', label: 'Promotion', need: ['promote_students'], component: Promotion },
    ],
    prefetch: (me) => {
      if (me.features.some((f) => ['get_school', 'edit_school'].includes(f))) prefetch('schools', fetchers.schools);
      if (me.school_id && me.features.some((f) => ['get_calendar', 'manage_calendar', 'promote_students'].includes(f))) {
        prefetch(`sessions:${me.school_id}`, () => fetchers.sessions(me.school_id));
        prefetch(`holidays:${me.school_id}`, () => fetchers.holidays(me.school_id));
      }
    },
  },
  users: {
    label: 'Users', desc: 'Accounts, roles, profiles, documents and access', color: '#4f46e5', icon: 'users',
    views: [
      { key: 'list', label: 'Users', component: UserList },
      { key: 'add', label: 'Add user', need: ['create_user'], component: UserAdd },
      { key: 'classes', label: 'Classes', need: ['edit_user'], component: ClassManager },
    ],
    prefetch: (me) => {
      if (me.features.includes('get_all_users_school')) prefetch('users', fetchers.users);
      if (me.features.some((f) => ['get_all_users_school', 'get_user', 'create_user', 'edit_user'].includes(f))) prefetch('classes', fetchers.classes);
    },
  },
  attendance: {
    label: 'Attendance', desc: 'Take daily student attendance, roll numbers, class teachers and reports', color: '#0891b2', icon: 'attendance',
    views: [
      { key: 'take', label: 'Take attendance', need: ['mark_attendance', 'view_attendance_reports'], component: TakeAttendance },
      { key: 'reports', label: 'Reports', need: ['view_attendance_reports'], component: AttendanceReports },
      { key: 'rolls', label: 'Roll numbers', need: ['manage_roll_numbers'], component: RollNumbers },
      { key: 'teachers', label: 'Class teachers', need: ['manage_class_teachers'], component: ClassTeachers },
    ],
    prefetch: (me) => {
      if (me.school_id && me.features.some((f) => ['mark_attendance', 'view_attendance_reports', 'manage_roll_numbers'].includes(f))) {
        prefetch(`att:classes:${me.school_id}:today`, () => fetchers.attClasses(me.school_id, ''));
      }
    },
  },
  visitors: {
    label: 'Visitors', desc: 'Log visitors with date and time, see any day', color: '#7c3aed', icon: 'users',
    views: [
      { key: 'list', label: 'Visitors', need: ['view_visitors'], component: VisitorList, prefetch: (me) => own(me) && prefetchApi('/visitors') },
      { key: 'add', label: 'Add visitor', need: ['add_visitor'], component: AddVisitor },
    ],
  },
  queries: {
    label: 'Queries', desc: 'Admission enquiries, general and internal queries with status tracking', color: '#d97706', icon: 'chat',
    views: [
      { key: 'list', label: 'Queries', need: ['view_queries', 'add_query'], component: QueryList },
      { key: 'new', label: 'New query', need: ['add_query'], component: NewQuery },
      { key: 'settings', label: 'Forms & statuses', need: ['manage_query_settings'], component: QuerySettings },
    ],
  },
  admissions: {
    label: 'Admissions', desc: 'Enquiries, follow-ups, application stages, admitting students and conversion reports', color: '#16a34a', icon: 'userplus',
    views: [
      { key: 'home', label: 'Overview', need: ['view_enquiries'], component: AdmissionsHome, prefetch: (me) => own(me) && prefetchApi('/admissions/summary') },
      { key: 'list', label: 'Enquiries', need: ['view_enquiries'], component: EnquiryList, prefetch: (me) => own(me) && prefetchApi('/admissions') },
      { key: 'pipeline', label: 'Pipeline', need: ['view_enquiries'], component: Pipeline },
      { key: 'add', label: 'Add enquiry', need: ['add_enquiry'], component: AddEnquiry },
      { key: 'reports', label: 'Reports', need: ['view_admission_reports'], component: AdmissionReports },
    ],
  },
  student_profile: {
    label: 'Student profile', desc: 'The complete 360° picture of a student: attendance, marks, fees, homework, family and documents in one place', color: '#ec4899', icon: 'profile',
    views: [
      { key: 'my', label: 'Student profile', need: ['view_my_student_profile'], roles: ['student', 'parent'], component: MyStudentProfile, prefetch: () => prefetchApi('/student-profile/my') },
      { key: 'students', label: 'Student profiles', need: ['view_student_profile'], component: StudentProfile, prefetch: (me) => own(me) && prefetchApi('/student-profile/search?q=') },
    ],
  },
  transport: {
    label: 'Transport', desc: 'Buses, routes and stops, and which students ride where - with seat counts and document reminders', color: '#f97316', icon: 'bus',
    views: [
      { key: 'my', label: 'My transport', need: ['view_my_transport'], roles: ['student', 'parent'], component: MyTransport, prefetch: () => prefetchApi('/transport/my') },
      { key: 'home', label: 'Overview', need: TRANSPORT_STAFF, component: TransportOverview, prefetch: (me) => own(me) && prefetchApi('/transport/overview') },
      { key: 'vehicles', label: 'Buses', need: TRANSPORT_STAFF, component: Vehicles, prefetch: (me) => own(me) && prefetchApi('/transport/vehicles') },
      { key: 'routes', label: 'Routes & stops', need: TRANSPORT_STAFF, component: Routes, prefetch: (me) => own(me) && prefetchApi('/transport/routes') },
      { key: 'students', label: 'Students', need: TRANSPORT_STAFF, component: TransportStudents, prefetch: (me) => own(me) && prefetchApi('/transport/assignments') },
    ],
  },
  inventory: {
    label: 'Inventory', desc: 'Stores, items, purchase orders, receiving, issuing with receipts and stock reports', color: '#16a34a', icon: 'box',
    views: [
      { key: 'home', label: 'Overview', need: INVENTORY_ANY, component: InventoryHome, prefetch: (me) => own(me) && prefetchApi('/inventory/overview') },
      { key: 'items', label: 'Items & stock', need: ['view_inventory', 'manage_inventory'], component: InventoryItems, prefetch: (me) => own(me) && prefetchApi('/inventory/meta') },
      { key: 'orders', label: 'Purchase orders', need: ['manage_purchase_orders', 'view_inventory'], component: InventoryOrders, prefetch: (me) => own(me) && prefetchApi('/inventory/orders') },
      { key: 'issue', label: 'Issue items', need: ['issue_inventory', 'view_inventory'], component: IssueItems, prefetch: (me) => own(me) && prefetchApi('/inventory/issues') },
      { key: 'setup', label: 'Stores & vendors', need: ['manage_inventory'], component: InventorySetup, prefetch: (me) => own(me) && prefetchApi('/inventory/meta') },
      { key: 'reports', label: 'Reports', need: ['view_inventory', 'issue_inventory'], component: InventoryReports },
    ],
  },
  timetable: {
    label: 'Timetable', desc: 'Set the school day, give teachers their classes and subjects, build class timetables, track workloads and cover absent teachers', color: '#f59e0b', icon: 'calendar',
    views: [
      { key: 'my', label: 'My timetable', need: ['view_my_timetable'], component: MyTimetable, prefetch: () => prefetchApi('/timetable/my') },
      { key: 'home', label: 'Overview & workload', need: TT_SEE, component: TimetableHome, prefetch: (me) => own(me) && prefetchApi('/timetable/workload') },
      { key: 'plan', label: 'Class subjects', need: ['manage_timetable_setup', 'manage_timetable', 'view_timetable'], component: ClassPlan },
      { key: 'class', label: 'Class timetable', need: ['manage_timetable', 'view_timetable'], component: ClassTimetable },
      { key: 'auto', label: 'Auto generate', need: ['manage_timetable'], component: AutoTimetable },
      { key: 'teacher', label: 'Teacher timetable', need: ['manage_timetable', 'view_timetable'], component: TeacherTimetable },
      { key: 'school', label: 'Whole school', need: ['manage_timetable', 'view_timetable'], component: SchoolTimetable },
      { key: 'subs', label: 'Substitutions', need: ['manage_substitutions', 'view_timetable'], component: Substitutions },
      { key: 'setup', label: 'Structure', need: ['manage_timetable_setup'], component: TimetableSetup, prefetch: (me) => own(me) && prefetchApi('/timetable/meta') },
    ],
  },
  fees: {
    label: 'Fees', desc: 'Fee structure per class, pending fees, payments, receipts and adjustments', color: '#059669', icon: 'rupee',
    views: [
      { key: 'my', label: 'My fees', need: ['view_my_fees'], component: MyFees, prefetch: () => prefetchApi('/fees/my') },
      { key: 'students', label: 'Student fees', need: ['view_student_fees', 'collect_fees', 'adjust_fees'], component: StudentFees, prefetch: (me) => { if (own(me)) { prefetchApi('/fees/students'); prefetchApi('/fees/classes'); } } },
      { key: 'structure', label: 'Fee structure', need: ['manage_fee_structure'], component: FeeStructure, prefetch: (me) => own(me) && prefetchApi('/fees/structure') },
    ],
  },
  communication: {
    label: 'Communication', desc: 'Notice board for school and classes, and 1-to-1 messages with parents and teachers', color: '#e11d48', icon: 'megaphone',
    views: [
      { key: 'board', label: 'Notice board', need: ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'], component: NoticeBoard, prefetch: (me) => own(me) && prefetchApi('/communication/announcements') },
      { key: 'messages', label: 'Messages', need: ['use_messages'], component: Messages, prefetch: (me) => me.school_id && prefetchApi('/communication/conversations') },
      { key: 'notify', label: 'Send notification', need: ['send_notification', 'send_school_notification'], component: SendNotification },
    ],
  },
  examinations: {
    label: 'Exams & Report Cards', desc: 'Subjects, exams of each class, marks entry by subject teachers, automatic totals and grades, report cards and performance analysis', color: '#7c3aed', icon: 'academics',
    views: [
      { key: 'my', label: 'Report cards', need: ['view_my_results'], roles: ['student', 'parent'], component: MyReportCards },
      { key: 'structure', label: 'Exams of each class', need: ['manage_exam_structure', 'manage_exam_grading'], component: ExamStructure },
      { key: 'marks', label: 'Enter marks', need: ['manage_exam_marks'], component: ExamMarks },
      { key: 'results', label: 'Results & report cards', need: ['view_exam_results', 'publish_exam_results'], component: ExamResults },
      { key: 'analysis', label: 'Performance analysis', need: ['view_exam_analytics'], component: ExamAnalysis },
      { key: 'subjects', label: 'Subjects', need: ['manage_subjects'], component: SubjectManager },
    ],
  },
  payroll: {
    label: 'Payroll & Leave', desc: 'Leave applications, balances, salary, bonuses and payments', color: '#d97706', icon: 'wallet',
    views: [
      { key: 'my', label: 'My leave & pay', need: ['my_leave'], component: MyLeave, prefetch: (me) => own(me) && prefetchApi('/payroll/me') },
      { key: 'requests', label: 'Leave requests', need: ['leave_approve', 'leave_view_all'], component: LeaveRequests, prefetch: (me) => { if (own(me)) { prefetchApi('/payroll/leave?status=pending'); prefetchApi('/payroll/settings'); if (has(me, 'leave_approve')) prefetchApi('/payroll/employees'); } } },
      { key: 'balances', label: 'Balances & grants', need: ['leave_view_all', 'leave_grant', 'leave_approve'], component: Balances },
      { key: 'payroll', label: 'Payroll', need: ['payroll_view', 'payroll_manage'], component: Payroll },
      { key: 'settings', label: 'Leave rules', need: ['payroll_settings'], component: PaySettings },
    ],
  },
  documents: {
    label: 'Documents', desc: 'Bonafide, character, transfer & activity certificates and report cards - print and issue to students and staff', color: '#65a30d', icon: 'doc',
    views: [
      { key: 'issue', label: 'Issue document', need: ['issue_documents'], component: IssueDocument },
      { key: 'issued', label: 'Issued documents', need: ['view_issued_documents', 'issue_documents'], component: IssuedList, prefetch: (me) => own(me) && prefetchApi('/documents/issued?page=0') },
      { key: 'templates', label: 'Templates & designs', need: ['manage_doc_templates'], component: Templates },
      { key: 'letterhead', label: 'School letterhead', need: ['manage_doc_templates'], component: Letterhead },
      { key: 'my', label: 'My documents', need: ['view_my_documents'], component: MyDocuments, prefetch: () => prefetch('docs:my', () => api.get('/documents/my')) },
    ],
  },
  homework: {
    label: 'Homework', desc: 'Post homework and study files for a class, students download and submit, teachers check', color: '#c026d3', icon: 'file',
    views: [
      { key: 'my', label: 'My homework', need: ['view_my_homework'], roles: ['student'], component: MyHomework, prefetch: () => prefetchApi('/homework/my') },
      { key: 'manage', label: 'Homework', need: ['manage_homework'], component: Homework, prefetch: (me) => own(me) && prefetchApi('/homework/assignments') },
    ],
  },
  audit: {
    label: 'Audit logs', desc: 'A permanent record of who did what and when - for your school (super admin: every school)', color: '#475569', icon: 'shield',
    views: [
      { key: 'log', label: 'Activity log', need: ['view_audit_logs'], component: AuditLogs },
    ],
  },
  backup: {
    label: 'Backup', desc: 'Download a full backup of the school (database + files) and restore it in one click', color: '#0369a1', icon: 'download',
    views: [
      { key: 'backup', label: 'Backup & restore', need: ['manage_backups'], component: Backup },
    ],
  },
};
