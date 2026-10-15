"""Offline test: a fake portal (HTTP) + a scripted LLM. Run:  python -m unittest test_ai   (from ai-server/)"""
import http.server, json, threading, unittest
import agent

CLASSES = [{"id": "c1" + "0" * 34, "school_id": "s1", "name": "5", "section": "A"}]
USERS = [
    {"user_id": "11111111-1111-1111-1111-111111111111", "login_id": "sumit.pal", "role": "student", "is_active": True, "school_id": "s1", "profile": {"full_name": "Sumit Pal", "class_id": CLASSES[0]["id"], "roll_no": 3}},
    {"user_id": "22222222-2222-2222-2222-222222222222", "login_id": "sumeet.shah", "role": "staff", "is_active": True, "school_id": "s1", "profile": {"full_name": "Sumeet Shah", "designation": "Maths"}},
]
ADMIN_FEATURES = ["use_assistant", "get_all_users_school", "get_user", "create_user", "edit_user", "reset_pass", "delete_user", "change_role", "change_features"]
CALLS = []


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _who(self):
        t = self.headers.get("Authorization", "")
        return {"Bearer admin": ADMIN_FEATURES, "Bearer teacher": ["use_assistant", "my_leave"]}.get(t)

    def do_GET(self):
        f = self._who()
        if f is None: return self._send(401, {"error": "Please sign in"})
        p = self.path.split("?")[0]
        if p == "/api/auth/me":
            return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "boss", "role": "school_admin", "features": f, "profile": {"full_name": "Boss"}, "catalog": {}})
        if p == "/api/users": return self._send(200, USERS)
        if p == "/api/classes": return self._send(200, CLASSES)
        if p.startswith("/api/users/"):
            u = next((x for x in USERS if p.endswith(x["user_id"]) or p.endswith(x["login_id"])), None)
            return self._send(200, u) if u else self._send(404, {"error": "User not found"})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        CALLS.append((self.command, self.path, body, self.headers.get("x-via")))
        if self.path == "/api/users":
            if body["login_id"] == "taken.one" or body["login_id"] == "rahul.sharma":
                return self._send(409, {"error": "That ID is already taken"})
            return self._send(201, {"user_id": "33333333-3333-3333-3333-333333333333", "login_id": body["login_id"], "role": body["role"], "profile": body["profile"]})
        self._send(404, {"error": "Not found"})

    def log_message(self, *a): pass


def scripted(steps):
    it = iter(steps)
    def llm(msgs, schemas, system):
        s = next(it)
        return {"text": s.get("text", ""), "calls": [{"id": f"c{i}", "name": n, "args": a} for i, (n, a) in enumerate(s.get("calls", []))]}
    return llm


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Portal)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        agent.CFG.update(node=f"http://127.0.0.1:{cls.srv.server_port}", provider="gemini", gemini_key="x", model="m", school="Test School")

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def setUp(self): CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear()

    def test_verify_and_permissions(self):
        self.assertIsNone(agent.verify_user("nope"))
        t = agent.verify_user("teacher")
        self.assertEqual(agent.allowed_tools(t), {"ask_choice"})            # no users permissions -> no real tools
        a = agent.verify_user("admin")
        self.assertIn("create_user", agent.allowed_tools(a)); self.assertNotIn("list_schools", agent.allowed_tools(a))
        self.assertNotIn("school", agent.schemas_for(a)[0]["parameters"]["properties"])     # only a super admin names a school

    def test_ambiguous_search_asks_and_never_prepares(self):
        agent.llm = scripted([{"calls": [("search_users", {"query": "sumit"})]}, {"calls": [("ask_choice", {"question": "Which one?", "options": ["Sumit Pal (student 5 A)", "Sumeet Shah (staff)"]})]}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "turn off sumit", False)
        self.assertEqual(len(r["choices"]), 2); self.assertEqual(r["actions"], [])

    def test_create_user_needs_confirm_then_runs_once_with_via_header(self):
        agent.llm = scripted([{"calls": [("create_user", {"full_name": "Rahul Sharma", "role": "student", "class_name": "5 A"})]}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "create student rahul in 5a", False)
        self.assertEqual(len(r["actions"]), 1); card = r["actions"][0]
        self.assertEqual(card["status"], "pending"); self.assertEqual([c for c in CALLS if c[0] == "POST"], [])   # nothing saved yet
        out = agent.confirm("admin", u, card["id"], r["conversation_id"])
        self.assertTrue(out["ok"]); self.assertIn("Password:", out["message"])
        posts = [c for c in CALLS if c[1] == "/api/users"]
        self.assertEqual(posts[-1][3], "ai-assistant")                       # audit tag header
        self.assertEqual(posts[-1][2]["profile"]["class_id"], CLASSES[0]["id"])
        self.assertRaises(agent.ErpError, agent.confirm, "admin", u, card["id"], r["conversation_id"])  # single use

    def test_login_taken_retries_with_a_new_login(self):
        agent.llm = scripted([{"calls": [("create_user", {"full_name": "Rahul Sharma", "role": "staff"})]}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "add teacher rahul sharma", False)
        out = agent.confirm("admin", u, r["actions"][0]["id"], None)
        self.assertTrue(out["ok"]); self.assertNotIn("Login id: rahul.sharma ", out["message"] + " ")

    def test_tool_not_allowed_for_user_is_blocked(self):
        agent.llm = scripted([{"calls": [("create_user", {"full_name": "X", "role": "staff"})]}, {"text": "Sorry, not allowed."}])
        t = agent.verify_user("teacher")
        r = agent.chat("teacher", t, None, "create a user", False)
        self.assertEqual(r["actions"], []); self.assertEqual([c for c in CALLS if c[0] == "POST"], [])

    def test_other_users_action_id_is_refused(self):
        agent.llm = scripted([{"calls": [("create_user", {"full_name": "Zed Khan", "role": "other"})]}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "add zed", False)
        other = dict(u, id="someone-else")
        self.assertRaises(agent.ErpError, agent.confirm, "admin", other, r["actions"][0]["id"], None)

    def test_cancel_runs_nothing(self):
        agent.llm = scripted([{"calls": [("create_user", {"full_name": "Zed Khan", "role": "other"})]}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "add zed", False)
        self.assertEqual(agent.cancel(u, r["actions"][0]["id"], None)["action"]["status"], "cancelled")
        self.assertEqual([c for c in CALLS if c[0] == "POST"], [])

    def test_counts(self):
        agent.llm = scripted([{"calls": [("list_users", {"role": "staff"})]}, {"text": "1 teacher"}])
        u = agent.verify_user("admin")
        r = agent.chat("admin", u, None, "how many teachers", False)
        self.assertEqual(r["reply"], "1 teacher")


if __name__ == "__main__":
    unittest.main()
