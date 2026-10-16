"""Offline test of the VISITORS tools (fake portal + scripted LLM). Run:  python -m unittest test_ai_visitors   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

V1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
V2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
LOG = {"2026-10-16": [{"id": V1, "name": "Ramesh Gupta", "purpose": "Admission enquiry", "visit_date": "2026-10-16", "visit_time": "10:15"}],
       "2026-10-15": [{"id": V2, "name": "Courier", "purpose": None, "visit_date": "2026-10-15", "visit_time": "09:00"}]}
FEATS = {"Bearer admin": ["use_assistant", "view_visitors", "add_visitor", "delete_visitor"], "Bearer guard": ["use_assistant", "add_visitor"], "Bearer teacher": ["use_assistant", "my_leave"]}
CALLS = []


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        f = FEATS.get(self.headers.get("Authorization", ""))
        if f is None: return self._send(401, {"error": "Please sign in"})
        u = urllib.parse.urlsplit(self.path); q = urllib.parse.parse_qs(u.query)
        CALLS.append(("GET", self.path))
        if u.path == "/api/auth/me": return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": "staff", "features": f, "profile": {"full_name": "X"}, "catalog": {}})
        if u.path == "/api/visitors":
            d = (q.get("date") or ["2026-10-16"])[0]
            return self._send(200, {"date": d, "today": "2026-10-16", "now": "11:00", "visitors": LOG.get(d, []) if "view_visitors" in f else []})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        CALLS.append(("POST", self.path, body, self.headers.get("x-via")))
        if self.path == "/api/visitors": return self._send(201, {"id": "c", "name": body["name"], "visit_date": body.get("date", "2026-10-16"), "visit_time": body.get("time", "11:00")})
        self._send(404, {"error": "Not found"})

    def do_DELETE(self):
        CALLS.append(("DELETE", self.path, None, self.headers.get("x-via")))
        self._send(200, {"ok": True})

    def log_message(self, *a): pass


def scripted(steps):
    it = iter(steps)
    return lambda msgs, schemas, system: (lambda s: {"text": s.get("text", ""), "calls": [{"id": f"c{i}", "name": n, "args": a} for i, (n, a) in enumerate(s.get("calls", []))]})(next(it))


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Portal)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        agent.CFG.update(node=f"http://127.0.0.1:{cls.srv.server_port}", provider="velona", gemini_key="x", model="m", school="T")

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def setUp(self): CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear(); agent._AUTH_CACHE.clear()

    def chat(self, tok, steps, auto=False):
        agent.llm = scripted(steps)
        return agent.chat(tok, agent.verify_user(tok), None, "x", auto)

    def out(self, r, i=0):
        return json.loads(agent.CONVS[r["conversation_id"]]["messages"][2]["results"][i]["content"])

    def test_permissions(self):
        self.assertEqual(agent.allowed_tools(agent.verify_user("teacher")) & {"visitors", "add_visitor", "delete_visitor"}, set())
        g = agent.allowed_tools(agent.verify_user("guard"))
        self.assertIn("add_visitor", g); self.assertNotIn("delete_visitor", g); self.assertIn("visitors", g)

    def test_list_today_and_range(self):
        r = self.chat("admin", [{"calls": [("visitors", {}), ("visitors", {"from": "2026-10-15", "to": "2026-10-16"})]}, {"text": "ok"}])
        self.assertEqual(self.out(r, 0)["total"], 1)
        rng = self.out(r, 1); self.assertEqual(rng["total"], 2); self.assertEqual({v["name"] for v in rng["visitors"]}, {"Ramesh Gupta", "Courier"})

    def test_filter_and_bad_input(self):
        r = self.chat("admin", [{"calls": [("visitors", {"from": "2026-10-01", "to": "2026-10-30"}), ("visitors", {"date": "16-10-2026"})]}, {"text": "?"}])
        self.assertIn("14 days", self.out(r, 0)["error"]); self.assertIn("real date", self.out(r, 1)["error"])

    def test_add_needs_confirm_then_posts_via_ai(self):
        r = self.chat("guard", [{"calls": [("add_visitor", {"name": " Sita Devi ", "purpose": "Meet principal", "time": "9:05"})]}])
        self.assertEqual(r["actions"][0]["status"], "pending"); self.assertEqual([c for c in CALLS if c[0] == "POST"], [])
        out = agent.confirm("guard", agent.verify_user("guard"), r["actions"][0]["id"], r["conversation_id"])
        self.assertTrue(out["ok"]); p = [c for c in CALLS if c[0] == "POST"][-1]
        self.assertEqual(p[2], {"name": "Sita Devi", "purpose": "Meet principal", "time": "09:05"}); self.assertEqual(p[3], "ai-assistant")

    def test_add_rejects_bad_time(self):
        r = self.chat("guard", [{"calls": [("add_visitor", {"name": "A", "time": "25:99"})]}, {"text": "?"}])
        self.assertEqual(r["actions"], []); self.assertIn("HH:MM", self.out(r)["error"])

    def test_guard_cannot_delete(self):
        r = self.chat("guard", [{"calls": [("delete_visitor", {"visitor_id": V1})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual([c for c in CALLS if c[0] == "DELETE"], [])

    def test_delete_always_confirms_even_with_auto(self):
        r = self.chat("admin", [{"calls": [("delete_visitor", {"visitor_id": V1})]}], auto=True)
        self.assertEqual(r["actions"][0]["status"], "pending"); self.assertEqual([c for c in CALLS if c[0] == "DELETE"], [])
        agent.confirm("admin", agent.verify_user("admin"), r["actions"][0]["id"], r["conversation_id"])
        self.assertEqual([c[1] for c in CALLS if c[0] == "DELETE"], [f"/api/visitors/{V1}"])

    def test_delete_unknown_entry(self):
        r = self.chat("admin", [{"calls": [("delete_visitor", {"visitor_id": V2})]}, {"text": "?"}])   # V2 is yesterday's: needs its date
        self.assertEqual(r["actions"], []); self.assertIn("not in the list", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("delete_visitor", {"visitor_id": V2, "date": "2026-10-15"})]}])
        self.assertEqual(len(r["actions"]), 1)


if __name__ == "__main__":
    unittest.main()
