"""Tests for the token-saving layer (toolkit.py + the per-module prompt).  Run:  python -m unittest test_ai_toolkit   (from ai-server/)

The point of these tests: sending less must not mean doing less. They check that
  * nothing a person may use can be lost (every tool belongs to a module, load_tools / auto-load reach the rest),
  * the compact tool text still carries every name, type, enum value, required flag and description,
  * the prompt rules are still all there when their module is loaded,
  * permissions are unchanged (modules only decide what is DESCRIBED, never what is ALLOWED).
"""
import http.server, json, threading, unittest
import agent, toolkit, prompt_rules
from test_ai import Portal, CALLS

ALL_FEATURES = sorted({f for t in agent.TOOLS for f in t[6] if f != "__meta__"})


def person(role="school_admin", features=None):
    return {"id": "99999999-9999-9999-9999-999999999999", "login_id": "boss", "role": role, "school": {"name": "T"},
            "features": ["use_assistant"] + (ALL_FEATURES if features is None else features), "profile": {"full_name": "Boss"}}


def spy(steps):
    """Scripted LLM that also records what it was shown (tool names + the system prompt) at every step."""
    it, seen = iter(steps), []

    def llm(msgs, schemas, system):
        seen.append({"tools": {s["name"] for s in schemas}, "system": system, "n_msgs": len(msgs)})
        s = next(it)
        return {"text": s.get("text", ""), "calls": [{"id": f"c{i}", "name": n, "args": a} for i, (n, a) in enumerate(s.get("calls", []))]}
    return llm, seen


class Mapping(unittest.TestCase):
    def test_every_tool_has_a_module_and_only_two_are_core(self):
        core = {t[0] for t in agent.TOOLS if toolkit.module_of(t[0]) == toolkit.CORE}
        self.assertEqual(core, {"ask_choice", "load_tools"})
        for m in toolkit.MODULES:
            self.assertTrue(any(toolkit.module_of(t[0]) == m for t in agent.TOOLS), m)

    def test_no_tool_listed_twice_or_unknown(self):
        names = {t[0] for t in agent.TOOLS}
        listed = [n for v in toolkit._M.values() for n in v.split()]
        self.assertEqual(len(listed), len(set(listed)))
        self.assertEqual(set(listed) - names, set())

    def test_every_module_has_rules_and_a_blurb(self):
        for m in toolkit.MODULES:
            self.assertIn(m, prompt_rules.BLURB)
            self.assertTrue(prompt_rules.RULES_BY_MODULE[m])
        covered = {n for v in prompt_rules.RULES_BY_MODULE.values() for n in v} | {4, 22}
        self.assertEqual(covered, set(range(1, 23)))


class Prompt(unittest.TestCase):
    def test_all_modules_loaded_gives_back_every_rule_and_every_tool(self):
        u = person("super_admin")
        full = agent.system_prompt(u)
        for n, text in prompt_rules.RULES.items():
            self.assertIn(text, full, f"rule {n}")
        self.assertEqual({s["name"] for s in agent.schemas_for(u)} | {"load_tools"}, {t[0] for t in agent.TOOLS} | {"load_tools"})
        self.assertNotIn("Not loaded now", full)
        self.assertNotIn("load_tools", {s["name"] for s in agent.schemas_for(u)})      # nothing left to load -> the meta-tool is not offered

    def test_module_prompt_contains_only_its_rules_and_lists_the_rest(self):
        u = person()
        p = agent.system_prompt(u, None, {"fees"})
        self.assertIn(prompt_rules.RULES[10], p)
        self.assertNotIn(prompt_rules.RULES[17], p)                    # attendance rules not loaded
        self.assertIn("Not loaded now", p)
        self.assertIn("attendance = ATTENDANCE", p)
        self.assertIn(prompt_rules.RULES[1], p)                        # core rules always there

    def test_rule4_lists_only_loaded_write_tools(self):
        p = agent.system_prompt(person(), None, {"visitors"})
        r4 = [l for l in p.split("\n") if l.startswith("4. ")][0]
        self.assertIn("add_visitor", r4)
        self.assertNotIn("record_fee_payment", r4)
        self.assertIn("only PREPARE an action", r4)

    def test_super_admin_rule_only_for_super_admin(self):
        self.assertIn("22. The user is a super admin", agent.system_prompt(person("super_admin"), None, {"fees"}))
        self.assertNotIn("22. The user is a super admin", agent.system_prompt(person("school_admin"), None, {"fees"}))

    def test_a_person_without_permission_never_sees_the_module_even_in_the_catalog(self):
        u = person("staff", ["my_leave", "mark_attendance", "manage_homework", "view_announcements", "post_announcement", "view_visitors", "add_visitor", "delete_visitor",
                             "view_student_fees", "get_user", "use_messages", "view_my_fees"])
        p = agent.system_prompt(u, None, {"visitors"})
        self.assertNotIn("documents = ", p); self.assertNotIn("generate_payroll", p)      # (my_leave is held, so leave_payroll is legitimately offered)
        self.assertNotIn("record_fee_payment", p)


class Compact(unittest.TestCase):
    def test_render_keeps_names_types_enums_required_and_descriptions(self):
        u = person("super_admin")
        schemas = agent.schemas_for(u)
        text = toolkit.render_tools(schemas)
        for s in schemas:
            self.assertIn(f"## {s['name']}: {s['description']}", text)
            props, req = s["parameters"]["properties"], set(s["parameters"]["required"])
            for k, v in props.items():
                self.assertIn(k + ("*" if k in req else ""), text, f"{s['name']}.{k}")
                for e in v.get("enum", []):
                    self.assertIn(str(e), text)
        # a long description repeated on several tools is written once and referenced afterwards
        self.assertIn("(as in ", text)

    def test_nested_entry_shape_survives(self):
        s = [x for x in agent.schemas_for(person("super_admin")) if x["name"] == "enter_marks"]
        t = toolkit.render_tools(s)
        for word in ("student*", "marks", "absent", "assessment_id*", "entries*"):
            self.assertIn(word, t)

    def test_compact_is_much_smaller_than_json(self):
        u = person("super_admin")
        sc = agent.schemas_for(u)
        old = len("\n".join(f"- {t['name']}: {t['description']} | params: {json.dumps(t['parameters'].get('properties', {}))} | required: {json.dumps(t['parameters'].get('required', []))}" for t in sc))
        self.assertLess(len(toolkit.render_tools(sc)), old * 0.8)


class Router(unittest.TestCase):
    def sel(self, text, state=None, feats=None, **kw):
        u = person(features=feats)
        return toolkit.select(text, {} if state is None else state, agent.allowed_tools(u), **kw)

    def test_typical_requests_load_the_right_module(self):
        cases = {
            "Rahul ki fees kitni baaki hai?": "fees", "Collect Rs. 12,000 cash from Aarav Patel": "fees", "रसीद चाहिए": "fees",
            "Mark attendance for 6A: Sumeet and Priya are absent": "attendance", "आज की हाज़िरी": "attendance",
            "Issue a Transfer Certificate for Rohan Sharma": "documents", "generate report cards for 9A": "documents",
            "Apply for 2 days medical leave next Monday": "leave_payroll", "run payroll for last month": "leave_payroll", "सैलरी स्लिप": "leave_payroll",
            "give homework to 5A": "homework", "Send a notice to all Class 10 parents": "communication", "post an announcement": "communication",
            "enter marks of unit test maths": "academics", "परीक्षा का रिज़ल्ट": "academics", "who came to visit today": "visitors", "आज के विज़िटर": "visitors",
            "reset password of Mr Sharma": "users", "create a student Ravi in 5 A": "users", "how many teachers": "users",
        }
        for text, mod in cases.items():
            self.assertIn(mod, self.sel(text), text)

    def test_unrelated_modules_stay_out(self):
        m = self.sel("Rahul ki fees kitni baaki hai?")
        self.assertEqual(m, {"fees"})
        self.assertEqual(self.sel("mark attendance for 6A, Priya absent"), {"attendance"})

    def test_nothing_recognised_falls_back_to_people_lookup(self):
        self.assertEqual(self.sel("hello there"), {"users"})

    def test_follow_ups_keep_the_module(self):
        st = {}
        self.assertEqual(self.sel("Collect Rs 500 from Aarav", st), {"fees"})
        for follow in ("yes", "cash", "Aarav Patel (5 A, roll 3)"):         # ask_choice answers carry no keyword
            self.assertIn("fees", self.sel(follow, st))

    def test_module_expires_after_a_few_unrelated_turns(self):
        st = {}
        self.sel("Collect Rs 500 from Aarav", st)
        for _ in range(toolkit.STICKY_TURNS):
            self.sel("mark attendance 6A absent", st)
        self.assertNotIn("fees", self.sel("mark attendance 6A absent", st))

    def test_attached_files_load_homework(self):
        self.assertIn("homework", self.sel("post this", has_files=True))

    def test_small_toolsets_get_everything(self):
        u = person("parent", ["view_my_fees", "view_my_documents", "view_my_academics"])
        al = agent.allowed_tools(u)
        self.assertLessEqual(len(al), toolkit.SMALL_TOOLSET)
        self.assertEqual(toolkit.select("hi", {}, al), set(toolkit.available_modules(al)))

    def test_kill_switch_loads_everything(self):
        import os
        os.environ["AI_TOKEN_SAVER"] = "off"
        try:
            self.assertEqual(self.sel("hello"), set(toolkit.available_modules(agent.allowed_tools(person()))))
        finally:
            del os.environ["AI_TOKEN_SAVER"]

    def test_modules_without_permission_are_never_selected(self):
        u = person("staff", ["my_leave"])
        self.assertEqual(self.sel("collect fee payroll homework", feats=["my_leave"]) - {"leave_payroll"}, set())


class History(unittest.TestCase):
    def conv(self):
        big = json.dumps({"rows": ["x" * 50] * 60})
        return [{"role": "user", "text": "a"}, {"role": "assistant", "text": "", "calls": [{"id": "1", "name": "list_users", "args": {}}]},
                {"role": "tool", "results": [{"id": "1", "name": "list_users", "content": big}]}, {"role": "assistant", "text": "done", "calls": []},
                {"role": "user", "text": "b"}, {"role": "assistant", "text": "", "calls": [{"id": "2", "name": "list_users", "args": {}}]},
                {"role": "tool", "results": [{"id": "2", "name": "list_users", "content": big}]}]

    def test_old_results_trimmed_current_kept(self):
        out = toolkit.compact_history(self.conv())
        self.assertLess(len(out[2]["results"][0]["content"]), 700)
        self.assertIn("trimmed", out[2]["results"][0]["content"])
        self.assertEqual(out[6]["results"][0]["content"], self.conv()[6]["results"][0]["content"])

    def test_stored_conversation_is_not_modified(self):
        c = self.conv(); before = json.dumps(c)
        toolkit.compact_history(c)
        self.assertEqual(json.dumps(c), before)

    def test_window_starts_on_a_user_message(self):
        c = []
        for i in range(20):
            c += self.conv()
        out = toolkit.compact_history(c, window=30)
        self.assertEqual(out[0]["role"], "user"); self.assertLessEqual(len(out), 30)


class InChat(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import http.server
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Portal)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        agent.CFG.update(node=f"http://127.0.0.1:{cls.srv.server_port}", provider="velona", gemini_key="x", model="m", school="Test School")

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def setUp(self): CALLS.clear(); agent.invalidate_lists(); agent.PENDING.clear(); agent.CONVS.clear()

    def test_first_step_only_sees_the_routed_module(self):
        llm, seen = spy([{"text": "ok"}]); agent.llm = llm
        agent.chat("admin", person(), None, "Rahul ki fees kitni baaki hai?")
        t = seen[0]["tools"]
        self.assertIn("find_fee_student", t); self.assertIn("ask_choice", t); self.assertIn("load_tools", t)
        self.assertNotIn("mark_attendance", t); self.assertNotIn("issue_document", t); self.assertNotIn("search_users", t)
        self.assertIn(prompt_rules.RULES[10], seen[0]["system"]); self.assertNotIn(prompt_rules.RULES[17], seen[0]["system"])

    def test_load_tools_brings_in_the_module_next_step(self):
        llm, seen = spy([{"calls": [("load_tools", {"modules": ["attendance"]})]}, {"text": "ok"}]); agent.llm = llm
        agent.chat("admin", person(), None, "Rahul ki fees kitni baaki hai?")
        self.assertNotIn("mark_attendance", seen[0]["tools"]); self.assertIn("mark_attendance", seen[1]["tools"])
        self.assertIn(prompt_rules.RULES[17], seen[1]["system"]); self.assertIn("find_fee_student", seen[1]["tools"])       # what was loaded stays

    def test_load_tools_aliases_and_unknown_names(self):
        ctx = {"avail_mods": {"leave_payroll", "fees"}, "load": set()}
        r = agent.t_load_tools({"modules": ["Payroll", "leave & payroll", "nonsense", "fees"]}, ctx)
        self.assertEqual(ctx["load"], {"leave_payroll", "fees"}); self.assertEqual(r["not_available"], ["nonsense"])

    def test_load_tools_cannot_unlock_a_module_without_permission(self):
        llm, seen = spy([{"calls": [("load_tools", {"modules": ["fees", "payroll"]})]}, {"text": "ok"}]); agent.llm = llm
        u = person("staff", ["my_leave", "mark_attendance"])
        agent.chat("t", u, None, "mark attendance 6A")
        self.assertNotIn("find_fee_student", seen[1]["tools"]); self.assertNotIn("generate_payroll", seen[1]["tools"])

    def test_calling_a_tool_of_an_unloaded_module_still_runs_and_loads_it(self):
        llm, seen = spy([{"calls": [("visitors", {})]}, {"text": "ok"}]); agent.llm = llm
        agent.chat("admin", person(), None, "Rahul ki fees kitni baaki hai?")
        self.assertNotIn("visitors", seen[0]["tools"]); self.assertIn("add_visitor", seen[1]["tools"])

    def test_permissions_unchanged_by_modules(self):
        llm, seen = spy([{"calls": [("generate_payroll", {})]}, {"text": "no"}]); agent.llm = llm
        u = person("staff", ["my_leave"])
        r = agent.chat("t", u, None, "run payroll for last month")
        self.assertEqual(r["actions"], []); self.assertEqual([c for c in CALLS if c[0] == "POST"], [])

    def test_conversation_remembers_modules_between_turns(self):
        llm, seen = spy([{"text": "which mode?"}, {"text": "ok"}]); agent.llm = llm
        r = agent.chat("admin", person(), None, "Collect Rs 500 from Aarav")
        agent.chat("admin", person(), r["conversation_id"], "cash")
        self.assertIn("record_fee_payment", seen[1]["tools"])

    def test_prompt_is_much_smaller_than_before(self):
        llm, seen = spy([{"text": "ok"}]); agent.llm = llm
        agent.chat("admin", person("super_admin"), None, "Rahul ki fees kitni baaki hai?")
        sch = agent.schemas_for(person("super_admin"), {"fees"})
        small = len(agent._tool_protocol(sch, seen[0]["system"]))
        full = len(agent._tool_protocol(agent.schemas_for(person("super_admin")), agent.system_prompt(person("super_admin"))))
        self.assertLess(small, full * 0.25)


REAL_LLM = agent.llm          # other test files replace agent.llm with stubs; the speed tests need the real one


class Speed(unittest.TestCase):
    def setUp(self):
        agent.llm = REAL_LLM
        self.sent = []
        self.orig = agent._http_json
        agent._THINK_REJECTED.clear()
        agent.CFG.update(provider="velona", gemini_key="x", model="m", thinking="low")

    def tearDown(self):
        agent._http_json = self.orig
        agent.CFG["thinking"] = "low"; agent._THINK_REJECTED.clear()

    def fake(self, reject=False):
        def f(url, headers, body):
            self.sent.append(dict(body))
            if reject and "thinking" in body:
                raise agent.ErpError("AI provider error 400: unknown field thinking")
            return {"data": {"output": '{"text": "ok", "calls": []}'}}
        agent._http_json = f

    def run_velona(self):
        return agent._llm_velona([{"role": "user", "text": "hi"}], [], "sys")

    def test_thinking_level_is_sent(self):
        self.fake(); self.run_velona()
        self.assertEqual(self.sent[0]["thinking"], "low")

    def test_default_thinking_is_low_and_can_be_turned_off(self):
        import os
        for k in ("GEMINI_THINKING",): os.environ.pop(k, None)
        agent.init({"VELONA_API_KEY": "x", "AI_PROVIDER": "velona", "VELONA_MODEL": "anthropic/claude-haiku-5.5"})
        self.assertEqual(agent.CFG["thinking"], "low")
        self.assertEqual(agent.CFG["model"], "anthropic/claude-haiku-5.5")
        agent.CFG["thinking"] = "low"
        agent.init({"VELONA_API_KEY": "x", "AI_PROVIDER": "velona", "VELONA_MODEL": "m", "GEMINI_THINKING": "off"})
        self.fake(); self.run_velona()
        self.assertNotIn("thinking", self.sent[0])

    def test_gateway_that_rejects_the_field_gets_one_retry_without_it(self):
        self.fake(reject=True); r = self.run_velona()
        self.assertEqual(r["text"], "ok")
        self.assertIn("thinking", self.sent[0]); self.assertNotIn("thinking", self.sent[1])
        self.sent.clear(); self.run_velona()                       # remembered: no more rejected attempts
        self.assertEqual(len(self.sent), 1); self.assertNotIn("thinking", self.sent[0])

    def test_other_gateway_errors_are_not_retried(self):
        def boom(url, headers, body):
            self.sent.append(dict(body)); raise agent.ErpError("AI provider error 500: overloaded")
        agent._http_json = boom
        with self.assertRaises(agent.ErpError): self.run_velona()
        self.assertEqual(len(self.sent), 1)

    def test_anthropic_has_no_700_token_cap(self):
        import os
        agent.CFG.update(provider="anthropic", anthropic_key="k", model="claude-haiku-5-5")
        self.sent.clear()
        def f(url, headers, body):
            self.sent.append(dict(body)); return {"content": [{"type": "text", "text": "hi"}]}
        agent._http_json = f
        agent.llm([{"role": "user", "text": "hi"}], [], "s")
        self.assertGreaterEqual(self.sent[0]["max_tokens"], 4096)
        self.assertNotEqual(self.sent[0]["max_tokens"], 700)

    def test_latency_is_recorded(self):
        import time as _t
        before = agent.toolkit.TIMES["calls"]
        self.fake(); self.run_velona()
        self.assertEqual(agent.toolkit.TIMES["calls"], before + 1)


if __name__ == "__main__":
    unittest.main()
