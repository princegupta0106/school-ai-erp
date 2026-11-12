"""Offline tests of the one-shot WORKFLOWS (workflows.py).  Run:  python -m unittest test_ai_workflows   (from ai-server/)

The portal is faked at the agent.api() level; the deep lookups (find student, fee view, attendance sheet, document prefill)
are stubbed with the same shapes the real tools return, so what is under test is the workflow logic itself:
  * ONE confirm card for several steps, steps run in order through the normal executors,
  * parents are messaged only when they have a login, names are resolved before the card,
  * dues block a withdrawal, the account switch-off is the LAST step,
  * a failing step stops the run and the message says what was done / not run,
  * routing + permissions: workflows are loaded by keyword and only offered to people who may use them.
"""
import unittest
import agent, toolkit, workflows as W

S1, S2, S3 = ("51111111-1111-1111-1111-111111111111", "52222222-2222-2222-2222-222222222222", "53333333-3333-3333-3333-333333333333")
P1 = "a1111111-1111-1111-1111-111111111111"
USERS = {S1: {"profile": {"full_name": "Rahul Sharma"}, "parents": [{"user_id": P1, "full_name": "Mr Sharma"}]},
         S2: {"profile": {"full_name": "Priya Singh"}, "parents": []},                     # no parent login
         S3: {"profile": {"full_name": "Aman Gupta"}, "parents": [{"user_id": "b1111111-1111-1111-1111-111111111111", "full_name": "Mrs Gupta"}]}}
CALLS, FAIL_ON = [], set()


def fake_api(method, path, token, body=None):
    CALLS.append((method, path, body))
    for key in FAIL_ON:
        if key in path:
            raise agent.ErpError("portal said no")
    if method == "GET" and path.startswith("/users/"):
        return USERS[path.split("/")[-1]]
    if method == "POST" and path == "/communication/conversations":
        return {"id": "conv1"}
    if method == "GET" and path.startswith("/transport/assignments"):
        return {"rows": [{"id": "asg1", "student_id": S1}]}
    return {}


def ctx(auto=False):
    return {"user": {"id": "boss", "features": []}, "token": "t", "cards": [], "downloads": [], "auto": auto}


class WF(unittest.TestCase):
    def setUp(self):
        CALLS.clear(); FAIL_ON.clear(); agent.PENDING.clear()
        self.keep = {k: getattr(agent, k) for k in ("api", "t_mark_attendance", "t_find_fee_student", "t_pending_fees", "fee_view", "t_issue_document", "t_set_active", "fee_sid", "t_post_notice", "t_send_notification")}
        agent.api = fake_api
        agent.fee_sid = lambda c, a, need=False: None

        def mark(a, c):
            recs = [{"student_id": S1, "status": "absent"}, {"student_id": S2, "status": "absent"}, {"student_id": S3, "status": "present"}]
            return agent._register(c, "mark_attendance", "Attendance: 5 A", ["Class 5 A, 2026-10-16", "1 present, 2 absent"], "",
                                   {"body": {"class_id": "c", "date": "2026-10-16", "records": recs}, "name": "5 A", "date": "2026-10-16"})
        agent.t_mark_attendance = mark
        agent.t_find_fee_student = lambda a, c: {"match_status": "single_clear", "results": [{"id": S1, "name": "Rahul Sharma", "class": "5 A", "roll_no": 12}]}
        agent.t_pending_fees = lambda a, c: {"session": "2026-27", "students_owing": 3, "total_pending": 9000, "showing": 3, "students": [
            {"student_id": S1, "name": "Rahul Sharma", "class": "5 A", "pending": 4000}, {"student_id": S2, "name": "Priya Singh", "class": "5 A", "pending": 3000},
            {"student_id": S3, "name": "Aman Gupta", "class": "5 A", "pending": 2000}]}
        agent.fee_view = lambda c, sid, st, ses: {"ledger": {"totals": {"pending": 0}}}
        agent.t_issue_document = lambda a, c: agent._register(c, "issue_document", "Transfer Certificate", ["Rahul Sharma"], "", {"doc": a})
        agent.t_set_active = lambda a, c: agent._register(c, "set_user_active", "Turn OFF: Rahul Sharma", ["Rahul Sharma"], "", {"user_id": a["user_id"], "active": False, "name": "Rahul Sharma"})
        agent.t_post_notice = lambda a, c: agent._register(c, "post_notice", "Post notice", ["notice"], "", {"body": {"title": a["title"]}, "title": a["title"], "to": "The whole school"})
        agent.t_send_notification = lambda a, c: agent._register(c, "send_notification", "Send notification", ["push"], "", {"body": {"title": a["title"]}, "title": a["title"], "to": "everyone"})

    def tearDown(self):
        for k, v in self.keep.items():
            setattr(agent, k, v)

    # ---- one card, steps in order
    def test_absent_followup_is_one_card_and_messages_only_parents_with_a_login(self):
        c = ctx()
        r = W.wf_absent_followup({"class_name": "5 A", "absentees": ["Rahul", "Priya"]}, c)
        self.assertEqual(r["status"], "awaiting_user_confirmation"); self.assertEqual(len(c["cards"]), 1)
        act = next(iter(agent.PENDING.values()))
        self.assertEqual([s["kind"] for s in act["payload"]["steps"]], ["mark_attendance", "send_message"])      # Priya has no parent login
        self.assertIn("Priya Singh", act["footer"])
        self.assertEqual(CALLS and [x for x in CALLS if x[0] != "GET"], [])                                       # nothing written before confirm

    def test_confirm_runs_steps_in_order(self):
        W.wf_absent_followup({"class_name": "5 A", "absentees": ["Rahul"]}, ctx())
        act = next(iter(agent.PENDING.values())); CALLS.clear()
        agent.EXEC["workflow"](act["payload"], "t")
        writes = [(m, p) for m, p, _ in CALLS if m != "GET"]
        self.assertEqual(writes[0], ("PUT", "/attendance/sheet"))
        self.assertEqual(writes[1:], [("POST", "/communication/conversations"), ("POST", "/communication/conversations/conv1/messages")])

    def test_workflows_always_need_a_confirm_tap_even_with_auto_confirm(self):
        c = ctx(auto=True)
        r = W.wf_absent_followup({"class_name": "5 A", "absentees": ["Rahul"]}, c)
        self.assertEqual(r["status"], "awaiting_user_confirmation")
        self.assertEqual([x for x in CALLS if x[0] != "GET"], [])

    # ---- partial failure is explicit
    def test_failure_stops_and_reports_done_and_not_run(self):
        W.wf_absent_followup({"class_name": "5 A", "absentees": ["Rahul"]}, ctx())
        act = next(iter(agent.PENDING.values()))
        FAIL_ON.add("/communication/conversations")
        with self.assertRaises(agent.ErpError) as e:
            agent.execute(act, "t")
        self.assertIn("Stopped at step 2 of 2", str(e.exception)); self.assertIn("Already done", str(e.exception))
        self.assertEqual(act["status"], "failed")

    # ---- fee reminders
    def test_fee_reminders_one_per_parent_with_amount(self):
        W.wf_fee_reminder_campaign({"class_name": "5 A"}, ctx())
        act = next(iter(agent.PENDING.values()))
        texts = [s["payload"]["text"] for s in act["payload"]["steps"]]
        self.assertEqual(len(texts), 2); self.assertIn("4,000", texts[0].replace("₹", "")); self.assertIn("Priya Singh", act["footer"])

    def test_fee_reminders_with_nobody_owing_says_so(self):
        agent.t_pending_fees = lambda a, c: {"students": []}
        with self.assertRaises(agent.ErpError):
            W.wf_fee_reminder_campaign({}, ctx())

    # ---- withdrawal
    def test_withdrawal_blocked_by_dues_unless_told(self):
        agent.fee_view = lambda c, sid, st, ses: {"ledger": {"totals": {"pending": 2500}}}
        with self.assertRaises(agent.ErpError) as e:
            W.wf_student_withdrawal({"student": "Rahul"}, ctx())
        self.assertIn("ignore_dues", str(e.exception))
        self.assertEqual(agent.PENDING, {})
        W.wf_student_withdrawal({"student": "Rahul", "ignore_dues": True}, ctx())
        self.assertEqual(len(agent.PENDING), 1)

    def test_withdrawal_order_certificate_first_account_off_last(self):
        W.wf_student_withdrawal({"student": "Rahul", "reason": "Shifting city"}, ctx())
        kinds = [s["kind"] for s in next(iter(agent.PENDING.values()))["payload"]["steps"]]
        self.assertEqual(kinds, ["issue_document", "wf_transport_remove", "set_user_active"])

    def test_ambiguous_name_stops_with_candidates(self):
        agent.t_find_fee_student = lambda a, c: {"match_status": "ambiguous", "results": [
            {"id": S1, "name": "Rahul Sharma", "class": "5 A", "roll_no": 1}, {"id": S3, "name": "Rahul Verma", "class": "5 B", "roll_no": 2}]}
        with self.assertRaises(agent.ErpError) as e:
            W.wf_student_withdrawal({"student": "Rahul"}, ctx())
        self.assertIn("ask_choice", str(e.exception)); self.assertIn("5 B", str(e.exception))

    # ---- broadcast
    def test_broadcast_notice_push_and_calendar_in_one_card(self):
        W.wf_urgent_broadcast({"title": "School closed", "body": "Closed tomorrow due to rain.", "calendar_date": "2026-11-13", "calendar_type": "holiday"}, ctx())
        steps = next(iter(agent.PENDING.values()))["payload"]["steps"]
        self.assertEqual([s["kind"] for s in steps], ["post_notice", "send_notification", "wf_calendar"])
        CALLS.clear(); agent.EXEC["wf_calendar"](steps[2]["payload"], "t")
        self.assertEqual(CALLS[0][:2], ("POST", "/calendar/holidays")); self.assertEqual(CALLS[0][2]["type"], "holiday")

    def test_broadcast_needs_title_and_body(self):
        with self.assertRaises(agent.ErpError):
            W.wf_urgent_broadcast({"title": "x"}, ctx())

    # ---- admission
    def test_admission_creates_student_then_links_parent(self):
        made = []

        def api(m, p, t, b=None):
            if m == "POST" and p == "/users":
                made.append(b); return {"user_id": f"id{len(made)}", "login_id": b["login_id"]}
            return {}
        agent.api = api
        msg, _ = W._run_admission({"student": {"role": "student", "password": "pw1234", "profile": {"full_name": "Kid"}, "login_id": "kid", "name": "Kid", "generated": True},
                                   "parent": {"role": "parent", "password": "pw5678", "profile": {"full_name": "Dad"}, "login_id": "dad", "name": "Dad", "generated": True}}, "t")
        self.assertEqual(made[1]["children"], ["id1"]); self.assertIn("pw1234", msg)

    # ---- routing + permissions
    def test_routing_and_permissions(self):
        for text in ("withdraw Rahul from school", "send fee reminders to class 5", "what is pending on my desk", "PTM on Saturday", "admission of a new child"):
            self.assertIn("workflows", toolkit.matches(text), text)
        every = [t[0] for t in W._tools()]
        self.assertEqual(len(every), len(set(every)))
        teacher = {"role": "staff", "features": ["use_assistant", "mark_attendance"]}
        ok = agent.allowed_tools(teacher)
        self.assertIn("wf_absent_followup", ok); self.assertNotIn("wf_student_withdrawal", ok); self.assertNotIn("wf_collect_fee", ok)
        self.assertEqual(agent.allowed_tools({"role": "parent", "features": ["use_assistant"]}) & set(every), set())

    def test_rule_is_in_the_prompt_when_the_module_is_loaded(self):
        u = {"role": "school_admin", "features": ["use_assistant", "issue_documents"], "profile": {}, "login_id": "x"}
        self.assertIn("WORKFLOWS", agent.system_prompt(u, mods={"workflows"}))
        self.assertIn("wf_issue_certificate", agent.system_prompt(u, mods={"workflows"}))


if __name__ == "__main__":
    unittest.main()
