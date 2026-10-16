"""Offline test of the DOWNLOAD CARDS in the chat (receipts, statements, fee reports, issued documents).
Run:  python -m unittest test_ai_downloads   (from ai-server/)"""
import http.server, json, threading, unittest, urllib.parse
import agent

S1 = "11111111-1111-1111-1111-111111111111"
PAY = "55555555-5555-5555-5555-555555555555"
DOC = "88888888-8888-8888-8888-888888888888"
CLERK = ["use_assistant", "view_student_fees", "collect_fees"]
PARENT = ["use_assistant", "view_my_fees", "view_my_documents"]
REGISTRAR = ["use_assistant", "view_issued_documents", "issue_documents"]
CALLS = []


def view():
    return {"student": {"student_id": S1, "full_name": "Sumit Pal", "class_label": "5 A", "roll_no": 3, "admission_no": "A101"},
            "session": {"id": "ss", "name": "2026-27", "is_current": True}, "today": "2026-10-16", "has_structure": True, "items": [],
            "ledger": {"lines": [], "totals": {"total": 24000, "paid": 12000, "pending": 12000, "due_till_date": 12000, "next_due_date": None, "next_due_amount": 0, "excess": 0}},
            "payments": [{"id": PAY, "receipt_no": "RCP-000012", "amount": 6000, "paid_on": "2026-10-10", "mode": "cash", "status": "received"}], "adjustments": [], "contacts": []}


class Portal(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def _who(self):
        return {"Bearer clerk": CLERK, "Bearer parent": PARENT, "Bearer registrar": REGISTRAR}.get(self.headers.get("Authorization", ""))

    def do_GET(self):
        f = self._who()
        if f is None: return self._send(401, {"error": "Please sign in"})
        u = urllib.parse.urlsplit(self.path); p = u.path
        CALLS.append(("GET", self.path))
        if p == "/api/auth/me":
            role = "parent" if f is PARENT else "school_admin"
            return self._send(200, {"user_id": "99999999-9999-9999-9999-999999999999", "login_id": "x", "role": role, "features": f, "profile": {"full_name": "X"}, "catalog": {}})
        if p == "/api/fees/payments":
            return self._send(200, {"from": "2026-10-01", "to": "2026-10-16", "summary": {"receipts": 1, "total": 6000, "cancelled_receipts": 0, "by_mode": [], "by_class": []}, "rows": [
                {"id": PAY, "receipt_no": "RCP-000012", "student_name": "Sumit Pal", "class_label": "5 A", "amount": 6000, "paid_on": "2026-10-10", "mode": "cash", "status": "received"}]})
        if p == "/api/fees/pending":
            return self._send(200, {"summary": {"session": {"name": "2026-27"}, "as_of": "2026-10-16", "students_owing": 0, "total_pending": 0}, "rows": []})
        if p == f"/api/fees/students/{S1}": return self._send(200, view())
        if p == "/api/fees/my": return self._send(200, [{"student_id": S1, "full_name": "Sumit Pal", "class_label": "5 A", "summary": {}}])
        if p == f"/api/fees/my/{S1}": return self._send(200, view())
        if p == "/api/documents/issued":
            return self._send(200, {"rows": [{"id": DOC, "serial_no": "BON/2026/0003", "doc_type": "bonafide", "subject_name": "Sumit Pal", "status": "issued"}]})
        if p == "/api/documents/my":
            return self._send(200, [{"id": DOC, "serial_no": "BON/2026/0003", "doc_type": "bonafide", "subject_name": "Sumit Pal", "status": "issued", "mine": False}])
        if p == f"/api/documents/issued/{DOC}":
            return self._send(200, {"id": DOC, "serial_no": "BON/2026/0003", "doc_type": "bonafide", "subject_name": "Sumit Pal", "status": "issued", "content": {"title": "x"}})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        f = self._who(); n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if f is None: return self._send(401, {"error": "Please sign in"})
        CALLS.append(("POST", self.path))
        if self.path.endswith("/payments"):
            return self._send(201, {"payment": {"id": PAY, "receipt_no": "RCP-000013"}, "account": {"ledger": {"totals": {"pending": 7000}}}})
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
        agent.CFG.update(node=f"http://127.0.0.1:{cls.srv.server_port}", provider="velona", gemini_key="x", model="m", school="Test School")

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def setUp(self): CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear(); agent._AUTH_CACHE.clear()

    def chat(self, token, steps, auto=False, text="x"):
        agent.llm = scripted(steps)
        return agent.chat(token, agent.verify_user(token), None, text, auto)

    def test_receipt_by_number(self):
        r = self.chat("clerk", [{"calls": [("get_receipt", {"receipt_no": "rcp-000012"})]}, {"text": "Receipt card below"}])
        self.assertEqual(len(r["downloads"]), 1); d = r["downloads"][0]
        self.assertEqual(d["kind"], "file"); self.assertEqual(d["path"], f"/fees/payments/{PAY}/receipt"); self.assertEqual(d["filename"], "RCP-000012.pdf"); self.assertEqual(d["format"], "PDF")

    def test_latest_receipt_of_student_and_no_duplicates(self):
        r = self.chat("clerk", [{"calls": [("get_receipt", {"student_id": S1}), ("get_receipt", {"receipt_no": "RCP-000012"})]}, {"text": "ok"}])
        self.assertEqual(len(r["downloads"]), 1)                                  # the same file is never listed twice

    def test_statement_and_reports(self):
        r = self.chat("clerk", [{"calls": [("get_fee_statement", {"student_id": S1}), ("get_fee_report", {"report": "pending", "format": "csv", "class_name": "5", "min_pending": 5000}),
                                           ("get_fee_report", {"report": "collection", "period": "this_month"})]}, {"text": "ok"}])
        paths = [d["path"] for d in r["downloads"]]
        self.assertIn(f"/fees/students/{S1}/statement", paths)
        pend = next(d for d in r["downloads"] if "pending" in d["path"])
        self.assertIn("format=csv", pend["path"]); self.assertIn("class_name=5", pend["path"]); self.assertIn("min_pending=5000", pend["path"]); self.assertEqual(pend["format"], "CSV"); self.assertTrue(pend["filename"].endswith(".csv"))
        col = next(d for d in r["downloads"] if "payments/download" in d["path"])
        self.assertIn("period=this_month", col["path"]); self.assertIn("format=pdf", col["path"])

    def test_bad_report_filters_are_explained_not_downloaded(self):
        r = self.chat("clerk", [{"calls": [("get_fee_report", {"report": "collection", "period": "next_year"}), ("get_fee_report", {"report": "pending", "format": "xml"})]}, {"text": "no"}])
        self.assertEqual(r["downloads"], [])
        outs = [json.loads(x["content"]) for x in agent.CONVS[r["conversation_id"]]["messages"][2]["results"]]
        self.assertIn("period must be", outs[0]["error"]); self.assertIn("format must be", outs[1]["error"])

    def test_confirmed_payment_brings_its_receipt_card(self):
        r = self.chat("clerk", [{"calls": [("record_fee_payment", {"student_id": S1, "amount": 5000, "mode": "upi"})]}])
        self.assertEqual(r["downloads"], []); card = r["actions"][0]; self.assertEqual(card["downloads"], [])      # nothing before Confirm
        out = agent.confirm("clerk", agent.verify_user("clerk"), card["id"], r["conversation_id"])
        self.assertEqual(len(out["downloads"]), 1); self.assertEqual(out["downloads"][0]["path"], f"/fees/payments/{PAY}/receipt")
        self.assertEqual(out["action"]["downloads"][0]["filename"], "RCP-000013.pdf")

    def test_parent_gets_own_receipt_and_statement_only(self):
        r = self.chat("parent", [{"calls": [("get_receipt", {}), ("get_fee_statement", {"child": "sumit"}), ("get_fee_report", {"report": "pending"})]}, {"text": "ok"}])
        paths = [d["path"] for d in r["downloads"]]
        self.assertEqual(paths, [f"/fees/payments/{PAY}/receipt", f"/fees/my/{S1}/statement"])                       # no school routes, no staff report
        out = json.loads(agent.CONVS[r["conversation_id"]]["messages"][2]["results"][2]["content"]); self.assertEqual(out, {"error": "Unknown tool"})

    def test_document_card_by_serial_for_staff_and_parent(self):
        for tok in ("registrar", "parent"):
            agent.CONVS.clear()
            r = self.chat(tok, [{"calls": [("get_document_file", {"serial_no": "bon/2026/0003"})]}, {"text": "ok"}])
            d = r["downloads"][0]
            self.assertEqual((d["kind"], d["path"], d["filename"]), ("document", f"/documents/issued/{DOC}", "BON-2026-0003.pdf"))

    def test_card_even_if_model_forgets_the_download_tool(self):
        r = self.chat("clerk", [{"calls": [("student_fees", {"student_id": S1})]}, {"text": "Sumit's last receipt is RCP-000012"}], text="send me Sumit's receipt")
        self.assertEqual([d["path"] for d in r["downloads"]], [f"/fees/payments/{PAY}/receipt"])
        r = self.chat("registrar", [{"calls": [("issued_documents", {"query": "sumit"})]}, {"text": "found"}], text="download the bonafide of Sumit")
        self.assertEqual([d["kind"] for d in r["downloads"]], ["document"])
        r = self.chat("parent", [{"calls": [("my_documents", {})]}, {"text": "you have one"}], text="show my certificate")
        self.assertEqual(len(r["downloads"]), 1)

    def test_no_card_for_plain_questions(self):
        r = self.chat("clerk", [{"calls": [("student_fees", {"student_id": S1})]}, {"text": "pending 12000"}], text="how much does Sumit owe")
        self.assertEqual(r["downloads"], [])

    def test_no_card_when_nothing_found(self):
        r = self.chat("registrar", [{"calls": [("get_document_file", {"serial_no": "NOPE/1"})]}, {"text": "none"}])
        self.assertEqual(r["downloads"], [])


if __name__ == "__main__":
    unittest.main()
