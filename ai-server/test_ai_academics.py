"""Offline test of the ACADEMICS tools (fake portal + scripted LLM). Run:  python -m unittest test_ai_academics   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

C5A = "c5a00000-0000-0000-0000-000000000001"; C5B = "c5b00000-0000-0000-0000-000000000002"
S1 = "51111111-1111-1111-1111-111111111111"; S2 = "52222222-2222-2222-2222-222222222222"; S3 = "53333333-3333-3333-3333-333333333333"; S4 = "54444444-4444-4444-4444-444444444444"
SUB_M = "b1000000-0000-0000-0000-000000000001"; SUB_E = "b2000000-0000-0000-0000-000000000002"
EX1 = "d1000000-0000-0000-0000-000000000001"
SESS1 = "f1000000-0000-0000-0000-000000000001"; SESS0 = "f0000000-0000-0000-0000-000000000000"
A1 = "e1000000-0000-0000-0000-000000000001"; A2 = "e2000000-0000-0000-0000-000000000002"
KID = "55555555-5555-5555-5555-555555555555"
CLASSES = [{"id": C5A, "name": "5", "section": "A", "level": 5, "label": "5 A"}, {"id": C5B, "name": "5", "section": "B", "level": 5, "label": "5 B"}]
META = {"today": "2026-10-16", "sessions": [{"id": SESS1, "name": "2026-27", "is_current": True}, {"id": SESS0, "name": "2025-26", "is_current": False}], "current_session_id": SESS1,
        "subjects": [{"id": SUB_M, "name": "Maths", "code": "MAT"}, {"id": SUB_E, "name": "English", "code": None}],
        "exams": [{"id": EX1, "name": "Half-yearly", "session_id": SESS1, "start_date": "2026-09-20", "end_date": "2026-09-30"}], "classes": CLASSES, "pass_percent": 33}
ASM1 = {"id": A1, "kind": "test", "exam_id": None, "exam_name": None, "class_id": C5A, "class_label": "5 A", "subject_id": SUB_M, "subject_name": "Maths", "title": "Unit test 1", "date": "2026-10-10",
        "max_marks": 20, "session_id": SESS1, "entered": 3, "absent": 1, "total_students": 4, "avg_pct": 56.7, "highest": 18, "lowest": 6, "passed": 2}
ASM2 = dict(ASM1, id=A2, kind="exam", exam_id=EX1, exam_name="Half-yearly", subject_id=SUB_E, subject_name="English", title="Half-yearly", max_marks=100, entered=0, absent=0, avg_pct=None, highest=None, lowest=None, passed=0)
SHEET = [{"student_id": S1, "full_name": "Rahul Sharma", "roll_no": 1, "marks": 18, "absent": False, "entered": True},
         {"student_id": S2, "full_name": "Rahul Verma", "roll_no": 2, "marks": None, "absent": False, "entered": False},
         {"student_id": S3, "full_name": "Priya Singh", "roll_no": 3, "marks": 6, "absent": False, "entered": True},
         {"student_id": S4, "full_name": "Amit Das", "roll_no": 4, "marks": None, "absent": True, "entered": True}]
fin = lambda o, m, c, ab=0: {"obtained": o, "max": m, "count": c, "absent": ab, "pct": round(o / m * 100, 1) if m else None, "grade": "B" if m and o / m >= .7 else "F"}
CLASS_REP = {"class": {"id": C5A, "label": "5 A"}, "session_id": SESS1, "scope": "all", "subjects": [{"id": SUB_M, "name": "Maths"}, {"id": SUB_E, "name": "English"}],
             "students": [{"student_id": S1, "full_name": "Rahul Sharma", "roll_no": 1, "total": fin(90, 100, 2), "grade": "A+", "rank": 1},
                          {"student_id": S2, "full_name": "Rahul Verma", "roll_no": 2, "total": fin(0, 0, 0), "grade": None, "rank": None},
                          {"student_id": S3, "full_name": "Priya Singh", "roll_no": 3, "total": fin(20, 100, 2), "grade": "F", "rank": 2}],
             "subject_avgs": {SUB_M: 70.5, SUB_E: 40}, "summary": {"students": 3, "with_marks": 2, "assessments": 2, "class_avg": 55, "passed": 1, "top": {"name": "Rahul Sharma", "pct": 90}}, "pass_percent": 33}
DASH = {"student": {"id": S3, "name": "Priya Singh", "roll_no": 3, "class_label": "5 A"}, "sessions": META["sessions"], "session_id": SESS1,
        "summary": {"overall": fin(20, 100, 2), "tests": fin(6, 20, 1), "exams": fin(14, 80, 1)},
        "subjects": [{"subject_id": SUB_M, "name": "Maths", "overall": fin(6, 20, 1), "tests": fin(6, 20, 1), "exams": fin(0, 0, 0), "recent": []},
                     {"subject_id": SUB_E, "name": "English", "overall": fin(14, 80, 1), "tests": fin(0, 0, 0), "exams": fin(14, 80, 1), "recent": []}],
        "tests": [{"id": A1, "title": "Unit test 1", "subject": "Maths", "date": "2026-10-10", "marks": 6, "max_marks": 20, "absent": False, "pct": 30, "class_avg_pct": 56.7}],
        "exams": [{"exam_id": EX1, "name": "Half-yearly", "total": fin(14, 80, 1), "failed": 1, "papers": [{"subject": "English", "marks": 14, "max_marks": 80, "absent": False, "pct": 17.5, "grade": "F"}]}], "pass_percent": 33}
F = {"Bearer teacher": ["use_assistant", "manage_assessments"],
     "Bearer head": ["use_assistant", "manage_subjects", "manage_exams", "manage_assessments", "view_academic_reports", "academics_all_classes", "get_all_users_school"],
     "Bearer subj": ["use_assistant", "manage_subjects", "manage_exams"], "Bearer viewer": ["use_assistant", "view_academic_reports"], "Bearer parent": ["use_assistant", "view_my_academics"]}
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
            if p == "/api/academics/meta": return self._send(200, dict(META, classes=CLASSES if ("manage_assessments" in f or "view_academic_reports" in f) else []))
            if p == "/api/academics/reports/class": return self._send(200, CLASS_REP)
            if p == f"/api/academics/reports/student/{S3}": return self._send(200, DASH)
            if p == "/api/academics/assessments":
                rows = [ASM1, ASM2]
                if q.get("kind"): rows = [r for r in rows if r["kind"] == q["kind"][0]]
                if q.get("exam_id"): rows = [r for r in rows if r["exam_id"] == q["exam_id"][0]]
                if q.get("subject_id"): rows = [r for r in rows if r["subject_id"] == q["subject_id"][0]]
                return self._send(200, rows)
            if p == f"/api/academics/assessments/{A1}": return self._send(200, {"assessment": ASM1, "students": SHEET})
            if p == f"/api/academics/assessments/{A2}": return self._send(200, {"assessment": ASM2, "students": [dict(s, marks=None, absent=False, entered=False) for s in SHEET]})
            if p == "/api/academics/my": return self._send(200, dict(DASH, student=dict(DASH["student"], id=q["student_id"][0])) if q.get("session_id", [""])[0] != SESS0 else dict(DASH, session_id=SESS0))
            if p == "/api/fees/my": return self._send(200, [{"student_id": KID, "full_name": "Kid One", "class_label": "5 A"}])
            if p == "/api/users": return self._send(200, [{"user_id": S3, "login_id": "priya.singh", "role": "student", "is_active": True, "profile": {"full_name": "Priya Singh", "roll_no": 3}}])
            if p == "/api/classes": return self._send(200, [])
            return self._send(404, {"error": "Not found"})
        self._send(200, {"ok": True, "assessment": dict(ASM1, entered=4)})

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
        u = agent.verify_user(tok); return [agent.confirm(tok, u, c["id"], r["conversation_id"]) for c in r["actions"] if c["status"] == "pending"]

    def test_permissions(self):
        t, h, s, v, p = (agent.allowed_tools(agent.verify_user(x)) for x in ("teacher", "head", "subj", "viewer", "parent"))
        self.assertLessEqual({"academics_overview", "academic_assessments", "assessment_marks", "create_assessment", "enter_marks", "update_assessment", "delete_assessment"}, t)
        self.assertFalse({"student_academics", "class_academics", "find_academic_student", "add_subject", "create_exam", "my_academics"} & t)
        self.assertLessEqual({"find_academic_student", "student_academics", "class_academics", "add_subject", "update_subject", "delete_subject", "create_exam", "update_exam", "delete_exam", "enter_marks"}, h)
        self.assertEqual({"academics_overview", "add_subject", "create_exam"}, s & {"academics_overview", "add_subject", "create_exam", "enter_marks", "assessment_marks", "class_academics"})
        self.assertIn("class_academics", v); self.assertNotIn("enter_marks", v); self.assertNotIn("add_subject", v)
        self.assertEqual({"my_academics", "ask_choice"}, p & {"my_academics", "ask_choice", "class_academics", "enter_marks"})

    def test_overview(self):
        r = self.chat("head", [{"calls": [("academics_overview", {})]}, {"text": "ok"}])
        o = self.out(r); self.assertEqual(o["current_session"], "2026-27"); self.assertEqual(o["subjects"], ["Maths (MAT)", "English"]); self.assertEqual(o["exams"][0]["exam"], "Half-yearly"); self.assertEqual(o["classes_you_can_use"], ["5 A", "5 B"]); self.assertEqual(o["pass_percent"], 33)

    def test_find_student(self):
        r = self.chat("head", [{"calls": [("find_academic_student", {"query": "rahul", "class_name": "5a"}), ("find_academic_student", {"query": "priya singh"})]}, {"text": "ok"}])
        self.assertEqual(self.out(r, 0)["match_status"], "ambiguous"); o = self.out(r, 1); self.assertEqual(o["match_status"], "single_clear"); self.assertEqual(o["results"][0]["id"], S3); self.assertNotIn("class_label", o["results"][0])
        r = self.chat("viewer", [{"calls": [("find_academic_student", {"query": "priya"})]}, {"text": "?"}])
        self.assertIn("which class", self.out(r)["error"])

    def test_student_results(self):
        r = self.chat("head", [{"calls": [("student_academics", {"student_id": S3, "session": "2025-26"}), ("student_academics", {"student_id": S3, "subject": "maths"})]}, {"text": "ok"}])
        self.assertTrue(any(f"session_id={SESS0}" in c[1] for c in CALLS))
        o = self.out(r, 1); self.assertEqual(o["overall"]["percent"], 20); self.assertEqual([s["subject"] for s in o["subjects"]], ["Maths"]); self.assertEqual(o["subjects_below_pass_mark"], ["Maths"])
        self.assertEqual(o["latest_tests"][0]["marks"], "6/20"); self.assertEqual(o["session"], "2026-27"); self.assertNotIn("papers", o["exams"][0])        # the English paper is filtered out by the subject
        self.assertIn("No session", self.out(self.chat("head", [{"calls": [("student_academics", {"student_id": S3, "session": "1999"})]}, {"text": "?"}]))["error"])

    def test_class_results(self):
        r = self.chat("viewer", [{"calls": [("class_academics", {"class_name": "5 A", "limit": 1}), ("class_academics", {"class_name": "5 A", "scope": "half-yearly"}), ("class_academics", {"class_name": "5 A", "scope": "tests"})]}, {"text": "ok"}])
        o = self.out(r, 0); self.assertEqual(o["ranking"][0]["name"], "Rahul Sharma"); self.assertTrue(o["more_not_shown"])
        self.assertEqual([b["name"] for b in o["below_pass_mark"]], ["Priya Singh"]); self.assertEqual(o["students_without_marks"], 1); self.assertEqual(o["subject_averages_percent"], {"Maths": 70.5, "English": 40}); self.assertEqual(o["summary"]["class_avg"], 55)
        self.assertEqual(self.out(r, 1)["scope"], "Half-yearly"); self.assertTrue(any(f"scope={EX1}" in c[1] for c in CALLS)); self.assertTrue(any("scope=tests" in c[1] for c in CALLS))

    def test_assessments_and_marks(self):
        r = self.chat("teacher", [{"calls": [("academic_assessments", {}), ("academic_assessments", {"kind": "exam", "subject": "eng"}), ("assessment_marks", {"assessment_id": A1, "show": "not_entered"}),
                                             ("assessment_marks", {"assessment_id": A1, "show": "below_pass"}), ("assessment_marks", {"assessment_id": A1, "show": "absent"})]}, {"text": "ok"}])
        o = self.out(r, 0); self.assertEqual(o["total"], 2); self.assertEqual(o["assessments"][0]["marks_entered"], "3/4")
        o = self.out(r, 1); self.assertEqual(o["total"], 1); self.assertEqual(o["assessments"][0]["type"], "exam paper")
        o = self.out(r, 2); self.assertEqual([s["name"] for s in o["students"]], ["Rahul Verma"]); self.assertEqual(o["not_entered_count"], 1)
        self.assertEqual([s["name"] for s in self.out(r, 3)["students"]], ["Priya Singh"]); self.assertEqual([s["name"] for s in self.out(r, 4)["students"]], ["Amit Das"])

    def test_my_academics_parent(self):
        r = self.chat("parent", [{"calls": [("my_academics", {}), ("my_academics", {"session": "2025-26"})]}, {"text": "ok"}])
        o = self.out(r, 0); self.assertEqual(o["children"][0]["student_id"], KID); self.assertEqual(o["children"][0]["overall"]["percent"], 20)
        self.assertEqual(self.out(r, 1)["children"][0]["session"], "2025-26")

    def test_enter_marks_confirm_and_body(self):
        r = self.chat("teacher", [{"calls": [("enter_marks", {"assessment_id": A1, "entries": [{"student": "verma", "marks": 15}, {"student": "1", "marks": 19}, {"student": "priya", "absent": True}]})]}], auto=True)
        a = r["actions"][0]; self.assertEqual(a["status"], "pending"); self.assertEqual(writes(), [])                      # never auto-run: families are notified
        t = " ".join(a["lines"]); self.assertIn("Rahul Verma (2): 15 / 20", t); self.assertIn("Rahul Sharma (1): 18 → 19 / 20", t); self.assertIn("Priya Singh (3): 6 → absent", t); self.assertIn("2 student(s) already had", a["footer"])
        res = self.ok(r, "teacher")[0]; self.assertTrue(res["ok"]); self.assertIn("Marks saved for 3 student(s) of 5 A", res["message"])
        w = writes()[-1]; self.assertEqual((w[0], w[1]), ("PUT", f"/api/academics/assessments/{A1}/marks")); self.assertEqual(w[3], "ai-assistant")
        self.assertEqual({i["student_id"]: (i["marks"], i["absent"]) for i in w[2]["items"]}, {S2: (15.0, False), S1: (19.0, False), S3: (None, True)})

    def test_enter_marks_refusals(self):
        r = self.chat("teacher", [{"calls": [("enter_marks", {"assessment_id": A1, "entries": [{"student": "verma", "marks": 25}]}), ("enter_marks", {"assessment_id": A1, "entries": [{"student": "rahul", "marks": 5}]}),
                                             ("enter_marks", {"assessment_id": A1, "entries": [{"student": "verma", "marks": 5}, {"student": "2", "marks": 6}]}), ("enter_marks", {"assessment_id": A1, "entries": [{"student": "verma"}]}),
                                             ("enter_marks", {"assessment_id": A1, "entries": [{"student": "1", "marks": 18}]}), ("enter_marks", {"assessment_id": A1, "entries": [{"student": "verma", "marks": -1}]}),
                                             ("enter_marks", {"assessment_id": A1, "entries": []}), ("enter_marks", {"assessment_id": "nope", "entries": [{"student": "1", "marks": 1}]})]}, {"text": "?"}])
        e = [self.out(r, i)["error"] for i in range(8)]
        self.assertIn("more than the maximum of 20", e[0]); self.assertIn("could be", e[1]); self.assertIn("listed twice", e[2]); self.assertIn("No marks for", e[3]); self.assertIn("already entered", e[4])
        self.assertIn("0 or more", e[5]); self.assertIn("Give the marks", e[6]); self.assertIn("Invalid", e[7]); self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])

    def test_create_test_and_exam_paper(self):
        r = self.chat("teacher", [{"calls": [("create_assessment", {"class_name": "5 A", "subject": "maths", "max_marks": 25, "title": "Unit test 2", "date": "yesterday"}),
                                             ("create_assessment", {"class_name": "5 B", "subject": "english", "max_marks": 100, "kind": "exam", "exam": "half"}),
                                             ("create_assessment", {"class_name": "5 B", "subject": "english", "max_marks": 100, "kind": "exam"}),
                                             ("create_assessment", {"class_name": "5 A", "subject": "maths", "max_marks": 0, "title": "x"}),
                                             ("create_assessment", {"class_name": "5 A", "subject": "maths", "max_marks": 20}),
                                             ("create_assessment", {"class_name": "5 A", "subject": "science", "max_marks": 20, "title": "x"}),
                                             ("create_assessment", {"class_name": "5 A", "subject": "maths", "max_marks": 20, "title": "Unit test 1"})]}, {"text": "?"}], auto=True)
        self.assertEqual(len(r["actions"]), 3); self.assertTrue(all(a["status"] == "done" for a in r["actions"]))         # creating a test notifies nobody: auto-confirm may run it
        self.assertIn("Which exam", self.out(r, 2)["error"]); self.assertIn("more than 0", self.out(r, 3)["error"]); self.assertIn("needs a title", self.out(r, 4)["error"]); self.assertIn('No subject "science"', self.out(r, 5)["error"])
        w = writes(); self.assertEqual(w[0][2]["date"], "2026-10-15"); self.assertEqual((w[0][2]["kind"], w[0][2]["class_id"], w[0][2]["subject_id"], w[0][2]["max_marks"]), ("test", C5A, SUB_M, 25.0))
        self.assertEqual((w[1][2]["kind"], w[1][2]["exam_id"], w[1][2]["title"], w[1][2]["date"]), ("exam", EX1, "Half-yearly", "2026-09-20"))
        self.assertIn("already has a test called Unit test 1", r["actions"][2]["footer"])

    def test_edit_and_delete_assessment_always_confirm(self):
        r = self.chat("teacher", [{"calls": [("update_assessment", {"assessment_id": A1, "max_marks": 25, "title": "Unit test one"}), ("update_assessment", {"assessment_id": A1, "title": "Unit test 1"}), ("delete_assessment", {"assessment_id": A1})]}, {"text": "?"}], auto=True)
        self.assertIn("Nothing to change", self.out(r, 1)["error"]); self.assertEqual([a["status"] for a in r["actions"]], ["pending", "pending"]); self.assertEqual(writes(), [])
        self.assertIn("Maximum marks: 20 → 25", r["actions"][0]["lines"]); self.assertIn("Marks of 3 student(s) are deleted too.", r["actions"][1]["lines"])
        self.ok(r, "teacher"); w = writes(); self.assertEqual((w[0][0], w[0][1]), ("PATCH", f"/api/academics/assessments/{A1}")); self.assertEqual(w[0][2], {"title": "Unit test one", "max_marks": 25.0}); self.assertEqual((w[1][0], w[1][1]), ("DELETE", f"/api/academics/assessments/{A1}"))

    def test_subjects(self):
        r = self.chat("subj", [{"calls": [("add_subject", {"name": "Science", "code": "SCI"}), ("add_subject", {"name": "maths"}), ("update_subject", {"subject": "english", "code": "ENG"}), ("update_subject", {"subject": "maths", "new_name": "Mathematics"}),
                                          ("update_subject", {"subject": "maths", "code": "MAT"}), ("delete_subject", {"subject": "english"})]}, {"text": "?"}], auto=True)
        self.assertIn("already exists", self.out(r, 1)["error"]); self.assertIn("Nothing to change", self.out(r, 4)["error"])
        self.assertEqual([a["status"] for a in r["actions"]], ["done", "done", "done", "pending"]); self.assertEqual(len(writes()), 3)                    # delete waits for Confirm
        w = writes(); self.assertEqual((w[0][0], w[0][1], w[0][2]), ("POST", "/api/academics/subjects", {"name": "Science", "code": "SCI"})); self.assertEqual(w[1][2], {"name": "English", "code": "ENG"}); self.assertEqual(w[2][2], {"name": "Mathematics", "code": "MAT"})
        self.ok(r); self.assertEqual((writes()[-1][0], writes()[-1][1]), ("DELETE", f"/api/academics/subjects/{SUB_E}"))

    def test_exams(self):
        r = self.chat("subj", [{"calls": [("create_exam", {"name": "Final", "start_date": "2027-03-01", "end_date": "2027-03-10"}), ("create_exam", {"name": "half-yearly"}), ("create_exam", {"name": "Final", "start_date": "2027-03-10", "end_date": "2027-03-01"}),
                                          ("update_exam", {"exam": "half", "end_date": "2026-10-02"}), ("update_exam", {"exam": "half", "clear_dates": True}), ("delete_exam", {"exam": "half-yearly"})]}, {"text": "?"}], auto=True)
        self.assertIn("already has an exam", self.out(r, 1)["error"]); self.assertIn("before the start", self.out(r, 2)["error"])
        self.assertEqual([a["status"] for a in r["actions"]], ["done", "done", "done", "pending"]); w = writes()
        self.assertEqual(w[0][2], {"name": "Final", "start_date": "2027-03-01", "end_date": "2027-03-10"})
        self.assertEqual(w[1][2], {"name": "Half-yearly", "start_date": "2026-09-20", "end_date": "2026-10-02"})            # the start date is kept, or the portal would erase it
        self.assertEqual(w[2][2], {"name": "Half-yearly", "start_date": None, "end_date": None}); self.ok(r); self.assertEqual((writes()[-1][0], writes()[-1][1]), ("DELETE", f"/api/academics/exams/{EX1}"))

    def test_roles_cannot_cross(self):
        r = self.chat("teacher", [{"calls": [("add_subject", {"name": "Art"}), ("create_exam", {"name": "Final"}), ("class_academics", {"class_name": "5 A"})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])
        r = self.chat("subj", [{"calls": [("enter_marks", {"assessment_id": A1, "entries": [{"student": "1", "marks": 3}]}), ("create_assessment", {"class_name": "5 A", "subject": "maths", "max_marks": 10, "title": "x"})]}, {"text": "no"}])
        self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])
        r = self.chat("viewer", [{"calls": [("enter_marks", {"assessment_id": A1, "entries": [{"student": "1", "marks": 3}]})]}, {"text": "no"}]); self.assertEqual(r["actions"], []); self.assertEqual(writes(), [])


if __name__ == "__main__":
    unittest.main()
