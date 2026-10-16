"""School ERP AI service (Users module).   Run:  python server.py     (run.bat starts it for you)

A tiny local HTTP server that holds the AI keys. The web app never talks to it directly: the Node
server forwards /api/ai/chat, /api/ai/confirm and /api/ai/cancel here (after checking the
`use_assistant` permission) together with the person's sign-in token.
It reads ../.env (the same file as the portal) and listens on 127.0.0.1:AI_PORT (default 8001).
Only standard-library Python is needed."""
import http.server, json, os, socketserver
import agent

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load_env():
    env = {}
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive between the Node server and this one
    timeout = 120
    disable_nagle_algorithm = True

    def _json(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            return self._json(200, agent.status())
        self.send_error(404)

    def do_POST(self):
        p = self.path.split("?")[0]
        if p not in ("/api/chat", "/api/confirm", "/api/cancel"):
            return self.send_error(404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 100_000:
                return self._json(413, {"error": "Too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"error": "Bad request"})
        token = (self.headers.get("Authorization") or "").replace("Bearer ", "", 1).strip()
        user = agent.verify_user(token) if token else None
        if not user:
            return self._json(401, {"error": "Please sign in again."})
        if "use_assistant" not in (user.get("features") or []):
            return self._json(403, {"error": "You don't have access to the assistant."})
        try:
            if p == "/api/chat":
                out = agent.chat(token, user, body.get("conversation_id"), body.get("message"), bool(body.get("auto_confirm")), body.get("attachments"))
            elif p == "/api/confirm":
                out = agent.confirm(token, user, body.get("action_id"), body.get("conversation_id"))
            else:
                out = agent.cancel(user, body.get("action_id"), body.get("conversation_id"))
            self._json(200, out)
        except agent.ErpError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:
            print("[ai] error:", repr(e))
            self._json(500, {"error": "Something went wrong. Please try again."})

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64


if __name__ == "__main__":
    env = load_env()
    agent.init(env)
    on_render = bool(os.environ.get("RENDER"))      # Render sets RENDER and PORT itself
    host = "0.0.0.0" if on_render else (os.environ.get("AI_HOST") or env.get("AI_HOST") or "127.0.0.1")
    port = int(os.environ.get("PORT") or 10000) if on_render else int(os.environ.get("AI_PORT") or env.get("AI_PORT") or 8001)
    st = agent.status()
    print("[ai] assistant:", f"{st['provider']} / {st['model']}" if st["configured"] else "NOT configured (add VELONA_API_KEY (or ANTHROPIC_API_KEY) to .env)")
    with Server((host, port), Handler) as srv:
        print(f"[ai] School ERP AI service on http://{host}:{port}  (portal: {agent.CFG['node']})")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("Stopped.")
