"""Offline test of the LEAVE & PAYROLL tools (fake portal + scripted LLM). Run:  python -m unittest test_ai_payroll   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

E1 = "11111111-1111-1111-1111-111111111111"; E2 = "22222222-2222-2222-2222-222222222222"
T_CL = "aaaaaaaa-0000-0000-0000-000000000001"; T_UN = "aaaaaaaa-0000-0000-0000-000000000002"
R1 = "bbbbbbbb-0000-0000-0000-000000000001"; R2 = "bbbbbbbb-0000-0000-0000-000000000002"
P1 = "cccccccc-0000-0000-0000-000000000001"; P2 = "cccccccc-0000-0000-0000-000000000002"
AD = "dddddddd-0000-0000-0000-000000000001"
TYPES = [{"id": T_CL, "name": "Casual Leave", "is_paid": True, "annual_quota": 12, "is_active": True}, {"id": T_UN, "name": "Unpaid Leave", "is_paid": False, "annual_quota": 0, "is_active": True}]
EMPS = [{"user_id": E1, "login_id": "ravi.kumar", "role": "staff", "full_name": "Ravi Kumar", "designation": "Maths Teacher", "salary": 30000},
        {"user_id": E2, "login_id": "ravi.verma", "role": "staff", "full_name": "Ravindra Verma", "designation": "Clerk", "salary": 20000}]
LEAVES = [{"id": R1, "user_id": E1, "leave_type_id": T_CL, "start_date": "2026-10-20", "end_date": "2026-10-21", "days": 2, "half_day": False, "status": "pending", "reason": "Wedding", "created_at": "2026-10-15T08:00:00Z", "employee": {"full_name": "Ravi Kumar"}},
          {"id": R2, "user_id": E2, "leave_type_id": T_CL, "start_date": "2026-10-10", "end_date": "2026-10-10", "days": 1, "half_day": False, "status": "approved", "reason": "Fever", "created_at": "2026-10-09T08:00:00Z", "employee": {"full_name": "Ravindra Verma"}}]
SLIPS = [{"id": P1, "user_id": E1, "status": "draft", "base_salary": 30000, "unpaid_days": 0, "leave_deduction": 0, "bonus_total": 0, "other_deduction_total": 0, "net_pay": 30000, "employee": {"full_name": "Ravi Kumar"}},
         {"id": P2, "user_id": E2, "status": "finalized", "base_salary": 20000, "unpaid_days": 1, "leave_deduction": 800, "bonus_total": 0, "other_deduction_total": 0, "net_pay": 19200, "employee": {"full_name": "Ravindra Verma"}}]
F = {"Bearer teacher": ["use_assistant", "my_leave"], "Bearer boss": ["use_assistant", "my_leave", "leave_approve", "leave_view_all", "leave_grant", "payroll_view", "payroll_manage", "payroll_settings"],
     "Bearer viewer": ["use_assistant", "payroll_view"]}
CALLS = []


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _go(self, method):
        f = F.get(self.headers.get("Authorization", ""))
        if f is None: return self._send(401, {"error": "Please sign in"})
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}") if n else None
        u = urllib.parse.urlsplit(self.path); p = u.path
        CALLS.append((method, self.path, body, self.headers.get("x-via")))
        if method == "GET":
            if p == "/api/auth/me": return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": "staff", "features": f, "profile": {"full_name": "X"}, "catalog": {}})
            if p == "/api/payroll/settings": return self._send(200, {"settings": {"approval_mode": "manual", "weekly_off": [0], "rate_basis": "working_days"}, "types": TYPES})
            if p == "/api/payroll/employees": return self._send(200, EMPS)
            if p == "/api/payroll/leave": return self._send(200, LEAVES)
            if p == "/api/payroll/balances": return self._send(200, [{"user_id": E1, "login_id": "ravi.kumar", "full_name": "Ravi Kumar", "designation": "Maths Teacher", "balances": [{"type_id": T_CL, "name": "Casual Leave", "balance": 8, "pending": 2}]}])
            if p == "/api/payroll/payslips": return self._send(200, {"period": "2026-09-01", "can_generate": True, "rows": SLIPS, "missing": [{"user_id": "z", "full_name": "No Salary", "has_salary": False}]})
            if p == "/api/payroll/adjustments": return self._send(200, [{"id": AD, "user_id": E1, "kind": "bonus", "label": "Diwali", "amount": 2000, "payslip_id": None, "employee": {"full_name": "Ravi Kumar"}}])
            if p == "/api/payroll/me": return self._send(200, {"approval_mode": "manual", "types": TYPES, "balances": [{"type_id": T_CL, "name": "Casual Leave", "balance": 8, "pending": 0}], "requests": [dict(LEAVES[0], employee=None)], "payslips": [], "upcoming": [], "has_salary": True})
            return self._send(404, {"error": "Not found"})
        if method == "POST":
            if p == "/api/payroll/leave": return self._send(201, {"status": "approved" if body.get("user_id") else "pending", "days": 2})
            if p.endswith("/generate"): return self._send(200, {"made": 2, "locked": 0, "noSalary": ["No Salary"]})
            if p.endswith("/finalize-all"): return self._send(200, {"done": 1, "failed": []})
            if p.endswith("/pay-all"): return self._send(200, {"done": 1})
            if p == "/api/payroll/grants": return self._send(200, {"done": 1, "skipped": 0})
            return self._send(200, {"ok": True})
        self._send(200, {"ok": True})

    do_GET = lambda s: s._go("GET"); do_POST = lambda s: s._go("POST"); do_PUT = lambda s: s._go("PUT"); do_PATCH = lambda s: s._go("PATCH"); do_DELETE = lambda s: s._go("DELETE")

    def log_message(self, *a): pass


def scripted(steps):
    it = iter(steps)
    return lambda msgs, schemas, system: (lambda s: {"text": s.get("text", ""), "calls": [{"id": f"c{i}", "name": n, "args": a} for i, (n, a) in enumerate(s.get("calls", []))]})(next(it))


def writes(): return [c for c in CALLS if c[0] != "GET"]


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

    def out(self, r, i=0): return json.loads(agent.CONVS[r["conversation_id"]]["messages"][2]["results"][i]["content"])

    def ok(self, r, tok="boss"):
        u = agent.verify_user(tok); return [agent.confirm(tok, u, c["id"], r["conversation_id"]) for c in r["actions"]]

    def test_permissions(self):
        t, b, v = (agent.allowed_tools(agent.verify_user(x)) for x in ("teacher", "boss", "viewer"))
        self.assertLessEqual({"my_leave", "apply_leave"}, t); self.assertNotIn("decide_leave", t); self.assertNotIn("payslips", t); self.assertNotIn("pay_payroll", t)
        self.assertLessEqual({"decide_leave", "grant_leave", "finalize_payroll", "pay_payroll", "update_pay_settings", "payslips", "leave_requests"}, b)
        self.assertIn("payslips", v); self.assertNotIn("finalize_payroll", v); self.assertNotIn("apply_leave", v)

    def test_find_employee_ambiguous(self):
        r = self.chat("boss", [{"calls": [("find_employee", {"query": "ravi"})]}, {"calls": [("ask_choice", {"question": "Which Ravi?", "options": ["Ravi Kumar", "Ravindra Verma"]})]}])
        self.assertEqual(len(r["choices"]), 2); self.assertEqual(r["actions"], [])

    def test_reads(self):
        r = self.chat("boss", [{"calls": [("leave_requests", {"status": "pending"}), ("leave_balances", {"query": "ravi kumar"}), ("payslips", {"period": "2026-09"}), ("payroll_adjustments", {"period": "last_month"}), ("leave_settings", {})]}, {"text": "ok"}])
        lr, lb, ps, pa, ls = (self.out(r, i) for i in range(5))
        self.assertEqual(lr["requests"][0]["request_id"], R1); self.assertEqual(lr["requests"][0]["type"], "Casual Leave")
        self.assertIn("awaiting approval", lb["employees"][0]["balances"]["Casual Leave"])
        self.assertEqual(ps["total_net_pay"], 49200); self.assertEqual(ps["payslips_by_status"], {"draft": 1, "finalized": 1}); self.assertEqual(ps["month"], "September 2026")
        self.assertEqual(pa["adjustments"][0]["label"], "Diwali"); self.assertEqual(ls["weekly_off"], ["Sunday"])

    def test_my_leave(self):
        r = self.chat("teacher", [{"calls": [("my_leave", {})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["balances"], {"Casual Leave": 8}); self.assertEqual(o["requests"][0]["type"], "Casual Leave")

    def test_apply_own_leave_needs_reason_then_posts(self):
        r = self.chat("teacher", [{"calls": [("apply_leave", {"leave_type": "casual", "start_date": "2026-10-22"})]}, {"text": "?"}])
        self.assertEqual(r["actions"], []); self.assertIn("reason", self.out(r)["error"].lower())
        r = self.chat("teacher", [{"calls": [("apply_leave", {"leave_type": "casual", "start_date": "2026-10-22", "end_date": "2026-10-23", "reason": "Family function"})]}])
        self.assertEqual(writes(), [])
        res = self.ok(r, "teacher")[0]; self.assertTrue(res["ok"]); self.assertIn("waiting for approval", res["message"])
        w = writes()[-1]; self.assertEqual(w[2]["leave_type_id"], T_CL); self.assertEqual(w[3], "ai-assistant"); self.assertNotIn("user_id", w[2])

    def test_teacher_cannot_record_for_others_or_decide(self):
        r = self.chat("teacher", [{"calls": [("apply_leave", {"leave_type": "casual", "start_date": "2026-10-22", "employee_id": E2}), ("decide_leave", {"request_id": R1, "decision": "approve"})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])

    def test_approver_records_for_other(self):
        r = self.chat("boss", [{"calls": [("apply_leave", {"leave_type": "unpaid", "start_date": "2026-10-22", "employee_id": E2})]}])
        res = self.ok(r)[0]; self.assertIn("Ravindra Verma", res["message"]); self.assertEqual(writes()[-1][2]["user_id"], E2)

    def test_decide_leave_always_confirms(self):
        r = self.chat("boss", [{"calls": [("decide_leave", {"request_id": R1, "decision": "reject", "note": "Exams"})]}], auto=True)
        self.assertEqual(r["actions"][0]["status"], "pending"); self.assertEqual(writes(), [])
        self.assertIn("REJECT", r["actions"][0]["title"]); self.ok(r)
        self.assertEqual(writes()[-1][1], f"/api/payroll/leave/{R1}/reject"); self.assertEqual(writes()[-1][2]["note"], "Exams")

    def test_decide_already_handled(self):
        r = self.chat("boss", [{"calls": [("decide_leave", {"request_id": R2, "decision": "approve"})]}, {"text": "?"}])
        self.assertEqual(r["actions"], []); self.assertIn("already approved", self.out(r)["error"])

    def test_grants(self):
        r = self.chat("boss", [{"calls": [("grant_leave", {"kind": "grant", "leave_type": "casual", "employee_id": E1, "days": 2, "note": "Extra for exams"}),
                                          ("grant_leave", {"kind": "allotment", "leave_type": "casual", "all_employees": True, "period_key": "2026-2027"}),
                                          ("grant_leave", {"kind": "grant", "leave_type": "unpaid", "employee_id": E1, "days": 1, "note": "x"}),
                                          ("grant_leave", {"kind": "grant", "leave_type": "casual", "employee_id": E1, "days": 1.3, "note": "x"})]}, {"text": "done"}])
        self.assertEqual(len(r["actions"]), 2); self.assertIn("no balance", self.out(r, 2)["error"]); self.assertIn("halves", self.out(r, 3)["error"])
        self.ok(r); b = [w[2] for w in writes()]
        self.assertEqual(b[0]["user_ids"], [E1]); self.assertTrue(b[1]["all"]); self.assertEqual(b[1]["period_key"], "2026-2027")

    def test_bonus_and_deduction(self):
        r = self.chat("boss", [{"calls": [("add_payroll_adjustment", {"employee_id": E1, "kind": "bonus", "amount": "2,000", "label": "Diwali bonus", "period": "2026-10"}),
                                          ("add_payroll_adjustment", {"employee_id": E1, "kind": "bonus", "amount": 100, "label": ""}),
                                          ("remove_payroll_adjustment", {"adjustment_id": AD, "period": "2026-10"})]}, {"text": "ok"}])
        self.assertEqual(len(r["actions"]), 2); self.assertIn("label", self.out(r, 1)["error"]); self.ok(r)
        self.assertEqual(writes()[0][2], {"user_id": E1, "period": "2026-10-01", "kind": "bonus", "label": "Diwali bonus", "amount": "2000"})
        self.assertEqual(writes()[1][0], "DELETE")

    def test_payroll_run(self):
        r = self.chat("boss", [{"calls": [("generate_payroll", {"period": "2026-09"}), ("finalize_payroll", {"period": "2026-09"}), ("pay_payroll", {"period": "2026-09", "payment_method": "Bank transfer"})]}], auto=True)
        self.assertEqual([c["status"] for c in r["actions"]], ["pending"] * 3); self.assertEqual(writes(), [])          # money / locks never auto-run
        self.assertIn("₹30,000", r["actions"][1]["lines"][1]); self.assertIn("₹19,200", r["actions"][2]["lines"][1])
        msgs = [x["message"] for x in self.ok(r)]
        self.assertIn("1 payslip(s) finalized", msgs[1]); self.assertIn("marked as paid", msgs[2])
        self.assertEqual([w[1] for w in writes()], ["/api/payroll/payslips/generate", "/api/payroll/payslips/finalize-all", "/api/payroll/payslips/pay-all"])
        self.assertEqual(writes()[2][2]["payment_method"], "Bank transfer")

    def test_single_slip_and_nothing_to_do(self):
        r = self.chat("boss", [{"calls": [("pay_payroll", {"period": "2026-09", "payslip_id": P1}), ("finalize_payroll", {"period": "2026-09", "payslip_id": P2}), ("reopen_payslip", {"period": "2026-09", "payslip_id": P2})]}, {"text": "?"}])
        self.assertIn("No finalized payslips", self.out(r, 0)["error"]); self.assertIn("No draft payslips", self.out(r, 1)["error"]); self.assertEqual(len(r["actions"]), 1)
        self.ok(r); self.assertEqual(writes()[-1][1], f"/api/payroll/payslips/{P2}/reopen")

    def test_settings_and_types(self):
        r = self.chat("boss", [{"calls": [("update_pay_settings", {"approval_mode": "auto", "weekly_off": ["sunday", "Saturday"]}), ("update_pay_settings", {"approval_mode": "manual"}),
                                          ("add_leave_type", {"name": "Study Leave", "yearly_quota": 5}), ("add_leave_type", {"name": "casual leave"}),
                                          ("update_leave_type", {"leave_type": "casual", "yearly_quota": 15})]}, {"text": "ok"}])
        self.assertEqual(len(r["actions"]), 3); self.assertIn("Nothing to change", self.out(r, 1)["error"]); self.assertIn("already exists", self.out(r, 3)["error"])
        self.ok(r); w = writes()
        self.assertEqual(w[0][0], "PUT"); self.assertEqual(w[0][2], {"approval_mode": "auto", "rate_basis": "working_days", "weekly_off": [0, 6]})
        self.assertEqual(w[2][0], "PATCH"); self.assertEqual(w[2][2], {"annual_quota": 15.0})

    def test_viewer_cannot_change_anything(self):
        r = self.chat("viewer", [{"calls": [("finalize_payroll", {"period": "2026-09"}), ("add_payroll_adjustment", {"employee_id": E1, "kind": "bonus", "amount": 1, "label": "x"})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])


if __name__ == "__main__":
    unittest.main()
