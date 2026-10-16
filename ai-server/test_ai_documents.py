"""Offline test of the DOCUMENTS tools (fake portal + scripted LLM). Run:  python -m unittest test_ai_documents   (from ai-server/)"""
import http.server, json, os, shutil, subprocess, tempfile, threading, unittest, urllib.parse
import agent

S1 = "51111111-1111-1111-1111-111111111111"; S2 = "52222222-2222-2222-2222-222222222222"; S3 = "53333333-3333-3333-3333-333333333333"
T1 = "a1111111-1111-1111-1111-111111111111"
D1 = "d1111111-1111-1111-1111-111111111111"; D2 = "d2222222-2222-2222-2222-222222222222"
SESS_NOW = "e0000000-0000-0000-0000-000000000001"; SESS_OLD = "e0000000-0000-0000-0000-000000000002"
EX1 = "f1111111-1111-1111-1111-111111111111"; EX2 = "f2222222-2222-2222-2222-222222222222"
PEOPLE = {
    S1: {"id": S1, "name": "Sumeet Pal", "login_id": "sumeet.pal", "role": "student", "kind": "student", "class_label": "5 A", "roll_no": 3, "admission_no": "A-101", "designation": "", "employee_id": "", "inactive": False},
    S2: {"id": S2, "name": "Sumit Verma", "login_id": "sumit.verma", "role": "student", "kind": "student", "class_label": "6 B", "roll_no": 9, "admission_no": "A-202", "designation": "", "employee_id": "", "inactive": False},
    S3: {"id": S3, "name": "Priya Singh", "login_id": "priya.singh", "role": "student", "kind": "student", "class_label": "5 A", "roll_no": 4, "admission_no": "A-103", "designation": "", "employee_id": "", "inactive": True},
    T1: {"id": T1, "name": "Meena Gupta", "login_id": "meena.gupta", "role": "staff", "kind": "staff", "class_label": "", "roll_no": None, "admission_no": "", "designation": "Maths Teacher", "employee_id": "E-7", "inactive": False},
}
CLASSES = [{"id": "c5a00000-0000-0000-0000-000000000001", "label": "5 A"}, {"id": "c6b00000-0000-0000-0000-000000000002", "label": "6 B"}]
META = {"letterhead": {"name": "Demo School", "principal_name": "Dr Rao", "principal_title": "Principal", "place": "Pune", "tagline": "", "reg_line": "", "footer_note": "", "logo_url": "https://x/logo.png", "signature_url": "", "seal_url": ""},
        "settings": {"principal_name": "Dr Rao", "principal_title": "Principal", "place": "Pune", "logo_url": "https://x/logo.png"},
        "templates": {}, "sessions": [{"id": SESS_NOW, "name": "2026-27", "is_current": True}, {"id": SESS_OLD, "name": "2025-26", "is_current": False}],
        "classes": CLASSES, "today": "2026-10-16"}
ISSUED = [{"id": D1, "doc_type": "bonafide", "serial_no": "BON/2026/0001", "subject_id": S1, "subject_name": "Sumeet Pal", "subject_role": "student", "class_label": "5 A", "title": "Bonafide certificate",
           "status": "issued", "issued_at": "2026-10-10T08:00:00Z", "issued_by_name": "Office", "cancelled_at": None, "cancel_reason": None},
          {"id": D2, "doc_type": "transfer", "serial_no": "TC/2026/0001", "subject_id": S3, "subject_name": "Priya Singh", "subject_role": "student", "class_label": "5 A", "title": "Transfer certificate",
           "status": "cancelled", "issued_at": "2026-09-01T08:00:00Z", "issued_by_name": "Office", "cancelled_at": "2026-09-02T08:00:00Z", "cancel_reason": "wrong name"}]
F = {"Bearer admin": ["use_assistant", "issue_documents", "view_issued_documents", "cancel_document", "manage_doc_templates", "view_my_documents"],
     "Bearer clerk": ["use_assistant", "issue_documents"], "Bearer parent": ["use_assistant", "view_my_documents"], "Bearer nobody": ["use_assistant"]}
ROLE = {"Bearer parent": "parent", "Bearer admin": "school_admin"}
STATE = {"meta": None}
CALLS = []


def report(session_id=None, exam_ids=None):
    sid = session_id or SESS_NOW
    exams = [{"exam_id": EX1, "name": "Unit Test 1"}, {"exam_id": EX2, "name": "Half Yearly"}]
    if exam_ids is not None:
        exams = [e for e in exams if e["exam_id"] in exam_ids]
    subj = [{"name": "Maths", "obtained": 80, "max": 100, "pct": 80, "grade": "A"}] if exams else []
    return {"session_id": sid, "session_name": "2025-26" if sid == SESS_OLD else "2026-27", "sessions": META["sessions"],
            "available_exams": [{"exam_id": EX1, "name": "Unit Test 1", "pct": 70}, {"exam_id": EX2, "name": "Half Yearly", "pct": 75}], "exams": exams, "subjects": subj,
            "grand": {"obtained": 80, "max": 100, "pct": 80, "grade": "A"}, "result": "PASS" if subj else "", "failed_subjects": [], "attendance": {"present": 90, "total": 100, "pct": 90}}


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _go(self, method):
        tok = self.headers.get("Authorization", ""); f = F.get(tok)
        if f is None: return self._send(401, {"error": "Please sign in"})
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}") if n else None
        u = urllib.parse.urlsplit(self.path); p = u.path; q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        CALLS.append((method, self.path, body, self.headers.get("x-via")))
        if method == "GET":
            if p == "/api/auth/me": return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": ROLE.get(tok, "staff"), "features": f, "profile": {"full_name": "X"}, "catalog": {}})
            if p == "/api/documents/meta": return self._send(200, STATE["meta"])
            if p == "/api/documents/people":
                kind, needle, cid = q.get("kind"), q.get("q", "").lower(), q.get("class_id")
                rows = [r for r in PEOPLE.values() if r["kind"] == kind and (not needle or needle in r["name"].lower() or needle in r["login_id"])]
                if cid: rows = [r for r in rows if r["class_label"] == {c["id"]: c["label"] for c in CLASSES}[cid]]
                return self._send(200, rows)
            if p.startswith("/api/documents/people/") and p.endswith("/prefill"):
                pid = p.split("/")[4]; person = PEOPLE.get(pid)
                if not person: return self._send(404, {"error": "Person not found"})
                if q["type"] in ("bonafide", "transfer", "report_card") and person["kind"] != "student": return self._send(400, {"error": f"A {q['type']} cannot be issued to this person"})
                subject = {"id": pid, "role": person["role"], "kind": person["kind"], "name": person["name"], "gender": "Male", "dob": "2015-04-02", "father": "Raj Pal", "mother": "Sita Pal", "address": "Pune",
                           "class_label": person["class_label"], "admission_no": person["admission_no"], "roll_no": person["roll_no"], "designation": person["designation"], "department": "", "employee_id": person["employee_id"],
                           "joining_date": "2020-06-01" if person["kind"] == "staff" else "", "qualification": ""}
                out = {"subject": subject, "session_name": "2026-27", "inactive": person["inactive"]}
                if q["type"] == "report_card":
                    ids = q["exam_ids"].split(",") if q.get("exam_ids") and q["exam_ids"] != "none" else ([] if q.get("exam_ids") == "none" else None)
                    out["report"] = report(q.get("session_id"), ids)
                return self._send(200, out)
            if p == "/api/documents/issued":
                rows = ISSUED
                if q.get("q"): rows = [r for r in rows if q["q"].lower() in r["serial_no"].lower() or q["q"].lower() in r["subject_name"].lower()]
                if q.get("status"): rows = [r for r in rows if r["status"] == q["status"]]
                if q.get("type"): rows = [r for r in rows if r["doc_type"] == q["type"]]
                return self._send(200, {"rows": rows, "total": len(rows), "page": 0, "limit": 50})
            if p.startswith("/api/documents/issued/"):
                r = next((x for x in ISSUED if x["id"] == p.split("/")[-1]), None)
                return self._send(200, dict(r, content={})) if r else self._send(404, {"error": "Document not found"})
            if p == "/api/documents/my": return self._send(200, [dict(ISSUED[0], mine=False)])
            return self._send(404, {"error": "Not found"})
        if method == "POST" and p == "/api/documents/issue": return self._send(201, {"id": "new", "serial_no": "BON/2026/0002", "title": body["title"], "subject_name": "x"})
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

    def setUp(self):
        CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear(); agent._AUTH_CACHE.clear()
        STATE["meta"] = json.loads(json.dumps(META))

    def chat(self, tok, steps, auto=False):
        agent.llm = scripted(steps)
        return agent.chat(tok, agent.verify_user(tok), None, "x", auto)

    def out(self, r, i=0): return json.loads(agent.CONVS[r["conversation_id"]]["messages"][2]["results"][i]["content"])

    def ok(self, r, tok="admin"):
        u = agent.verify_user(tok); return [agent.confirm(tok, u, c["id"], r["conversation_id"]) for c in r["actions"]]

    def issue_body(self): return next(c for c in writes() if c[1].startswith("/api/documents/issue"))[2]

    # ---------------------------------------------------------------- who gets which tools
    def test_permissions(self):
        a, c, p, n = (agent.allowed_tools(agent.verify_user(x)) for x in ("admin", "clerk", "parent", "nobody"))
        docs = {"document_types", "find_document_person", "issued_documents", "my_documents", "issue_document", "cancel_document", "update_document_settings", "update_document_template", "reset_document_template"}
        self.assertLessEqual(docs, a)
        self.assertLessEqual({"document_types", "find_document_person", "issued_documents", "issue_document"}, c)
        self.assertFalse({"cancel_document", "update_document_settings", "update_document_template", "reset_document_template", "my_documents"} & c)
        self.assertEqual(docs & p, {"my_documents"})
        self.assertFalse(docs & n)

    def test_built_in_wording_matches_the_web_app(self):
        """agent.DOC_TYPES is a copy of client/src/docRender.js: fail loudly when someone changes one and not the other."""
        js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client", "src", "docRender.js")
        if not (shutil.which("node") and os.path.exists(js)): self.skipTest("node or client/src/docRender.js not available")
        tmp = tempfile.mkdtemp()
        try:
            shutil.copy(js, os.path.join(tmp, "dr.mjs"))
            with open(os.path.join(tmp, "d.mjs"), "w") as fh: fh.write("import {TYPES,DESIGNS} from './dr.mjs';console.log(JSON.stringify({t:Object.fromEntries(Object.entries(TYPES).map(([k,t])=>[k,{label:t.label,for:t.kind,title:t.title,orientation:t.orientation,body:t.body,body_staff:t.bodyStaff||null,"
                                                      "fields:t.fields.map(f=>({key:f.key,label:f.label,date:f.type==='date',required:!!f.required,kind:f.kind||null}))}])),d:Object.fromEntries(DESIGNS.map(d=>[d.id,d.accent]))}))")
            web = json.loads(subprocess.run(["node", "d.mjs"], cwd=tmp, capture_output=True, text=True, check=True).stdout)
        finally: shutil.rmtree(tmp, ignore_errors=True)
        self.assertEqual(web["d"], agent.DOC_DESIGNS)
        self.assertEqual(set(web["t"]), set(agent.DOC_TYPES))
        for k, w in web["t"].items():
            m = agent.DOC_TYPES[k]
            self.assertEqual({x: w[x] for x in ("label", "for", "title", "orientation", "body", "body_staff")}, {x: m[x] for x in ("label", "for", "title", "orientation", "body", "body_staff")}, k)
            self.assertEqual([(f["key"], f["label"], f["date"], f["required"], f["kind"]) for f in w["fields"]],
                             [(f["key"], f["label"], f.get("type") == "date", bool(f.get("required")), f.get("kind")) for f in m["fields"]], k)

    # ---------------------------------------------------------------- read tools
    def test_document_types(self):
        STATE["meta"]["templates"] = {"bonafide": {"doc_type": "bonafide", "body": "Own words {{name}}", "design": "royal", "settings": {}}}
        r = self.chat("admin", [{"calls": [("document_types", {})]}, {"text": "ok"}]); o = self.out(r)
        b = next(t for t in o["types"] if t["type"] == "bonafide")
        self.assertEqual((b["wording"], b["design"]), ("school's own", "royal"))
        self.assertTrue(next(t for t in o["types"] if t["type"] == "activity")["extra_details"][0]["required"])
        self.assertEqual(o["letterhead"]["principal_name"], "Dr Rao"); self.assertTrue(o["letterhead"]["logo"]); self.assertFalse(o["letterhead"]["seal"])

    def test_find_person_fuzzy_and_ambiguous(self):
        r = self.chat("clerk", [{"calls": [("find_document_person", {"query": "sumeet pal"})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual(o["match_status"], "single_clear"); self.assertEqual(o["results"][0]["id"], S1)
        r = self.chat("clerk", [{"calls": [("find_document_person", {"query": "sumit"})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual(o["match_status"], "ambiguous"); self.assertEqual({x["id"] for x in o["results"]}, {S1, S2})
        r = self.chat("clerk", [{"calls": [("find_document_person", {"query": "zzzz"})]}, {"text": "ok"}]); self.assertEqual(self.out(r)["match_status"], "none")
        r = self.chat("clerk", [{"calls": [("find_document_person", {"query": "meena", "kind": "staff"})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual(o["results"][0]["designation"], "Maths Teacher")

    def test_find_person_class_list(self):
        r = self.chat("clerk", [{"calls": [("find_document_person", {"class_name": "5a"})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual({x["name"] for x in o["results"]}, {"Sumeet Pal", "Priya Singh"}); self.assertEqual(o["match_status"], "list")
        r = self.chat("clerk", [{"calls": [("find_document_person", {})]}, {"text": "?"}]); self.assertIn("query is required", self.out(r)["error"])

    def test_register_and_my_documents(self):
        r = self.chat("admin", [{"calls": [("issued_documents", {"status": "cancelled"})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual([d["serial_no"] for d in o["documents"]], ["TC/2026/0001"]); self.assertEqual(o["documents"][0]["cancel_reason"], "wrong name")
        self.assertTrue(any("status=cancelled" in c[1] for c in CALLS))
        r = self.chat("admin", [{"calls": [("issued_documents", {"type": "tc", "query": "priya"})]}, {"text": "ok"}]); self.assertTrue(any("type=transfer" in c[1] and "q=priya" in c[1] for c in CALLS))
        r = self.chat("parent", [{"calls": [("my_documents", {})]}, {"text": "ok"}]); o = self.out(r)
        self.assertEqual(o["documents"][0]["issued_to"], "Sumeet Pal"); self.assertEqual(o["total"], 1)

    # ---------------------------------------------------------------- issuing
    def test_issue_bonafide_uses_builtin_wording_and_always_confirms(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": S1, "purpose": "bank account"})]}, {"text": "x"}], auto=True)   # auto-confirm must not skip it
        self.assertEqual(writes(), []); card = r["actions"][0]; self.assertEqual(card["status"], "pending")
        self.assertIn("Purpose: bank account", card["lines"]); self.assertIn("Academic session: 2026-27", card["lines"])
        self.assertIn("numbered document", card["footer"])
        res = self.ok(r)[0]; self.assertTrue(res["ok"]); self.assertIn("BON/2026/0002", res["message"])
        b = self.issue_body()
        self.assertEqual(b["type"], "bonafide"); self.assertEqual(b["subject_id"], S1); self.assertEqual(b["body"], agent.DOC_TYPES["bonafide"]["body"])
        self.assertEqual((b["title"], b["design"], b["accent"], b["orientation"], b["inset"]), ("BONAFIDE CERTIFICATE", "classic", "#1f3a6e", "portrait", 18))
        self.assertEqual(b["fields"], {"purpose": "bank account", "session": "2026-27"}); self.assertNotIn("subject", b)
        self.assertEqual(next(c for c in writes())[3], "ai-assistant")

    def test_issue_uses_saved_template_and_staff_wording(self):
        STATE["meta"]["templates"] = {"character": {"doc_type": "character", "title": "CHARACTER", "body": "Student words {{name}}", "design": "royal", "accent": "#112233", "orientation": "landscape",
                                                    "settings": {"inset": 25, "body_staff": "Staff words {{name}}"}}}
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "character", "person_id": T1})]}, {"text": "x"}]); self.ok(r); b = self.issue_body()
        self.assertEqual((b["body"], b["title"], b["design"], b["accent"], b["orientation"], b["inset"]), ("Staff words {{name}}", "CHARACTER", "royal", "#112233", "landscape", 25))
        self.assertEqual(b["fields"], {"conduct": "excellent"})                      # the session field is for students only
        CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear()
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "character", "person_id": S1, "design": "emerald"})]}, {"text": "x"}]); self.ok(r); b = self.issue_body()
        self.assertEqual((b["body"], b["design"], b["accent"]), ("Student words {{name}}", "emerald", "#0f6b4f"))

    def test_required_details_and_ignored_parameters(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "activity", "person_id": S1})]}, {"text": "?"}]); self.assertIn("Activity / event is required", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "award", "person_id": S1, "activity": "Quiz", "achievement": "First Position", "event_date": "2026-10-01", "purpose": "x"})]}, {"text": "x"}])
        c = r["actions"][0]; self.assertIn("Date of event: 1 Oct 2026", c["lines"]); self.assertIn("purpose", c["footer"]); self.ok(r); b = self.issue_body()
        self.assertEqual(b["type"], "activity"); self.assertEqual(b["orientation"], "landscape"); self.assertEqual(b["fields"]["activity"], "Quiz"); self.assertNotIn("purpose", b["fields"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "transfer", "person_id": S1, "leaving_date": "16/10/2026"})]}, {"text": "?"}]); self.assertIn("real date", self.out(r)["error"])

    def test_transfer_defaults(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "tc", "person_id": S1, "reason": "Moving to Delhi"})]}, {"text": "x"}]); self.ok(r); f = self.issue_body()["fields"]
        self.assertEqual((f["nationality"], f["class_studied"], f["leaving_date"], f["reason"], f["promotion"], f["dues"], f["conduct"]), ("Indian", "5 A", "2026-10-16", "Moving to Delhi", "Yes", "Yes", "Good"))

    def test_custom_needs_text_and_valid_placeholders(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "custom", "person_id": S1})]}, {"text": "?"}]); self.assertIn("needs its text", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "custom", "person_id": S1, "body": "Hello {{nickname}}"})]}, {"text": "?"}]); self.assertIn("{{nickname}}", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "custom", "person_id": S1, "title": "NO OBJECTION CERTIFICATE", "body": "{{name}} of {{class}} may join the trip."})]}, {"text": "x"}])
        self.assertTrue(any(l.startswith("Text: ") for l in r["actions"][0]["lines"])); self.ok(r); b = self.issue_body()
        self.assertEqual((b["title"], b["body"]), ("NO OBJECTION CERTIFICATE", "{{name}} of {{class}} may join the trip."))
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": S1, "body": "my own text"})]}, {"text": "?"}]); self.assertIn("template", self.out(r)["error"])

    def test_wrong_person_kind_and_bad_ids(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": T1})]}, {"text": "?"}]); self.assertIn("cannot be issued", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": "not-an-id"})]}, {"text": "?"}]); self.assertIn("Invalid person_id", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "diploma", "person_id": S1})]}, {"text": "?"}]); self.assertIn("Unknown document type", self.out(r)["error"])

    def test_details_correction_and_inactive_note(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": S3, "details": {"father": "Rajesh Singh", "dob": "2014-01-05", "mother": "Sita Pal"}})]}, {"text": "x"}])
        c = r["actions"][0]; self.assertTrue(any("father: Rajesh Singh" in l and "dob: 5 Jan 2014" in l and "mother" not in l for l in c["lines"]))   # unchanged mother is not listed
        self.assertTrue(any("switched off" in l for l in c["lines"])); self.ok(r); self.assertEqual(self.issue_body()["subject"], {"father": "Rajesh Singh", "dob": "2014-01-05"})
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "bonafide", "person_id": S1, "details": {"password": "x"}})]}, {"text": "?"}]); self.assertIn("details can only correct", self.out(r)["error"])

    def test_report_card(self):
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "report_card", "person_id": S1, "exams": ["half yearly"], "include_class_tests": True, "remarks": "Good", "promoted_to": "6 A"})]}, {"text": "x"}])
        c = r["actions"][0]; self.assertTrue(any("exams: Half Yearly" in l for l in c["lines"])); self.assertTrue(any("Result: PASS - overall 80%" in l for l in c["lines"])); self.assertIn("Attendance: 90% (90 of 100 days)", c["lines"])
        self.ok(r); b = self.issue_body()
        self.assertEqual(b["report"], {"session_id": SESS_NOW, "exam_ids": [EX2], "include_tests": True}); self.assertEqual(b["body"], agent.DOC_TYPES["report_card"]["body"])
        self.assertEqual((b["fields"]["remarks"], b["fields"]["promoted_to"]), ("Good", "6 A"))
        CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear()
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "report card", "person_id": S1, "report_session": "2025-26"})]}, {"text": "x"}]); self.ok(r)
        self.assertEqual(self.issue_body()["report"], {"session_id": SESS_OLD, "exam_ids": [EX1, EX2], "include_tests": False})
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "report_card", "person_id": S1, "exams": ["final"]})]}, {"text": "?"}]); self.assertIn("No single exam", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("issue_document", {"type": "report_card", "person_id": S1, "report_session": "1999"})]}, {"text": "?"}]); self.assertIn("No single session", self.out(r)["error"])

    # ---------------------------------------------------------------- cancel
    def test_cancel_by_serial_and_checks(self):
        r = self.chat("admin", [{"calls": [("cancel_document", {"serial_no": "bon/2026/0001", "reason": "wrong class"})]}, {"text": "x"}], auto=True)
        self.assertEqual(writes(), []); c = r["actions"][0]; self.assertIn("Reason: wrong class", c["lines"]); self.assertIn("cannot be undone", c["footer"])
        self.assertTrue(self.ok(r)[0]["ok"]); w = writes()[0]; self.assertEqual((w[0], w[1], w[2]), ("POST", f"/api/documents/issued/{D1}/cancel", {"reason": "wrong class"}))
        r = self.chat("admin", [{"calls": [("cancel_document", {"serial_no": "TC/2026/0001", "reason": "again"})]}, {"text": "?"}]); self.assertIn("already cancelled", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("cancel_document", {"serial_no": "BON/2026/0001", "reason": " "})]}, {"text": "?"}]); self.assertIn("reason is required", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("cancel_document", {"serial_no": "XYZ/1", "reason": "x"})]}, {"text": "?"}]); self.assertIn("No issued document", self.out(r)["error"])
        r = self.chat("admin", [{"calls": [("cancel_document", {"document_id": D1, "reason": "dup"})]}, {"text": "x"}]); self.assertEqual(r["actions"][0]["title"], "CANCEL document BON/2026/0001")

    # ---------------------------------------------------------------- letterhead and templates
    def test_update_letterhead_keeps_everything_else(self):
        r = self.chat("admin", [{"calls": [("update_document_settings", {"principal_name": "Mrs Iyer", "place": "Mumbai", "tagline": ""})]}, {"text": "x"}])
        c = r["actions"][0]; self.assertEqual(c["lines"], ["Principal's name: Dr Rao -> Mrs Iyer", "Place: Pune -> Mumbai"]); self.assertEqual(writes(), [])
        self.ok(r); w = writes()[0]; self.assertEqual((w[0], w[1]), ("PUT", "/api/documents/settings"))
        self.assertEqual((w[2]["principal_name"], w[2]["place"], w[2]["principal_title"], w[2]["logo_url"]), ("Mrs Iyer", "Mumbai", "Principal", "https://x/logo.png"))   # untouched fields are re-sent, not wiped
        r = self.chat("admin", [{"calls": [("update_document_settings", {"place": "Pune"})]}, {"text": "?"}]); self.assertIn("Nothing to change", self.out(r)["error"])
        CALLS.clear(); r = self.chat("admin", [{"calls": [("update_document_settings", {"clear": ["place"]})]}, {"text": "x"}]); self.assertEqual(r["actions"][0]["lines"], ["Place: Pune -> (empty)"])

    def test_update_template_merges_and_validates(self):
        STATE["meta"]["templates"] = {"bonafide": {"doc_type": "bonafide", "title": "BONAFIDE", "body": "Old words {{name}}", "design": "modern", "accent": "#0f5fa8", "orientation": "portrait", "bg_url": None, "settings": {"inset": 30}}}
        r = self.chat("admin", [{"calls": [("update_document_template", {"type": "bonafide", "design": "royal"})]}, {"text": "x"}], auto=True)
        self.assertEqual(writes(), []); self.ok(r); w = writes()[0]; self.assertEqual((w[0], w[1].split("?")[0]), ("PUT", "/api/documents/templates/bonafide"))
        self.assertEqual((w[2]["design"], w[2]["accent"], w[2]["body"], w[2]["title"], w[2]["settings"]), ("royal", "#7a1f2b", "Old words {{name}}", "BONAFIDE", {"inset": 30}))
        for args, msg in (({"type": "bonafide", "design": "neon"}, "design must be"), ({"type": "bonafide", "accent": "red"}, "colour like"), ({"type": "bonafide", "orientation": "tilted"}, "portrait or landscape"),
                          ({"type": "bonafide", "body": "Hi {{nope}}"}, "{{nope}}"), ({"type": "bonafide", "body_staff": "x"}, "one wording only"), ({"type": "bonafide", "design": "modern"}, "Nothing to change")):
            r = self.chat("admin", [{"calls": [("update_document_template", args)]}, {"text": "?"}]); self.assertIn(msg, self.out(r)["error"], args)
        r = self.chat("admin", [{"calls": [("update_document_template", {"type": "character", "body": "For {{name}}.", "body_staff": "Staff {{name}} {{designation}}"})]}, {"text": "x"}]); self.ok(r)
        b = [c for c in writes() if "/templates/character" in c[1]][0][2]; self.assertEqual((b["body"], b["settings"]), ("For {{name}}.", {"inset": 18})); self.assertEqual(b["body_staff"], "Staff {{name}} {{designation}}")

    def test_reset_template(self):
        r = self.chat("admin", [{"calls": [("reset_document_template", {"type": "bonafide"})]}, {"text": "?"}]); self.assertIn("already uses the built-in", self.out(r)["error"])
        STATE["meta"]["templates"] = {"bonafide": {"doc_type": "bonafide", "body": "x", "settings": {}}}; agent.invalidate_lists()
        r = self.chat("admin", [{"calls": [("reset_document_template", {"type": "bonafide"})]}, {"text": "x"}], auto=True); self.assertEqual(writes(), [])
        self.ok(r); w = writes()[0]; self.assertEqual((w[0], w[1]), ("DELETE", "/api/documents/templates/bonafide"))

    def test_clerk_cannot_edit_templates_and_portal_refusal_is_explained(self):
        r = self.chat("clerk", [{"calls": [("update_document_template", {"type": "bonafide", "design": "royal"})]}, {"text": "?"}]); self.assertEqual(self.out(r)["error"], "Unknown tool")
        r = self.chat("clerk", [{"calls": [("issue_document", {"type": "bonafide", "person_id": S1})]}, {"text": "x"}]); self.assertEqual(len(r["actions"]), 1)    # issuing is allowed


if __name__ == "__main__":
    unittest.main()
