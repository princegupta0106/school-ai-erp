"""Offline test of the ATTENDANCE tools (fake portal + scripted LLM). Run:  python -m unittest test_ai_attendance   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

C5A = "c5a00000-0000-0000-0000-000000000001"; C5B = "c5b00000-0000-0000-0000-000000000002"
S1 = "51111111-1111-1111-1111-111111111111"; S2 = "52222222-2222-2222-2222-222222222222"; S3 = "53333333-3333-3333-3333-333333333333"
T1 = "a1111111-1111-1111-1111-111111111111"; T2 = "a2222222-2222-2222-2222-222222222222"
PARENT_KID = "54444444-4444-4444-4444-444444444444"
STUDENTS = [{"student_id": S1, "full_name": "Rahul Sharma", "login_id": "rahul.sharma", "roll_no": 1, "admission_no": None, "status": "present"},
            {"student_id": S2, "full_name": "Rahul Verma", "login_id": "rahul.verma", "roll_no": 2, "admission_no": None, "status": None},
            {"student_id": S3, "full_name": "Priya Singh", "login_id": "priya.singh", "roll_no": None, "admission_no": None, "status": "absent"}]
CLASSES = [{"id": C5A, "name": "5", "section": "A", "level": 5, "state": "partial", "total_students": 3, "marked": 2, "present": 1, "absent": 1, "late": 0, "leave": 0, "marked_by": ["Mrs Gupta"]},
           {"id": C5B, "name": "5", "section": "B", "level": 5, "state": "not_marked", "total_students": 30, "marked": 0, "present": 0, "absent": 0, "late": 0, "leave": 0}]
TEACH = {"teachers": [{"user_id": T1, "login_id": "meena.gupta", "full_name": "Meena Gupta", "designation": "Maths"}, {"user_id": T2, "login_id": "anil.rao", "full_name": "Anil Rao", "designation": "Science"}],
         "classes": [dict(CLASSES[0], teachers=[{"user_id": T1, "login_id": "meena.gupta", "full_name": "Meena Gupta", "is_class_teacher": True}]), dict(CLASSES[1], teachers=[])]}
REPORT = {"student": {"student_id": S3, "full_name": "Priya Singh", "login_id": "priya.singh", "roll_no": None, "class": {"id": C5A, "name": "5", "section": "A"}},
          "range": {"from": "2026-10-01", "to": "2026-10-16"}, "summary": {"present": 8, "absent": 3, "late": 1, "leave": 0, "total": 12, "percent": 75},
          "months": [{"month": "2026-10", "present": 8, "absent": 3, "late": 1, "leave": 0, "total": 12, "percent": 75}], "absences": [{"date": "2026-10-14", "status": "absent"}]}
F = {"Bearer teacher": ["use_assistant", "mark_attendance"],
     "Bearer head": ["use_assistant", "mark_attendance", "view_attendance_reports", "attendance_all_classes", "manage_class_teachers", "manage_roll_numbers", "edit_past_attendance"],
     "Bearer viewer": ["use_assistant", "view_attendance_reports"], "Bearer parent": ["use_assistant"]}
ROLE = {"Bearer parent": "parent"}
CALLS = []


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _go(self, method):
        tok = self.headers.get("Authorization", ""); f = F.get(tok)
        if f is None: return self._send(401, {"error": "Please sign in"})
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}") if n else None
        u = urllib.parse.urlsplit(self.path); p = u.path; q = urllib.parse.parse_qs(u.query)
        CALLS.append((method, self.path, body, self.headers.get("x-via")))
        if method == "GET":
            if p == "/api/auth/me": return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": ROLE.get(tok, "staff"), "features": f, "profile": {"full_name": "X"}, "catalog": {}})
            if p == "/api/attendance/classes": return self._send(200, {"today": "2026-10-16", "date": q.get("date", ["2026-10-16"])[0], "classes": CLASSES})
            if p == "/api/attendance/reports/daily":
                return self._send(200, {"date": q.get("date", ["2026-10-16"])[0], "totals": {"classes": 2, "classes_marked": 1, "students": 33, "marked": 2, "present": 1, "absent": 1, "late": 0, "leave": 0}, "classes": [dict(c, teachers=["Meena Gupta"]) for c in CLASSES]})
            if p == "/api/attendance/sheet":
                if q.get("date", [""])[0] == "2026-10-20": return self._send(400, {"error": "You cannot mark attendance for a future date"})
                past = q.get("date", ["2026-10-16"])[0] != "2026-10-16"
                can = (not past) or "edit_past_attendance" in f
                return self._send(200, {"class": CLASSES[0], "date": q.get("date", ["2026-10-16"])[0], "today": "2026-10-16", "can_edit": can, "edit_note": None if can else "Only today can be edited with your access",
                                        "holiday": None, "students": STUDENTS, "teachers": [{"name": "Meena Gupta", "is_class_teacher": True}]})
            if p == "/api/attendance/students": return self._send(200, [{"student_id": s["student_id"], "full_name": s["full_name"], "login_id": s["login_id"], "roll_no": s["roll_no"], "class_label": "5 A"} for s in STUDENTS if q["q"][0].lower() in s["full_name"].lower()])
            if p == f"/api/attendance/reports/student/{S3}": return self._send(200, REPORT)
            if p == "/api/attendance/reports/class":
                return self._send(200, {"class": CLASSES[0], "range": {"from": "2026-10-01", "to": "2026-10-16"}, "working_days": 12, "summary": {"present": 20, "absent": 5, "late": 1, "leave": 0, "total": 26, "percent": 80.8},
                                        "students": [dict(s, present=8, absent=4, late=0, leave=0, total=12, percent=66.7) if s["student_id"] == S3 else dict(s, present=12, absent=0, late=0, leave=0, total=12, percent=100) for s in STUDENTS], "days": []})
            if p == "/api/attendance/reports/low": return self._send(200, {"range": {"from": "2026-10-01", "to": "2026-10-16"}, "threshold": float(q["threshold"][0]), "students": [{"student_id": S3, "class_id": C5A, "class_label": "5 A", "full_name": "Priya Singh", "roll_no": None, "present": 8, "absent": 4, "late": 0, "leave": 0, "total": 12, "percent": 66.7}]})
            if p == "/api/attendance/teachers": return self._send(200, TEACH)
            if p == "/api/attendance/rolls": return self._send(200, {"class": CLASSES[0], "students": STUDENTS})
            if p == "/api/attendance/my": return self._send(200, dict(REPORT, student=dict(REPORT["student"], student_id=q["student_id"][0])))
            if p == "/api/fees/my": return self._send(200, [{"student_id": PARENT_KID, "full_name": "Kid One", "class_label": "5 A"}])
            return self._send(404, {"error": "Not found"})
        if method == "POST" and p == "/api/attendance/rolls/auto": return self._send(200, {"class": CLASSES[0], "students": STUDENTS})
        self._send(200, {"saved": len((body or {}).get("records") or []) or 1, "unchanged": 0, "date": (body or {}).get("date"), "ok": True})

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

    def ok(self, r, tok="head"):
        u = agent.verify_user(tok); return [agent.confirm(tok, u, c["id"], r["conversation_id"]) for c in r["actions"]]

    def test_permissions(self):
        t, h, v, p = (agent.allowed_tools(agent.verify_user(x)) for x in ("teacher", "head", "viewer", "parent"))
        self.assertLessEqual({"attendance_overview", "class_attendance", "mark_attendance", "find_attendance_student"}, t)
        self.assertFalse({"student_attendance", "low_attendance", "set_class_teachers", "set_roll_number", "my_attendance"} & t)
        self.assertLessEqual({"student_attendance", "class_attendance_report", "low_attendance", "class_teachers", "class_rolls", "set_class_teachers", "auto_assign_rolls", "set_roll_number", "mark_attendance"}, h)
        self.assertIn("low_attendance", v); self.assertNotIn("mark_attendance", v)
        self.assertEqual({"my_attendance", "ask_choice"}, p & {"my_attendance", "ask_choice", "mark_attendance", "class_attendance"})

    def test_overview_for_report_viewer_and_for_teacher(self):
        r = self.chat("head", [{"calls": [("attendance_overview", {})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["date"], "2026-10-16"); self.assertEqual(o["not_marked"], ["5 B"]); self.assertEqual(o["partly_marked"], ["5 A"]); self.assertEqual(o["totals"]["absent"], 1)
        self.assertTrue(any("/api/attendance/reports/daily" in c[1] for c in CALLS))
        CALLS.clear(); agent.invalidate_lists()
        r = self.chat("teacher", [{"calls": [("attendance_overview", {"date": "yesterday"})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["date"], "2026-10-15"); self.assertEqual(o["totals"]["students"], 33); self.assertIn("assigned", o["scope"])
        self.assertTrue(any("date=2026-10-15" in c[1] for c in CALLS))

    def test_class_sheet_filter(self):
        r = self.chat("teacher", [{"calls": [("class_attendance", {"class_name": "5a", "status": "absent"})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["class"], "5 A"); self.assertEqual([s["name"] for s in o["students"]], ["Priya Singh"]); self.assertEqual(o["counts"], {"present": 1, "not_marked": 1, "absent": 1})
        r = self.chat("teacher", [{"calls": [("class_attendance", {"class_name": "5"})]}, {"text": "?"}])
        self.assertIn("Which class", self.out(r)["error"])                      # "5" matches 5 A and 5 B

    def test_find_and_student_report(self):
        r = self.chat("head", [{"calls": [("find_attendance_student", {"query": "rahul"}), ("find_attendance_student", {"query": "priya singh"})]}, {"text": "ok"}])
        self.assertEqual(self.out(r, 0)["match_status"], "ambiguous"); o = self.out(r, 1); self.assertEqual(o["match_status"], "single_clear"); self.assertEqual(o["results"][0]["id"], S3)
        r = self.chat("head", [{"calls": [("student_attendance", {"student_id": S3, "period": "this_month"})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["summary"]["percent"], 75); self.assertEqual(o["class"], "5 A"); self.assertEqual(o["recent_non_present_days"][0]["date"], "2026-10-14")
        self.assertTrue(any("from=2026-10-01" in c[1] and "to=2026-10-16" in c[1] for c in CALLS))

    def test_class_report_and_low(self):
        r = self.chat("head", [{"calls": [("class_attendance_report", {"class_name": "5 A", "limit": 1}), ("low_attendance", {"threshold": 70, "class_name": "5 A"}), ("low_attendance", {"threshold": 0})]}, {"text": "ok"}])
        o = self.out(r, 0); self.assertEqual(o["lowest_attendance_first"][0]["name"], "Priya Singh"); self.assertTrue(o["more_not_shown"]); self.assertEqual(o["days_marked"], 12)
        o = self.out(r, 1); self.assertEqual(o["students_below"], 1); self.assertEqual(o["students"][0]["percent"], 66.7); self.assertIn("percentage", self.out(r, 2)["error"])

    def test_teachers_and_rolls_reads(self):
        r = self.chat("head", [{"calls": [("class_teachers", {}), ("class_rolls", {"class_name": "5 A"})]}, {"text": "ok"}])
        o = self.out(r, 0); self.assertEqual(o["classes_without_teacher"], ["5 B"]); self.assertEqual(o["classes"][0]["teachers"], ["Meena Gupta (class teacher)"])
        o = self.out(r, 1); self.assertEqual(o["without_roll_no"], 1)

    def test_my_attendance_parent(self):
        r = self.chat("parent", [{"calls": [("my_attendance", {})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["children"][0]["student_id"], PARENT_KID); self.assertEqual(o["children"][0]["summary"]["percent"], 75)

    def test_mark_attendance_default_plus_exceptions(self):
        r = self.chat("teacher", [{"calls": [("mark_attendance", {"class_name": "5 A", "default_status": "present", "exceptions": [{"student": "priya", "status": "absent"}, {"student": "2", "status": "late"}]})]}], auto=False)
        self.assertEqual(writes(), []); a = r["actions"][0]; self.assertEqual(a["status"], "pending"); self.assertIn("Absent: Priya Singh", " ".join(a["lines"])); self.assertIn("Late: Rahul Verma (2)", " ".join(a["lines"]))
        res = self.ok(r, "teacher")[0]; self.assertTrue(res["ok"]); self.assertIn("Attendance saved for 5 A", res["message"])
        w = writes()[-1]; self.assertEqual((w[0], w[1]), ("PUT", "/api/attendance/sheet")); self.assertEqual(w[3], "ai-assistant")
        self.assertEqual({x["student_id"]: x["status"] for x in w[2]["records"]}, {S1: "present", S2: "late", S3: "absent"}); self.assertEqual(w[2]["date"], "2026-10-16")

    def test_mark_attendance_runs_when_auto_confirm_is_on(self):
        r = self.chat("teacher", [{"calls": [("mark_attendance", {"class_name": "5 A", "default_status": "present"})]}], auto=True)
        self.assertEqual(r["actions"][0]["status"], "done"); self.assertEqual(len(writes()), 1)

    def test_mark_attendance_refusals(self):
        r = self.chat("teacher", [{"calls": [("mark_attendance", {"class_name": "5 A", "default_status": "present", "exceptions": [{"student": "rahul", "status": "absent"}]}),
                                             ("mark_attendance", {"class_name": "5 A", "date": "2026-10-20", "default_status": "present"}),
                                             ("mark_attendance", {"class_name": "5 A", "date": "2026-10-10", "default_status": "present"}),
                                             ("mark_attendance", {"class_name": "5 A"}),
                                             ("mark_attendance", {"class_name": "5 A", "exceptions": [{"student": "priya", "status": "absent"}]})]}, {"text": "?"}])
        self.assertIn("could be", self.out(r, 0)["error"]); self.assertIn("future", self.out(r, 1)["error"]); self.assertIn("Only today", self.out(r, 2)["error"])
        self.assertIn("Say who", self.out(r, 3)["error"]); self.assertIn("already marked", self.out(r, 4)["error"]); self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])

    def test_past_date_allowed_with_permission(self):
        r = self.chat("head", [{"calls": [("mark_attendance", {"class_name": "5 A", "date": "2026-10-10", "default_status": "present"})]}])
        self.assertEqual(r["actions"][0]["status"], "pending"); self.ok(r); self.assertEqual(writes()[-1][2]["date"], "2026-10-10")

    def test_teacher_cannot_do_head_things(self):
        r = self.chat("teacher", [{"calls": [("set_class_teachers", {"class_name": "5 A", "add_teachers": ["anil"]}), ("set_roll_number", {"class_name": "5 A", "student": "priya", "roll_no": 3}), ("low_attendance", {})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])

    def test_set_class_teachers_always_confirms(self):
        r = self.chat("head", [{"calls": [("set_class_teachers", {"class_name": "5 B", "add_teachers": ["anil rao"], "class_teacher": "anil"}), ("set_class_teachers", {"class_name": "5 A", "add_teachers": ["meena"]})]}, {"text": "?"}], auto=True)
        self.assertEqual(len(r["actions"]), 1); self.assertEqual(r["actions"][0]["status"], "pending"); self.assertIn("No change", self.out(r, 1)["error"]); self.assertEqual(writes(), [])
        self.assertIn("Class teacher: - → Anil Rao", r["actions"][0]["lines"])
        self.ok(r); w = writes()[-1]; self.assertEqual((w[0], w[1]), ("PUT", f"/api/attendance/classes/{C5B}/teachers")); self.assertEqual(w[2], {"teacher_ids": [T2], "class_teacher_id": T2})

    def test_remove_teacher(self):
        r = self.chat("head", [{"calls": [("set_class_teachers", {"class_name": "5 A", "remove_teachers": ["meena gupta"], "add_teachers": ["anil"]})]}])
        self.ok(r); self.assertEqual(writes()[-1][2], {"teacher_ids": [T2], "class_teacher_id": None})

    def test_roll_numbers(self):
        r = self.chat("head", [{"calls": [("set_roll_number", {"class_name": "5 A", "student": "priya", "roll_no": 3}), ("set_roll_number", {"class_name": "5 A", "student": "priya", "roll_no": 1}),
                                          ("set_roll_number", {"class_name": "5 A", "student": "priya", "roll_no": 101}), ("auto_assign_rolls", {"class_name": "5 A"}), ("auto_assign_rolls", {"class_name": "5 A", "mode": "name"})]}, {"text": "?"}], auto=True)
        self.assertIn("belongs to Rahul Sharma", self.out(r, 1)["error"]); self.assertIn("1 to 100", self.out(r, 2)["error"])
        self.assertEqual([a["status"] for a in r["actions"]], ["pending"] * 3); self.assertEqual(writes(), [])        # never auto-run
        self.ok(r); w = writes()
        self.assertEqual((w[0][0], w[0][1]), ("PUT", "/api/attendance/rolls")); self.assertEqual({i["student_id"]: i["roll_no"] for i in w[0][2]["items"]}, {S1: 1, S2: 2, S3: 3})
        self.assertEqual(w[1][1], "/api/attendance/rolls/auto"); self.assertEqual(w[1][2]["mode"], "fill"); self.assertEqual(w[2][2]["mode"], "name")


if __name__ == "__main__":
    unittest.main()
