"""Offline test of the FEES tools: a fake portal (HTTP) + a scripted LLM. Run:  python -m unittest test_ai_fees   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

S1 = "11111111-1111-1111-1111-111111111111"
S2 = "22222222-2222-2222-2222-222222222222"
PAY = "55555555-5555-5555-5555-555555555555"
ADJ = "66666666-6666-6666-6666-666666666666"
ITEM = "77777777-7777-7777-7777-777777777777"
STUDENTS = [
    {"student_id": S1, "full_name": "Sumit Pal", "login_id": "sumit.pal", "roll_no": 3, "admission_no": "A101", "class_label": "5 A"},
    {"student_id": S2, "full_name": "Sumeet Shah", "login_id": "sumeet.shah", "roll_no": 4, "admission_no": "A102", "class_label": "6 B"},
]
CLERK = ["use_assistant", "view_student_fees", "collect_fees"]
ADMIN = ["use_assistant", "view_student_fees", "collect_fees", "adjust_fees", "cancel_fee_payment", "manage_fee_structure"]
PARENT = ["use_assistant", "view_my_fees"]
CALLS = []


def view(pending=12000.0):
    return {"student": {"student_id": S1, "full_name": "Sumit Pal", "class_label": "5 A", "roll_no": 3, "admission_no": "A101"},
            "session": {"id": "ss", "name": "2026-27", "is_current": True}, "today": "2026-10-16", "has_structure": True,
            "items": [{"id": ITEM, "name": "Tuition Fee"}],
            "ledger": {"lines": [{"label": "Tuition Fee - Quarter 3", "due_date": "2026-10-01", "pending": pending, "status": "due"}],
                       "totals": {"total": 24000, "paid": 24000 - pending, "pending": pending, "due_till_date": pending, "next_due_date": None, "next_due_amount": 0, "excess": 0}},
            "payments": [{"id": PAY, "receipt_no": "RCP-000012", "amount": 6000, "paid_on": "2026-10-10", "mode": "cash", "status": "received", "reference": None}],
            "adjustments": [{"id": ADJ, "item_name": None, "amount": -500, "reason": "sibling", "voided": False}],
            "contacts": [{"relation": "Father", "name": "Ramesh Pal", "phone": "9999900000"}]}


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _who(self):
        return {"Bearer admin": ADMIN, "Bearer clerk": CLERK, "Bearer parent": PARENT}.get(self.headers.get("Authorization", ""))

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        f = self._who()
        if f is None: return self._send(401, {"error": "Please sign in"})
        u = urllib.parse.urlsplit(self.path); p = u.path; q = urllib.parse.parse_qs(u.query)
        CALLS.append(("GET", self.path, None))
        if p == "/api/auth/me":
            role = "parent" if f is PARENT else "school_admin"
            return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": role, "features": f, "profile": {"full_name": "X"}, "catalog": {}})
        if p == "/api/fees/students": return self._send(200, STUDENTS)
        if p == f"/api/fees/students/{S1}": return self._send(200, view())
        if p == "/api/fees/pending":
            return self._send(200, {"summary": {"session": {"name": "2026-27"}, "as_of": "2026-10-16", "students_owing": 1, "total_pending": 12000, "total_due_till_date": 12000, "students_checked": 2, "classes_without_fee_structure": []},
                                    "shown": 1, "truncated": False, "rows": [{"student_id": S1, "full_name": "Sumit Pal", "class_label": "5 A", "roll_no": 3, "pending": 12000, "due_till_date": 12000, "oldest_due_date": "2026-10-01",
                                                                             "contacts": [{"relation": "Father", "name": "Ramesh", "phone": "9999900000"}]}]})
        if p == "/api/fees/payments":
            rows = [] if q.get("receipt_no") == ["RCP-999999"] else [{"id": PAY, "receipt_no": "RCP-000012", "student_name": "Sumit Pal", "class_label": "5 A", "amount": 6000, "paid_on": "2026-10-10", "mode": "cash", "status": "received", "received_by": "Clerk"}]
            return self._send(200, {"from": "2026-10-16", "to": "2026-10-16", "summary": {"receipts": 1, "total": 6000, "cancelled_receipts": 0, "by_mode": [{"name": "cash", "amount": 6000}], "by_class": [{"name": "5 A", "amount": 6000}]}, "shown": len(rows), "truncated": False, "rows": rows})
        if p == "/api/fees/structure":
            return self._send(200, {"session": {"id": "ss", "name": "2026-27"}, "classes": [{"name": "5", "sections": ["A"], "students": 30, "total": 24000, "items": [{"id": ITEM, "name": "Tuition Fee", "amount": 24000, "frequency": "monthly"}]}]})
        if p == "/api/fees/my":
            return self._send(200, [{"student_id": S1, "full_name": "Sumit Pal", "class_label": "5 A", "summary": {"total": 24000, "paid": 12000, "pending": 12000, "due_till_date": 12000}}])
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        f = self._who(); body = self._body()
        if f is None: return self._send(401, {"error": "Please sign in"})
        CALLS.append(("POST", self.path, body, self.headers.get("x-via")))
        if self.path.endswith("/payments") and f is not None:
            return self._send(201, {"payment": {"receipt_no": "RCP-000013"}, "account": {"ledger": {"totals": {"pending": 7000}}}})
        if self.path.endswith("/adjustments"):
            if f is CLERK: return self._send(403, {"error": "Only a school admin can do this"})
            return self._send(201, {"ledger": {"totals": {"pending": 11000}}})
        if self.path.endswith("/cancel"): return self._send(200, view())
        self._send(404, {"error": "Not found"})

    def log_message(self, *a): pass


def scripted(steps):
    it = iter(steps)
    def llm(msgs, schemas, system):
        s = next(it)
        return {"text": s.get("text", ""), "calls": [{"id": f"c{i}", "name": n, "args": a} for i, (n, a) in enumerate(s.get("calls", []))]}
    return llm


def posts(): return [c for c in CALLS if c[0] == "POST"]


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Portal)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        agent.CFG.update(node=f"http://127.0.0.1:{cls.srv.server_port}", provider="velona", gemini_key="x", model="m", school="Test School")

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def setUp(self): CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear(); agent._AUTH_CACHE.clear()

    def run_chat(self, token, steps, text="x"):
        agent.llm = scripted(steps)
        return agent.chat(token, agent.verify_user(token), None, text, False)

    def test_tools_follow_permissions(self):
        clerk, admin, parent = (agent.allowed_tools(agent.verify_user(t)) for t in ("clerk", "admin", "parent"))
        self.assertIn("record_fee_payment", clerk); self.assertNotIn("adjust_fee", clerk); self.assertNotIn("cancel_fee_payment", clerk); self.assertNotIn("add_fee_item", clerk)
        self.assertLessEqual({"adjust_fee", "cancel_fee_payment", "void_fee_adjustment", "add_fee_item", "fee_structure", "pending_fees"}, admin)
        self.assertEqual(parent, {"ask_choice", "my_fees", "my_attendance", "get_receipt", "get_fee_statement"})   # read-only + download cards

    def test_find_student_and_status(self):
        r = self.run_chat("clerk", [{"calls": [("find_fee_student", {"query": "sumit"})]}, {"calls": [("student_fees", {"student_id": S1})]}, {"text": "Pending 12000"}])
        self.assertEqual(r["reply"], "Pending 12000")
        msgs = agent.CONVS[r["conversation_id"]]["messages"]
        found = json.loads(msgs[2]["results"][0]["content"]); self.assertEqual(found["results"][0]["id"], S1)
        fees = json.loads(msgs[4]["results"][0]["content"])
        self.assertEqual(fees["pending"], 12000); self.assertEqual(fees["parents"][0]["phone"], "9999900000")
        self.assertEqual(fees["recent_payments"][0]["receipt_no"], "RCP-000012")
        self.assertTrue(any("contacts=1" in c[1] for c in CALLS if c[0] == "GET"))

    def test_ambiguous_student_asks(self):
        r = self.run_chat("clerk", [{"calls": [("find_fee_student", {"query": "sumit"})]}, {"calls": [("ask_choice", {"question": "Which?", "options": ["Sumit Pal 5 A", "Sumeet Shah 6 B"]})]}])
        self.assertEqual(len(r["choices"]), 2); self.assertEqual(r["actions"], [])

    def test_reports(self):
        r = self.run_chat("clerk", [{"calls": [("pending_fees", {"class_name": "5", "min_pending": 5000}), ("fee_collection", {"period": "today"})]}, {"text": "ok"}])
        msgs = agent.CONVS[r["conversation_id"]]["messages"]
        res = json.loads(msgs[2]["results"][0]["content"]); self.assertEqual(res["total_pending"], 12000); self.assertEqual(res["students"][0]["parents"][0], "Father, Ramesh, 9999900000")
        self.assertEqual(json.loads(msgs[2]["results"][1]["content"])["total_collected"], 6000)
        g = [c[1] for c in CALLS if c[1].startswith("/api/fees/pending")][0]
        self.assertIn("min_pending=5000", g); self.assertIn("class_name=5", g)

    def test_payment_needs_confirm_then_posts_once_via_ai(self):
        r = self.run_chat("clerk", [{"calls": [("record_fee_payment", {"student_id": S1, "amount": "5,000", "mode": "upi", "reference": "UTR123"})]}])
        self.assertEqual(len(r["actions"]), 1); card = r["actions"][0]
        self.assertEqual(posts(), [])                                         # nothing recorded yet
        self.assertIn("₹12,000 → ₹7,000", card["footer"])
        out = agent.confirm("clerk", agent.verify_user("clerk"), card["id"], r["conversation_id"])
        self.assertTrue(out["ok"]); self.assertIn("RCP-000013", out["message"]); self.assertIn("₹7,000", out["message"])
        p = posts()[-1]
        self.assertEqual(p[1], f"/api/fees/students/{S1}/payments"); self.assertEqual(p[3], "ai-assistant")
        self.assertEqual(p[2], {"amount": "5000", "mode": "upi", "reference": "UTR123"})
        self.assertRaises(agent.ErpError, agent.confirm, "clerk", agent.verify_user("clerk"), card["id"], None)   # single use

    def test_payment_refusals(self):
        for args, frag in (({"amount": 99999, "mode": "cash"}, "more than the pending"), ({"amount": 0, "mode": "cash"}, "above zero"),
                           ({"amount": "12abc", "mode": "cash"}, "plain number"), ({"amount": 100, "mode": "bitcoin"}, "mode must be"),
                           ({"amount": 100000000, "mode": "cash"}, "too large")):
            r = self.run_chat("clerk", [{"calls": [("record_fee_payment", {"student_id": S1, **args})]}, {"text": "no"}])
            self.assertEqual(r["actions"], [], args)
            out = json.loads(agent.CONVS[r["conversation_id"]]["messages"][2]["results"][0]["content"])
            self.assertIn(frag, out["error"]); agent.CONVS.clear()
        self.assertEqual(posts(), [])

    def test_clerk_cannot_adjust_or_cancel(self):
        r = self.run_chat("clerk", [{"calls": [("adjust_fee", {"student_id": S1, "type": "discount", "amount": 500, "reason": "x"}), ("cancel_fee_payment", {"receipt_no": "RCP-000012", "reason": "x"})]}, {"text": "not allowed"}])
        self.assertEqual(r["actions"], []); self.assertEqual(posts(), [])

    def test_admin_adjust_and_cancel(self):
        r = self.run_chat("admin", [{"calls": [("adjust_fee", {"student_id": S1, "type": "discount", "amount": 1000, "reason": "sibling", "fee_name": "tuition"}),
                                               ("cancel_fee_payment", {"receipt_no": "rcp-000012", "reason": "wrong student"})]}])
        self.assertEqual(len(r["actions"]), 2)
        u = agent.verify_user("admin")
        for c in r["actions"]: self.assertTrue(agent.confirm("admin", u, c["id"], r["conversation_id"])["ok"])
        adj = next(p for p in posts() if p[1].endswith("/adjustments")); self.assertEqual(adj[2]["item_id"], ITEM); self.assertEqual(adj[2]["type"], "discount")
        self.assertTrue(any(p[1] == f"/api/fees/payments/{PAY}/cancel" and p[2]["reason"] == "wrong student" for p in posts()))

    def test_cancel_needs_reason_and_real_receipt(self):
        r = self.run_chat("admin", [{"calls": [("cancel_fee_payment", {"receipt_no": "RCP-000012", "reason": ""}), ("cancel_fee_payment", {"receipt_no": "RCP-999999", "reason": "x"})]}, {"text": "?"}])
        outs = [json.loads(x["content"]) for x in agent.CONVS[r["conversation_id"]]["messages"][2]["results"]]
        self.assertIn("reason", outs[0]["error"].lower()); self.assertIn("No receipt", outs[1]["error"]); self.assertEqual(r["actions"], [])

    def test_parent_sees_only_own(self):
        r = self.run_chat("parent", [{"calls": [("my_fees", {}), ("pending_fees", {})]}, {"text": "ok"}])
        outs = [json.loads(x["content"]) for x in agent.CONVS[r["conversation_id"]]["messages"][2]["results"]]
        self.assertEqual(outs[0]["children"][0]["pending"], 12000); self.assertEqual(outs[1], {"error": "Unknown tool"})

    def test_structure_edit_cards(self):
        r = self.run_chat("admin", [{"calls": [("update_fee_item", {"item_id": ITEM, "amount": 30000}), ("add_fee_item", {"class_name": "5", "name": "Lab Fee", "amount": 1200, "frequency": "one_time"})]}])
        self.assertEqual(len(r["actions"]), 2); self.assertIn("₹24,000 → ₹30,000", r["actions"][0]["lines"][0])

    def test_auto_confirm_never_moves_money(self):
        agent.llm = scripted([{"calls": [("record_fee_payment", {"student_id": S1, "amount": 500, "mode": "cash"})]}])
        r = agent.chat("clerk", agent.verify_user("clerk"), None, "x", True)          # auto-confirm ON
        self.assertEqual(r["actions"][0]["status"], "pending"); self.assertEqual(posts(), [])


if __name__ == "__main__":
    unittest.main()
