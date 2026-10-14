// ONE list of everything the assistant (and the MCP endpoint) can do.
// Add a module: write ai/tools-<module>.js and spread its array into TOOLS below.
import { leaveTools } from './tools-leave.js';
import { adminTools } from './tools-admin.js';
import { schoolTools } from './tools-school.js';
import { attendanceTools } from './tools-attendance.js';
import { academicsTools } from './tools-academics.js';
import { feesTools } from './tools-fees.js';
import { communicationTools } from './tools-communication.js';
import { documentTools } from './tools-documents.js';
import { payrollExtraTools } from './tools-payroll-extra.js';
import { makeApi } from './loopback.js';
import { todayIn } from './tools-leave.js';

// Tools are grouped so the assistant only sends Gemini the groups a message needs (a big saving:
// all tools together are ~11k tokens). `words` = what in a message loads the group; the model can
// also load a group itself with the enable_tools helper (see chat.js).
export const GROUPS = {
  admin:         { about: 'create / edit schools, users (teachers, students, parents), classes', tools: adminTools, words: /school|user|teacher|student|parent|staff|class|account|password|login|admin|shikshak|sikshak|vidyarthi|bachch|kaksha/i },
  school:        { about: 'school settings, holiday calendar, promotion, activate / deactivate / delete users, visitors, audit log', tools: schoolTools, words: /holiday|calendar|promot|visitor|audit|activity|session|setting|deactivat|activate|delete|remove|graduat|rename|tyohar/i },
  attendance:    { about: 'student attendance (mark, view, reports)', tools: attendanceTools, words: /attend|present|absent|\blate\b|\broll|hazri|hajri|upasthit/i },
  academics:     { about: 'subjects, exams, marks, results, timetable', tools: academicsTools, words: /\bmarks?\b|exam|result|grade|subject|timetable|time table|\btest\b|report card|score|percent|pariksha|natija/i },
  fees:          { about: 'student fees, payments, receipts, discounts', tools: feesTools, words: /\bfees?\b|payment|\bpaid\b|receipt|pending|\bdue\b|discount|balance|collect|cash|upi|cheque|shulk|paisa|rupee|\brs\b/i },
  communication: { about: 'notices / announcements and messages', tools: communicationTools, words: /notice|announce|message|circular|broadcast|inbox|suchna|soochna|sandesh/i },
  documents:     { about: 'user documents (certificates, ID proofs, files)', tools: documentTools, words: /document|certificate|\bfile|aadhaar|aadhar|marksheet|id card|upload|download|dastavez|\bpdf/i },
  payroll:       { about: 'my leave, leave approvals, salary, payroll, payslips', tools: [...leaveTools, ...payrollExtraTools], words: /leave|salary|payroll|payslip|advance|bonus|deduct|chutti|chhutti|tankhwah|tankha|vetan|\bsick\b|\bcasual\b|\bctc\b/i },
};
export const TOOLS = Object.entries(GROUPS).flatMap(([group, g]) => g.tools.map((t) => { t.group = group; return t; }));

// safety net for developers: a duplicate name would silently shadow another tool
const names = TOOLS.map((t) => t.name);
const dup = names.find((n, i) => names.indexOf(n) !== i);
if (dup) throw new Error(`Duplicate AI tool name: ${dup}`);
const byName = new Map(TOOLS.map((t) => [t.name, t]));
export const getTool = (name) => byName.get(name);

// A tool is visible when it has no feature list, or the user holds at least one of its features.
// (The API route behind it checks again - this only decides what the AI is told exists.)
export const canUse = (user, tool) => (!tool.roles || tool.roles.includes(user.role)) && (!tool.features.length || tool.features.some((f) => user.features.includes(f)));
export const visibleTools = (user) => (user.features.includes('use_assistant') ? TOOLS.filter((t) => canUse(user, t)) : []);

export const makeCtx = (user, token) => ({ user, api: makeApi(token), today: todayIn() });

// Gemini function declarations (OpenAPI-style subset)
export const geminiDeclarations = (tools) => tools.map((t) => ({
  name: t.name, description: t.description + (t.confirm ? ' [needs the user to press Confirm]' : ''),
  ...(Object.keys(t.parameters.properties).length ? { parameters: t.parameters } : {}),
}));

// MCP tool descriptors (JSON schema). Confirm-tools get an explicit `confirmed` flag.
export const mcpDescriptors = (tools) => tools.map((t) => ({
  name: t.name, description: t.description,
  inputSchema: t.confirm
    ? { ...t.parameters, properties: { ...t.parameters.properties, confirmed: { type: 'boolean', description: 'Set true ONLY after the user explicitly agreed to this exact action' } } }
    : t.parameters,
}));

const fail = (e) => ({ ok: false, error: e.message || String(e), status: e.status || 500 });

// Runs a tool for a user. Returns { ok, result } or { ok:false, error }.
export async function runTool(ctx, name, args = {}) {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  if (!ctx.user.features.includes('use_assistant') || !canUse(ctx.user, tool)) return { ok: false, status: 403, error: "You don't have access to this action" };
  try { return { ok: true, result: await tool.run(ctx, args) }; } catch (e) { return fail(e); }
}

// For tools that need a confirmation: validate + describe, without doing anything yet.
export async function prepareTool(ctx, name, args = {}) {
  const tool = getTool(name);
  if (!tool || !ctx.user.features.includes('use_assistant') || !canUse(ctx.user, tool)) return { ok: false, status: 403, error: "You don't have access to this action" };
  try { return { ok: true, ...(await tool.prepare(ctx, args)) }; } catch (e) { return fail(e); }
}
