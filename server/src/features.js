// A feature may carry `roles`: only those roles can ever hold it, whatever is ticked on a profile.
// (adjust_fees is admin-only; view_my_fees is for parents / students only.)
const ADMINS = ['super_admin', 'school_admin'];
const FAMILY = ['parent', 'student'];

// ONE place that defines modules and their features (= permission names).
// A user sees a module if they hold at least one of its features.
// Later modules (leave, fees...) just add an entry here.
export const MODULES = {
  school: {
    label: 'School',
    features: {
      create_school: { label: 'Create school (+ its admin)', superOnly: true },
      get_school: { label: 'View school' },
      edit_school: { label: 'Edit school' },
      get_calendar: { label: 'View sessions & holidays' },
      manage_calendar: { label: 'Manage sessions & holidays' },
      promote_students: { label: 'End session & promote students' },
    },
  },
  users: {
    label: 'Users',
    features: {
      create_user: { label: 'Create user' },
      edit_user: { label: 'Edit user profile' },
      delete_user: { label: 'Delete user' },
      get_user: { label: 'View one user' },
      get_all_users_school: { label: 'List all users of school' },
      reset_pass: { label: 'Reset password' },
      change_role: { label: 'Change role' },
      change_features: { label: 'Change feature access' },
      manage_salary: { label: 'See & edit salary' },
      upload_document: { label: 'Upload / remove documents' },
    },
  },
  attendance: {
    label: 'Attendance',
    features: {
      mark_attendance: { label: 'Take & edit student attendance' },
      view_attendance_reports: { label: 'View attendance reports' },
      attendance_all_classes: { label: 'Access every class (not only assigned ones)' },
      edit_past_attendance: { label: 'Edit attendance of earlier dates' },
      manage_class_teachers: { label: 'Assign teachers to classes' },
      manage_roll_numbers: { label: 'Assign roll numbers' },
    },
  },
  visitors: {
    label: 'Visitors',
    features: {
      add_visitor: { label: 'Add visitor entry' },
      view_visitors: { label: 'View visitors (any day)' },
      delete_visitor: { label: 'Delete visitor entry' },
    },
  },
  queries: {
    label: 'Queries',
    features: {
      add_query: { label: 'Record a query / enquiry (admission, general, internal ...)' },
      view_queries: { label: 'See all queries of the school' },
      update_query: { label: 'Change query status & add notes' },
      delete_query: { label: 'Delete a query' },
      manage_query_settings: { label: 'Manage query forms & statuses' },
    },
  },
  fees: {
    label: 'Fees',
    features: {
      manage_fee_structure: { label: 'Define & edit the fee structure (fees per class, payment terms)' },
      view_student_fees: { label: 'View a student\'s pending fees, payments & receipts' },
      collect_fees: { label: 'Record fee payments' },
      adjust_fees: { label: 'Adjust a student\'s fees (discount / extra charge)', roles: ADMINS },
      cancel_fee_payment: { label: 'Cancel a wrongly recorded payment', roles: ADMINS },
      view_my_fees: { label: 'See own / own children\'s fees & download receipts', roles: FAMILY },
    },
  },
  communication: {
    label: 'Communication',
    features: {
      view_announcements: { label: 'See the notice board' },
      post_announcement: { label: 'Post notices to classes' },
      post_school_announcement: { label: 'Post notices to the whole school' },
      manage_announcements: { label: 'Edit / delete any notice (and see all notices)' },
      use_messages: { label: 'Send & receive 1-to-1 messages' },
      message_anyone: { label: 'Start a chat with anyone in the school' },
      send_notification: { label: 'Send push notifications to classes (students, parents, teachers)' },
      send_school_notification: { label: 'Send push notifications to the whole school' },
    },
  },
  academics: {
    label: 'Academics',
    features: {
      manage_subjects: { label: 'Add, edit & delete subjects' },
      manage_exams: { label: 'Create exams (Half-yearly, Final...)' },
      manage_assessments: { label: 'Create tests / exam papers & enter marks' },
      view_academic_reports: { label: 'View class & student academic reports' },
      academics_all_classes: { label: 'Access every class (not only assigned ones)' },
      view_my_academics: { label: 'See own / children\'s marks' },
    },
  },
  documents: {
    label: 'Documents',
    features: {
      manage_doc_templates: { label: 'Edit certificate wording, designs & school letterhead' },
      issue_documents: { label: 'Issue certificates & report cards (bonafide, character, transfer, ...)' },
      view_issued_documents: { label: 'See every issued document' },
      cancel_document: { label: 'Cancel a wrongly issued document', roles: ADMINS },
      view_my_documents: { label: 'See own / own children\'s documents' },
    },
  },
  homework: {
    label: 'Homework & Assignments',
    features: {
      manage_homework: { label: 'Post homework / assignments / study files and check student submissions' },
      view_my_homework: { label: 'See homework & submit assignments', roles: ['student'] },
    },
  },
  assistant: {
    label: 'AI assistant',
    features: {
      use_assistant: { label: 'Use the AI assistant (it can only do what this person is already allowed to do)' },
    },
  },
  audit: {
    label: 'Audit logs',
    features: {
      view_audit_logs: { label: 'View the audit log (who did what, when) of the school', roles: ADMINS },
    },
  },
  backup: {
    label: 'Backup & restore',
    features: {
      manage_backups: { label: 'Create, download & restore backups of the school (database + files)', roles: ['school_admin'] },
    },
  },
  payroll: {
    label: 'Payroll & Leave',
    features: {
      my_leave: { label: 'My leave, balances & payslips (employee self-service)' },
      leave_approve: { label: 'Approve / reject leave requests' },
      leave_view_all: { label: 'See everyone\'s leave & balances' },
      leave_grant: { label: 'Grant / adjust leave balances' },
      payroll_view: { label: 'View payroll & payslips of all staff' },
      payroll_manage: { label: 'Run payroll: bonus, deductions, finalize, mark paid' },
      payroll_settings: { label: 'Leave types, approval mode & pay rules' },
    },
  },
};

// features everyone of a role gets without being ticked (parents / students can read notices, parents and staff can chat)
export const ROLE_DEFAULTS = {
  parent: ['view_announcements', 'use_messages', 'view_my_fees', 'view_my_academics', 'view_my_documents'],
  student: ['view_announcements', 'view_my_academics', 'view_my_documents', 'view_my_homework'],
  staff: ['view_announcements', 'use_messages', 'my_leave', 'view_my_documents', 'use_assistant', 'manage_homework'],
  other: ['my_leave', 'view_my_documents', 'use_assistant'], // every employee gets leave & payslip self-service
};

export const ROLES = ['super_admin', 'school_admin', 'parent', 'staff', 'student', 'other'];
export const ALL_FEATURES = Object.values(MODULES).flatMap((m) => Object.keys(m.features));
export const SUPER_ONLY = ALL_FEATURES.filter((f) => Object.values(MODULES).some((m) => m.features[f]?.superOnly));
const featureDef = (f) => Object.values(MODULES).map((m) => m.features[f]).find(Boolean);
// can a person of this role ever hold this feature?
export const allowedForRole = (role, f) => { const r = featureDef(f)?.roles; return !r || r.includes(role); };
export const ADMIN_DEFAULTS = ALL_FEATURES.filter((f) => !SUPER_ONLY.includes(f) && allowedForRole('school_admin', f));

// what the user can really do right now
export function effectiveFeatures(user) {
  if (user.role === 'super_admin') return ALL_FEATURES.filter((f) => allowedForRole('super_admin', f));
  if (user.role === 'school_admin') return [...ADMIN_DEFAULTS]; // always everything, incl. future features
  const own = [...(user.profile?.features_permission || []), ...(ROLE_DEFAULTS[user.role] || [])];
  return [...new Set(own)].filter((f) => ALL_FEATURES.includes(f) && !SUPER_ONLY.includes(f) && allowedForRole(user.role, f));
}

export function modulesFor(features) {
  return Object.entries(MODULES)
    .map(([key, m]) => ({ key, label: m.label, features: Object.keys(m.features).filter((f) => features.includes(f)) }))
    .filter((m) => m.features.length);
}

export const catalog = () =>
  Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, {
    label: m.label,
    features: Object.entries(m.features).map(([key, v]) => ({ key, label: v.label, superOnly: !!v.superOnly, roles: v.roles || null })),
  }]));
