// Documents: certificates, report cards, the issued-documents register.
import { httpError } from '../db.js';
import { S, B, obj, withSchool, resolveSchoolId, findStudent, findUser, pickOne, P, norm } from './helpers.js';
import { resolveDate } from './tools-leave.js';

const TYPES = ['bonafide', 'character', 'transfer', 'activity', 'report_card', 'experience', 'custom'];
const STUDENT_ONLY = ['bonafide', 'transfer', 'report_card'];
const STAFF_ONLY = ['experience'];

export const documentTools = [
  {
    name: 'list_document_types',
    description: 'Which documents can be issued (bonafide, character, transfer, activity, report_card, experience, custom) and for whom.',
    features: ['issue_documents', 'view_issued_documents', 'manage_doc_templates'],
    parameters: obj(withSchool({})),
    run: async (ctx, a) => (await ctx.api('GET', P('/documents/meta', { school_id: await resolveSchoolId(ctx, a.school) }))).types.map((t) => `${t.key}: ${t.label} (for ${t.for.join(' / ')})`),
  },
  {
    name: 'issue_document',
    description:
      'Issue a certificate / report card to a student or staff member; it gets a permanent serial number and appears in the register. ' +
      'Details come from the person\'s profile. For report_card give exam_names (and the session defaults to current). For custom give text. The user must confirm first.',
    features: ['issue_documents'],
    confirm: true,
    parameters: obj(withSchool({
      type: S('Document type', { enum: TYPES }), person: S('Student or staff name / login id'),
      purpose: S('Purpose, e.g. "bank account opening" (optional)'), activity: S('Activity / achievement (activity certificate)'),
      remarks: S('Remarks (optional)'), text: S('Full text (custom document only)'), title: S('Title (custom document)'),
      exam_names: { type: 'array', items: { type: 'string' }, description: 'Exams to include (report card)' }, include_tests: B('Include class-test average (report card)'),
    }), ['type', 'person']),
    prepare: async (ctx, a) => {
      if (!TYPES.includes(a.type)) throw httpError(400, `Type must be one of ${TYPES.join(', ')}`);
      const sid = await resolveSchoolId(ctx, a.school);
      let person;
      if (STUDENT_ONLY.includes(a.type)) person = await findStudent(ctx, a.person, sid, ['documents', 'users']);
      else {
        const found = await ctx.api('GET', P('/documents/people', { kind: STAFF_ONLY.includes(a.type) ? 'staff' : 'student', q: a.person, school_id: sid }));
        const all = STAFF_ONLY.includes(a.type) ? found : found.concat(await ctx.api('GET', P('/documents/people', { kind: 'staff', q: a.person, school_id: sid })));
        const p = pickOne(all, a.person, (x) => x.name, 'person', (x) => `${x.role}${x.class_label ? `, ${x.class_label}` : ''}`);
        person = { id: p.id, name: p.name };
      }
      const body = { type: a.type, subject_id: person.id, school_id: sid, title: a.title, body: a.text, fields: { purpose: a.purpose, activity: a.activity, remarks: a.remarks } };
      if (a.type === 'report_card') {
        const meta = await ctx.api('GET', P('/documents/meta', { school_id: sid }));
        const cur = meta.sessions.find((s) => s.is_current);
        const m = await ctx.api('GET', P('/academics/meta', { school_id: sid })).catch(() => { throw httpError(403, 'Report cards need access to exams'); });
        if (!a.exam_names?.length) throw httpError(400, 'Which exams should the report card include?');
        body.report = { session_id: cur?.id, exam_ids: a.exam_names.map((n) => pickOne(m.exams, n, (e) => e.name, 'exam').id), include_tests: !!a.include_tests };
      }
      return { args: body, describe: `Issue a ${a.type.replace('_', ' ')} to ${person.name}${a.purpose ? ` (purpose: ${a.purpose})` : ''}${a.exam_names?.length ? ` with exams ${a.exam_names.join(', ')}` : ''}. It gets a permanent serial number.` };
    },
    run: async (ctx, a) => { const r = await ctx.api('POST', '/documents/issue', a); return { issued: true, serial_no: r.serial_no, title: r.title, to: r.subject_name, note: 'Open Documents > Issued documents in the portal to print / save as PDF.' }; },
  },
  {
    name: 'list_issued_documents',
    description: 'The register of issued documents: search by person name or serial number, filter by type / status.',
    features: ['view_issued_documents', 'issue_documents'],
    parameters: obj(withSchool({ search: S('Name or serial number'), type: S('Document type', { enum: TYPES }), status: S('issued or cancelled', { enum: ['issued', 'cancelled'] }) })),
    run: async (ctx, a) => {
      const r = await ctx.api('GET', P('/documents/issued', { q: a.search, type: a.type, status: a.status, school_id: await resolveSchoolId(ctx, a.school) }));
      return { total: r.total, documents: r.rows.slice(0, 20).map((d) => ({ serial: d.serial_no, type: d.doc_type, title: d.title, to: d.subject_name, status: d.status, issued_at: d.issued_at })) };
    },
  },
  {
    name: 'cancel_document',
    description: 'Cancel a wrongly issued document by serial number (school admin only; it stays in the register). A reason is required. The user must confirm first.',
    features: ['cancel_document'],
    confirm: true,
    parameters: obj(withSchool({ serial_no: S('e.g. BON/2026/0001'), reason: S('Why it is cancelled') }), ['serial_no', 'reason']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const r = await ctx.api('GET', P('/documents/issued', { q: a.serial_no, school_id: sid }));
      const d = r.rows.find((x) => norm(x.serial_no) === norm(a.serial_no));
      if (!d) throw httpError(404, `No document with serial ${a.serial_no}`);
      return { args: { id: d.id, reason: a.reason, school_id: sid }, describe: `CANCEL document ${d.serial_no} (${d.title} for ${d.subject_name}). Reason: ${a.reason}` };
    },
    run: async (ctx, a) => { await ctx.api('POST', `/documents/issued/${a.id}/cancel`, { reason: a.reason, school_id: a.school_id }); return { cancelled: true }; },
  },
  {
    name: 'my_documents',
    description: 'Documents issued to me (or my children).',
    features: ['view_my_documents'],
    parameters: obj({}),
    run: async (ctx) => { const r = await ctx.api('GET', '/documents/my'); const rows = Array.isArray(r) ? r : r.rows || r.documents || []; return rows.slice(0, 20).map((d) => ({ serial: d.serial_no, type: d.doc_type, title: d.title, to: d.subject_name, status: d.status })); },
  },
];
void findUser; void resolveDate;
