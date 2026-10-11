// Every module on the dashboard is declared here. To add a module later:
// add its features in server/src/features.js, then add an entry below.
import { prefetch } from './cache.js';
import { SchoolList, SchoolNew, Calendar, Promotion } from './modules/SchoolModule.jsx';
import { UserList, UserAdd, ClassManager } from './modules/UsersModule.jsx';
import { TakeAttendance, AttendanceReports, ClassTeachers, RollNumbers } from './modules/AttendanceModule.jsx';

import { AddVisitor, VisitorList } from './modules/VisitorsModule.jsx';
import { NoticeBoard, Messages } from './modules/CommunicationModule.jsx';
import { FeeStructure, StudentFees, MyFees } from './modules/FeesModule.jsx';
import { TestsAndMarks, AcademicReports, SubjectManager, ExamManager, MyMarks } from './modules/AcademicsModule.jsx';
import { MyLeave, LeaveRequests, Balances, Payroll, PaySettings } from './modules/PayrollModule.jsx';
import { AuditLogs } from './modules/AuditModule.jsx';
import { IssueDocument, IssuedList, MyDocuments, Templates, Letterhead } from './modules/DocumentsModule.jsx';
import { fetchers } from './fetchers.js';

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
      { key: 'list', label: 'Visitors', need: ['view_visitors'], component: VisitorList },
      { key: 'add', label: 'Add visitor', need: ['add_visitor'], component: AddVisitor },
    ],
  },
  fees: {
    label: 'Fees', desc: 'Fee structure per class, pending fees, payments, receipts and adjustments', color: '#059669', icon: 'rupee',
    views: [
      { key: 'my', label: 'My fees', need: ['view_my_fees'], component: MyFees },
      { key: 'students', label: 'Student fees', need: ['view_student_fees', 'collect_fees', 'adjust_fees'], component: StudentFees },
      { key: 'structure', label: 'Fee structure', need: ['manage_fee_structure'], component: FeeStructure },
    ],
  },
  communication: {
    label: 'Communication', desc: 'Notice board for school and classes, and 1-to-1 messages with parents and teachers', color: '#e11d48', icon: 'megaphone',
    views: [
      { key: 'board', label: 'Notice board', need: ['view_announcements', 'post_announcement', 'post_school_announcement', 'manage_announcements'], component: NoticeBoard },
      { key: 'messages', label: 'Messages', need: ['use_messages'], component: Messages },
    ],
  },
  academics: {
    label: 'Academics', desc: 'Subjects, tests, exams and marks - results and performance for teachers, students and parents', color: '#2563eb', icon: 'academics',
    views: [
      { key: 'my', label: 'My marks', need: ['view_my_academics'], roles: ['student', 'parent'], component: MyMarks },
      { key: 'tests', label: 'Tests & marks', need: ['manage_assessments', 'view_academic_reports'], component: TestsAndMarks },
      { key: 'reports', label: 'Reports', need: ['view_academic_reports'], component: AcademicReports },
      { key: 'exams', label: 'Exams', need: ['manage_exams'], component: ExamManager },
      { key: 'subjects', label: 'Subjects', need: ['manage_subjects'], component: SubjectManager },
    ],
  },
  payroll: {
    label: 'Payroll & Leave', desc: 'Leave applications, balances, salary, bonuses and payments', color: '#d97706', icon: 'wallet',
    views: [
      { key: 'my', label: 'My leave & pay', need: ['my_leave'], component: MyLeave },
      { key: 'requests', label: 'Leave requests', need: ['leave_approve', 'leave_view_all'], component: LeaveRequests },
      { key: 'balances', label: 'Balances & grants', need: ['leave_view_all', 'leave_grant', 'leave_approve'], component: Balances },
      { key: 'payroll', label: 'Payroll', need: ['payroll_view', 'payroll_manage'], component: Payroll },
      { key: 'settings', label: 'Leave rules', need: ['payroll_settings'], component: PaySettings },
    ],
  },
  documents: {
    label: 'Documents', desc: 'Bonafide, character, transfer & activity certificates and report cards - print and issue to students and staff', color: '#65a30d', icon: 'doc',
    views: [
      { key: 'issue', label: 'Issue document', need: ['issue_documents'], component: IssueDocument },
      { key: 'issued', label: 'Issued documents', need: ['view_issued_documents', 'issue_documents'], component: IssuedList },
      { key: 'templates', label: 'Templates & designs', need: ['manage_doc_templates'], component: Templates },
      { key: 'letterhead', label: 'School letterhead', need: ['manage_doc_templates'], component: Letterhead },
      { key: 'my', label: 'My documents', need: ['view_my_documents'], component: MyDocuments },
    ],
  },
  audit: {
    label: 'Audit logs', desc: 'A permanent record of who did what and when - for your school (super admin: every school)', color: '#475569', icon: 'shield',
    views: [
      { key: 'log', label: 'Activity log', need: ['view_audit_logs'], component: AuditLogs },
    ],
  },
};
