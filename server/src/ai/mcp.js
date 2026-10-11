// ---------------------------------------------------------------------------------------------
// MCP server (Model Context Protocol, "Streamable HTTP" in stateless JSON mode) at POST /mcp
//
// Same tools as the in-portal chatbot, so Claude Desktop, Cursor, or any MCP client can use the
// portal. The client sends the person's portal token:   Authorization: Bearer <token from /api/auth/login>
// Everything is checked by the backend as that person - tools/list only shows what they may use,
// and every call goes through the normal API (permissions, school scoping, audit log).
//
// Tools that need confirmation require "confirmed": true, which the client must only send after
// the human agreed to that exact action.
// ---------------------------------------------------------------------------------------------
import { Router } from 'express';
import { visibleTools, getTool, canUse, mcpDescriptors, makeCtx, runTool, prepareTool } from './registry.js';

const r = Router();
const token = (req) => /^Bearer (.+)$/.exec(req.headers.authorization || '')[1];
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const text = (obj, isError = false) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }], isError });

async function handle(req, msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return null; // notification (e.g. notifications/initialized): no reply
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: params.protocolVersion || '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'school-portal', version: '1.0.0' },
        instructions: 'Tools act on the school portal as the signed-in person. Dates are YYYY-MM-DD; "today"/"tomorrow" are accepted.',
      } };
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: mcpDescriptors(visibleTools(req.user)) } };
    case 'tools/call': {
      const tool = getTool(params.name);
      if (!tool || !canUse(req.user, tool) || !req.user.features.includes('use_assistant')) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const ctx = makeCtx(req.user, token(req));
      const { confirmed, ...args } = params.arguments || {};
      if (tool.confirm) {
        const prep = await prepareTool(ctx, tool.name, args);
        if (!prep.ok) return { jsonrpc: '2.0', id, result: text(prep.error, true) };
        if (confirmed !== true) return { jsonrpc: '2.0', id, result: text(`NOT DONE YET. Needs the user's explicit approval: ${prep.describe}. Ask the user, then call again with confirmed=true.`) };
        const out = await runTool(ctx, tool.name, prep.args);
        return { jsonrpc: '2.0', id, result: out.ok ? text(out.result) : text(out.error, true) };
      }
      const out = await runTool(ctx, tool.name, args);
      return { jsonrpc: '2.0', id, result: out.ok ? text(out.result) : text(out.error, true) };
    }
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

r.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(req, m)))).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const out = await handle(req, body || {});
    return out ? res.json(out) : res.status(202).end();
  } catch (e) {
    return res.json(rpcError(req.body?.id, -32603, e.message || 'Internal error'));
  }
});
// no server-initiated stream in stateless mode
r.get('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST' }));

export default r;
