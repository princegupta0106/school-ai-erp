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

export const TOOLS = [
  ...adminTools,      // schools, users, classes
  ...schoolTools,     // school settings, calendar, promotion, user management, visitors, audit log
  ...attendanceTools,
  ...academicsTools,
  ...feesTools,
  ...communicationTools,
  ...documentTools,
  ...leaveTools,      // payroll & leave
  ...payrollExtraTools,
];

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
