"""Predefined one-shot WORKFLOWS for the AI assistant.

Problem: the assistant used one tool per step (find student -> check dues -> issue TC -> turn account off ...), so a
simple sentence cost 4-6 model round-trips and lots of "which one?" questions.

Idea: one tool per real intent. The model only (1) picks the workflow and (2) fills what the user said. The workflow
then does the lookups, defaults, validation and ordering itself and shows ONE confirm card for the whole thing.

How it stays safe (nothing here is new power):
  * Every step is prepared by the SAME `t_*` function the single tools use (same validation, same wording), through a
    capture hook in agent._register: the step is collected instead of becoming its own card.
  * On confirm, the steps run in order through the SAME executors (agent.EXEC) with the signed-in person's token,
    so the portal still checks every permission.
  * Names are resolved BEFORE the card (card shows "Sumeet Sharma, 5 A, roll 12"); an ambiguous name stops with the
    candidates so the model asks once with ask_choice.
  * All write workflows are in ALWAYS_CONFIRM: money, certificates, deactivation and messages never run unseen.
  * Partial failure is explicit: the result says what was done, what failed and what did not run.
    (The portal API has no cross-call transaction, so steps are ordered with the hardest-to-undo ones first and
    the account switch-off last; a failed step stops the run.)

Loaded at the end of agent.py:  import workflows; workflows.register(sys.modules[__name__])
"""
import re

A = None                                   # the agent module, bound by register()
UUID = re.compile(r"^[0-9a-fA-F-]{36}$")
MAX_PARENT_MSGS = 40


# ------------------------------------------------------------------ helpers
def _today(ctx, sid=None):
    try:
        return A._att_today(ctx, sid)
    except Exception:
        return A.datetime.now().strftime("%Y-%m-%d")


def _prep(ctx, fn, args):
    """Run a single tool's prepare-step and return the action(s) it would have shown as a card."""
    c = dict(ctx)
    c["_collect"], c["auto"] = [], False
    fn(args, c)
    return c["_collect"]


def _bundle(ctx, title, steps, head, footer):
    """ONE confirm card for several steps."""
    lines = list(head)
    for i, s in enumerate(steps, 1):
        lines.append(f"Step {i}: {s['title']}")
        lines += ["    " + x for x in (s.get("lines") or [])[:6]]
    payload = {"steps": [{"kind": s["kind"], "payload": s["payload"], "title": s["title"]} for s in steps]}
    return A._register(ctx, "workflow", title, lines, footer, payload)


def _student(ctx, a, key="student"):
    """One student from a name (or id). Ambiguity stops here, with the candidates, so the model asks once."""
    q = str(a.get(key) or "").strip()
    if not q:
        raise A.ErpError(f"Which student? `{key}` is required (name, admission no or login id).")
    if UUID.match(q):
        return {"id": q, "name": q}
    r = A.t_find_fee_student({"query": q, "class_name": a.get("class_name"), "school": a.get("school")}, ctx)
    st, res = r["match_status"], r["results"]
    if st == "single_clear":
        return res[0]
    if st == "none" or not res:
        raise A.ErpError(f'No student matches "{q}". Ask for another spelling or the class.')
    raise A.ErpError(f'More than one student matches "{q}": ' + "; ".join(
        f"{x['name']} ({x.get('class') or 'no class'}, roll {x.get('roll_no') or '-'})" for x in res[:6]) +
        ". Call ask_choice with these, then call this workflow again with class_name.")


def _person(ctx, a, kind, key="person"):
    q = str(a.get(key) or "").strip()
    if not q:
        raise A.ErpError(f"Who is it for? `{key}` is required.")
    if UUID.match(q):
        return {"id": q, "name": q}
    r = A.t_find_document_person({"query": q, "kind": kind, "class_name": a.get("class_name"), "school": a.get("school")}, ctx)
    st, res = r["match_status"], r["results"]
    if st == "single_clear":
        return res[0]
    if st == "none" or not res:
        raise A.ErpError(f'No {kind} matches "{q}". Ask for another spelling.')
    raise A.ErpError(f'More than one {kind} matches "{q}": ' + "; ".join(
        f"{x['name']} ({x.get('class_label') or x.get('designation') or '-'}, roll {x.get('roll_no') or '-'})" for x in res[:6]) +
        ". Call ask_choice with these, then call this workflow again.")


def _label(x):
    return f"{x.get('name')} ({x.get('class') or x.get('class_label') or '-'}" + (f", roll {x['roll_no']}" if x.get("roll_no") else "") + ")"


def _parents(ctx, student_ids):
    """student id -> {name, parents:[{user_id, name}]} (parents with a portal login). Parallel, tolerant."""
    def one(sid):
        try:
            u = A.api("GET", "/users/" + sid, ctx["token"])
        except A.ErpError:
            return sid, {"name": sid, "parents": []}
        nm = (u.get("profile") or {}).get("full_name") or u.get("full_name") or u.get("login_id") or sid
        ps = [{"user_id": p.get("user_id") or p.get("id"), "name": p.get("full_name") or p.get("login_id") or "Parent"} for p in (u.get("parents") or [])]
        return sid, {"name": nm, "parents": [p for p in ps if p["user_id"]]}
    return dict(A._par([lambda s=s: one(s) for s in student_ids]))


def _message_steps(ctx, student_ids, make_text, label):
    """One 'send_message' step per parent login. Returns (steps, students_without_parent_login)."""
    info = _parents(ctx, student_ids[:MAX_PARENT_MSGS])
    steps, nologin = [], []
    for sid in student_ids[:MAX_PARENT_MSGS]:
        d = info.get(sid) or {"name": sid, "parents": []}
        if not d["parents"]:
            nologin.append(d["name"])
            continue
        p = d["parents"][0]                                   # the first linked parent is enough: one message per child
        text = make_text(sid, d["name"])
        steps.append({"kind": "send_message", "title": f"{label}: {p['name']} (parent of {d['name']})", "lines": [text[:160]],
                      "payload": {"user_id": p["user_id"], "text": text[:2000], "name": p["name"]}})
    return steps, nologin


def _section(fn, args, ctx):
    """A read for a summary: a missing permission just leaves the section out."""
    try:
        return fn(args, ctx)
    except A.ErpError as e:
        return {"unavailable": str(e)[:120]}
    except Exception as e:                                    # never let one section break the whole answer
        return {"unavailable": str(e)[:120]}


# ------------------------------------------------------------------ extra step runners (not single tools)
def _create_user(p, token):
    body = {"role": p["role"], "password": p["password"], "profile": p["profile"], "children": p.get("children") or None}
    if p.get("school_id"):
        body["school_id"] = p["school_id"]
    login = p["login_id"]
    for i in range(4):
        try:
            return A.api("POST", "/users", token, {**body, "login_id": login})
        except A.ErpError as e:
            if i == 3 or not p.get("auto_login") or not (e.status == 409 or re.search(r"already|taken|exists|duplicate", str(e), re.I)):
                raise
            login = f"{p['login_id']}{A.secrets.randbelow(90) + 10}"


def _run_admission(p, token):
    stu = _create_user(p["student"], token)
    msg = f"Student {p['student']['name']} created (login {stu['login_id']}" + (f", password {p['student']['password']}" if p["student"].get("generated") else "") + ")."
    if p.get("parent"):
        par = dict(p["parent"], children=[stu["user_id"]])
        try:
            pu = _create_user(par, token)
        except A.ErpError as e:
            raise A.ErpError(f"{msg} The parent account failed: {e}. The student exists; add the parent from Users and link the child.")
        msg += f" Parent {p['parent']['name']} created and linked (login {pu['login_id']}" + (f", password {p['parent']['password']}" if p["parent"].get("generated") else "") + ")."
    return msg + " Fees follow the class fee structure automatically. Share passwords only with the family and ask them to change them.", None


def _run_calendar(p, token):
    body = {"title": p["title"], "start_date": p["date"], "end_date": p.get("end_date") or p["date"], "type": p["type"], "description": p.get("description") or ""}
    if p.get("school_id"):
        body["school_id"] = p["school_id"]
    A.api("POST", "/calendar/holidays", token, body)
    return f"Calendar: \"{p['title']}\" added for {p['date']}.", None


def _run_transport_remove(p, token):
    A.api("DELETE", "/transport/assignments/" + p["assignment_id"], token)
    return f"{p['name']} removed from transport.", None


def _run_workflow(p, token):
    steps, done, downloads = p["steps"], [], []
    for i, s in enumerate(steps):
        try:
            out = A.EXEC[s["kind"]](s["payload"], token)
        except A.ErpError as e:
            left = [x["title"] for x in steps[i + 1:]]
            raise A.ErpError(
                f"Stopped at step {i + 1} of {len(steps)} ({s['title']}): {e}. "
                + ("Already done: " + " | ".join(done) + ". " if done else "Nothing was changed. ")
                + ("Not run: " + " | ".join(left) + ". " if left else "")
                + "Fix the cause and ask again for only the remaining steps.")
        done.append(out[0])
        if len(out) > 2:
            downloads += out[2] or []
    return " ".join(done), None, downloads


# ================================================================ WRITE WORKFLOWS
def wf_issue_certificate(a, ctx):
    """Name + type -> find the person and prepare the certificate in ONE call."""
    t = A.doc_type(a.get("type"))
    kind = a.get("kind") or ("staff" if t == "experience" else "student")
    p = _person(ctx, a, kind)
    return A.t_issue_document({**{k: v for k, v in a.items() if k not in ("person", "kind")}, "person_id": p["id"]}, ctx)


def wf_collect_fee(a, ctx):
    """Student name + amount + mode -> payment card (receipt is made on confirm)."""
    s = _student(ctx, a)
    return A.t_record_payment({**a, "student_id": s["id"]}, ctx)


def wf_urgent_broadcast(a, ctx):
    """Notice on the board + push notification (+ optional calendar entry) as one action."""
    sid = A.fee_sid(ctx, a, need=True)
    title, body = str(a.get("title") or "").strip(), str(a.get("body") or "").strip()
    if not title or not body:
        raise A.ErpError("Need what to announce: `title` (short) and `body` (the full text).")
    aud = {"audience": "class", "class_names": a["class_names"]} if a.get("class_names") else {"audience": "school"}
    steps = _prep(ctx, A.t_post_notice, {"title": title, "body": body, "pinned": a.get("pinned", True), "school": a.get("school"), **aud})
    if a.get("push", True):
        short = str(a.get("push_text") or body)[:300]
        steps += _prep(ctx, A.t_send_notification, {"title": title[:100], "body": short, "who": a.get("who") or "everyone", "school": a.get("school"), **aud})
    if a.get("calendar_date"):
        d = A._vdate(a["calendar_date"], "calendar_date")
        steps.append({"kind": "wf_calendar", "title": f"Add to calendar: {title[:50]} on {d}", "lines": [f"{a.get('calendar_type') or 'event'} on {d}"],
                      "payload": {"title": title[:120], "date": d, "end_date": A._vdate(a["calendar_end"], "calendar_end") if a.get("calendar_end") else d,
                                  "type": a.get("calendar_type") if a.get("calendar_type") in ("holiday", "vacation", "event", "exam") else "event",
                                  "description": body[:500], "school_id": sid}})
    return _bundle(ctx, f"Announce: {title[:50]}", steps, [], "Everything below happens when you confirm. People are notified and this cannot be taken back.")


def wf_absent_followup(a, ctx):
    """Mark a class (rest present) and message the parents of the absent students: one card."""
    sid = A.fee_sid(ctx, a, need=True)
    exc = [{"student": n, "status": "absent"} for n in a.get("absentees") or []] + [{"student": n, "status": "late"} for n in a.get("late") or []]
    if not exc:
        raise A.ErpError("Say who is absent (absentees) and, if any, who is late.")
    marks = _prep(ctx, A.t_mark_attendance, {"class_name": a.get("class_name"), "date": a.get("date"), "default_status": "present", "exceptions": exc, "school": a.get("school")})
    body = marks[0]["payload"]["body"]
    date = body["date"]
    absent_ids = [r["student_id"] for r in body["records"] if r["status"] == "absent"]
    steps = list(marks)
    nologin = []
    if a.get("notify_parents", True) and absent_ids:
        extra = f" {a['message'].strip()}" if str(a.get("message") or "").strip() else " Please let the school know the reason."
        ms, nologin = _message_steps(ctx, absent_ids, lambda sid, nm: f"Dear Parent, {nm} was absent from school on {date}.{extra}", "Message")
        steps += ms
    foot = "Attendance is saved first, then each parent gets a 1-to-1 message from you."
    if nologin:
        foot += " No parent login (not messaged): " + ", ".join(nologin[:8]) + "."
    return _bundle(ctx, f"Attendance + parent follow-up: {marks[0]['payload']['name']}", steps, [], foot)


def wf_fee_reminder_campaign(a, ctx):
    """Find the defaulters and prepare one reminder per parent: one card."""
    sid = A.fee_sid(ctx, a, need=True)
    lim = min(int(a.get("limit") or 25), MAX_PARENT_MSGS)
    r = A.t_pending_fees({"class_name": a.get("class_name"), "min_pending": a.get("min_pending"), "due_now": a.get("due_now", True),
                          "limit": lim, "with_contacts": False, "school": a.get("school")}, ctx)
    rows = r["students"]
    if not rows:
        raise A.ErpError("Nobody has dues for this filter. Nothing to remind.")
    amt = {x["student_id"]: x for x in rows}
    extra = f" {a['message'].strip()}" if str(a.get("message") or "").strip() else " Please pay at the school office at the earliest. Ignore this if you have already paid."
    steps, nologin = _message_steps(
        ctx, [x["student_id"] for x in rows],
        lambda sid, nm: f"Dear Parent, a fee of {A.inr(amt[sid]['pending'])} is pending for {nm} ({amt[sid].get('class') or ''}).{extra}", "Reminder")
    if not steps:
        raise A.ErpError("None of these students has a parent login, so no message can be sent. Call the parents instead: open Fees > Pending fees.")
    head = [f"{len(steps)} reminder(s) for {r['students_owing']} student(s) owing {A.inr(r['total_pending'])} in total ({r['session']})"]
    foot = "Each parent gets a private message from you." + (f" Only the top {r['showing']} by amount are included." if r.get("more_not_shown") else "")
    if nologin:
        foot += " No parent login: " + ", ".join(nologin[:8]) + (" ..." if len(nologin) > 8 else "") + "."
    return _bundle(ctx, "Fee reminders", steps, head, foot)


def wf_student_withdrawal(a, ctx):
    """Dues check -> Transfer Certificate -> off transport -> account off. One card."""
    s = _student(ctx, a)
    sid = A.fee_sid(ctx, a, need=True)
    try:
        view = A.fee_view(ctx, sid, s["id"], None)
        pending = float(view["ledger"]["totals"]["pending"])
    except A.ErpError:
        pending = 0.0
    if pending > 0 and not a.get("ignore_dues"):
        raise A.ErpError(f"{s['name']} still owes {A.inr(pending)}. Clear the dues first (wf_collect_fee), or if the school agrees to let them go, call again with ignore_dues=true.")
    doc = {"type": "transfer", "person_id": s["id"], "school": a.get("school"), "reason": a.get("reason") or "Parent's request"}
    if a.get("leaving_date"):
        doc["leaving_date"] = a["leaving_date"]
    steps = _prep(ctx, A.t_issue_document, doc)
    try:
        rows = (A.api("GET", A.fpath("/transport/assignments", sid, q=s["name"]), ctx["token"]) or {}).get("rows") or []
        mine = [x for x in rows if x.get("student_id") == s["id"] or x.get("user_id") == s["id"]]
        for x in mine[:1]:
            steps.append({"kind": "wf_transport_remove", "title": "Remove from transport", "lines": [s["name"]], "payload": {"assignment_id": x["id"], "name": s["name"]}})
    except A.ErpError:
        pass                                                  # no transport permission / module: skip quietly
    steps += _prep(ctx, A.t_set_active, {"user_id": s["id"], "active": False})
    head = [_label(s), f"Dues: {A.inr(pending)}" + (" (waived by you)" if pending > 0 else " (clear)")]
    return _bundle(ctx, f"Withdraw: {s['name']}", steps, head, "Certificate first, account switch-off last. If a step fails the rest does not run and you are told exactly what was done.")


def wf_staff_exit(a, ctx):
    """Pending-leave warning -> Experience Certificate -> account off. One card."""
    p = _person(ctx, a, "staff", key="staff")
    head, warn = [f"{p['name']} ({p.get('designation') or 'staff'})"], []
    try:
        pend = A.t_leave_requests({"status": "pending", "name_contains": p["name"], "limit": 5, "school": a.get("school")}, ctx)
        if pend.get("total"):
            warn.append(f"{pend['total']} leave request(s) still pending: decide them first")
    except A.ErpError:
        pass
    doc = {"type": "experience", "person_id": p["id"], "school": a.get("school")}
    for k_in, k_out in (("last_working_day", "leaving_date"), ("reason", "reason")):
        if a.get(k_in):
            doc[k_out] = a[k_in]
    steps = _prep(ctx, A.t_issue_document, doc)
    steps += _prep(ctx, A.t_set_active, {"user_id": p["id"], "active": False})
    head += [f"Warning: {w}" for w in warn]
    return _bundle(ctx, f"Staff exit: {p['name']}", steps, head,
                   "Final pay settlement and class-teacher reassignment are separate: run payroll and set_class_teachers if they taught a class.")


def wf_complete_admission(a, ctx):
    """Student account (+ parent account, linked) in one go; fees follow the class fee structure."""
    name, cls = str(a.get("student_name") or "").strip(), a.get("class_name")
    if not name or not cls:
        raise A.ErpError("Need the child's name and the class (student_name, class_name).")
    prof = {k: a[k] for k in ("dob", "gender", "address", "father_name", "mother_name", "father_phone", "mother_phone") if a.get(k)}
    st = _prep(ctx, A.t_create_user, {"full_name": name, "role": "student", "class_name": cls, "school": a.get("school"), **{k: v for k, v in prof.items() if k in A.PROFILE_KEYS}})
    pl = {"student": st[0]["payload"], "parent": None}
    lines = list(st[0]["lines"])
    par_name = str(a.get("parent_name") or a.get("father_name") or a.get("mother_name") or "").strip()
    if par_name and a.get("create_parent", True):
        pp = _prep(ctx, A.t_create_user, {"full_name": par_name, "role": "parent", "school": a.get("school"), **({"phone": a["parent_phone"]} if a.get("parent_phone") else {})})
        pl["parent"] = pp[0]["payload"]
        lines += [f"Parent account: {par_name}, linked to {name}"]
    step = {"kind": "wf_admission", "title": "Create student" + (" and parent" if pl["parent"] else ""), "lines": lines, "payload": pl}
    return _bundle(ctx, f"Admission: {name}", [step], [], "Logins and passwords are shown once after you confirm. Fees start from the class fee structure.")


def wf_ptm_day(a, ctx):
    """Calendar event + notice + push for a parent-teacher meeting: one card."""
    d = A._vdate(a.get("date"), "date")
    time_txt = f" at {a['time']}" if a.get("time") else ""
    title = a.get("title") or "Parent-Teacher Meeting"
    body = str(a.get("body") or f"{title} on {d}{time_txt}. Parents are requested to attend and meet the class teachers.")
    return wf_urgent_broadcast({**a, "title": title, "body": body, "calendar_date": d, "calendar_type": "event", "push": True, "pinned": True}, ctx)


# ================================================================ READ-ONLY WORKFLOWS (instant, no card)
def wf_desk_summary(a, ctx):
    """'What's pending on my desk?' in one answer."""
    sid = A.fee_sid(ctx, a)
    jobs = {
        "leave_pending": lambda: A.t_leave_requests({"status": "pending", "limit": 5, "school": a.get("school")}, ctx),
        "fees": lambda: A.t_pending_fees({"limit": 3, "with_contacts": False, "due_now": True, "school": a.get("school")}, ctx),
        "attendance_today": lambda: A.t_attendance_overview({"school": a.get("school")}, ctx),
        "open_queries": lambda: A.api("GET", A.fpath("/queries", sid, open="1"), ctx["token"]),
    }
    keys = list(jobs)
    out = dict(zip(keys, A._par([lambda k=k: _section(lambda _a, _c: jobs[k](), a, ctx) for k in keys])))
    q = out.get("open_queries")
    if isinstance(q, dict) and "queries" in q:
        out["open_queries"] = {"count": q.get("total", len(q["queries"])), "latest": [str(x.get("subject") or x.get("type_name") or "")[:60] for x in q["queries"][:3]]}
    return {"as_of": _today(ctx, sid), "sections": out, "tip": "Sections marked unavailable are outside this person's permissions: leave them out, do not guess."}


def wf_student_360(a, ctx):
    """Everything about one student: fees, attendance, marks."""
    s = _student(ctx, a)
    args = {"student_id": s["id"], "school": a.get("school")}
    keys = {"fees": A.t_student_fees, "attendance": A.t_student_attendance, "academics": A.t_student_academics}
    res = A._par([lambda f=f: _section(f, args, ctx) for f in keys.values()])
    return {"student": _label(s), **dict(zip(keys, res))}


def wf_month_end_pack(a, ctx):
    """Collection + dues + low attendance + leave for the month, in one answer."""
    period = a.get("period") if a.get("period") in ("this_month", "last_month") else "last_month"
    jobs = {
        "collection": (A.t_fee_collection, {"period": period, "limit": 5}),
        "dues": (A.t_pending_fees, {"limit": 5, "with_contacts": False}),
        "low_attendance": (A.t_low_attendance, {"period": period, "limit": 8}),
        "leave": (A.t_leave_requests, {"status": "pending", "limit": 5}),
    }
    res = A._par([lambda f=f, x=x: _section(f, {**x, "school": a.get("school")}, ctx) for f, x in jobs.values()])
    return {"period": period, **dict(zip(jobs, res)), "tip": "For the Excel/PDF pack use get_fee_report."}


# ================================================================ registry
_N = lambda d: {"type": "number", "description": d}
_B = lambda d: {"type": "boolean", "description": d}
_LIST = lambda d: {"type": "array", "items": {"type": "string"}, "description": d}
_CLS = lambda: _LIST('Class names like "5 A"; omit for the whole school')


def _tools():
    S = lambda d, **kw: {"type": "string", "description": d, **kw}
    sc = A._SCHOOL
    return [
        ("wf_issue_certificate", "ONE-SHOT certificate: give the person's NAME and the type; it finds them, fills the details and shows one confirm card (Bonafide, Character, Transfer, Experience, Activity, Report card). Staff for Experience. Use this instead of find_document_person + issue_document.",
         {"person": S("Student or staff name as the user said it"), "type": A._DOC_TYPE, "kind": S("student (default) or staff", enum=["student", "staff"]), "class_name": S("Student's class, only if the name is ambiguous"),
          **A._DOC_FIELD_PROPS, "details": A._DOC_DETAILS, "school": sc}, ["person", "type"], wf_issue_certificate, True, ["issue_documents"]),
        ("wf_collect_fee", "ONE-SHOT fee collection: student NAME + amount + how paid -> confirm card; receipt is made on confirm. Use instead of find_fee_student + record_fee_payment. If the user did not say cash/UPI/cheque/bank transfer/card, ask (ask_choice).",
         {"student": S("Student name / admission no"), "class_name": S("Class, only if the name is ambiguous"), "amount": _N("Rupees"), "mode": S("How paid", enum=A.FEE_MODES),
          "reference": S("Cheque / UPI reference (optional)"), "paid_on": S("YYYY-MM-DD, default today"), "note": S("Optional note"), "session": S("Session name; empty = current"), "school": sc},
         ["student", "amount", "mode"], wf_collect_fee, True, ["collect_fees"]),
        ("wf_urgent_broadcast", "ONE-SHOT announcement: pins a notice on the board AND sends a push notification (and optionally adds a calendar entry) as ONE confirm card. For closures, holidays, urgent news. Whole school unless class_names given.",
         {"title": S("Short heading"), "body": S("Full text, the user's own words tidied"), "class_names": _CLS(), "who": S("Whole-school push audience", enum=["everyone", "students", "parents", "staff"]),
          "push": _B("Send the push too (default true)"), "push_text": S("Shorter text for the push (max 300)"), "pinned": _B("Pin the notice (default true)"),
          "calendar_date": S("YYYY-MM-DD: also add a calendar entry"), "calendar_end": S("YYYY-MM-DD end date for the entry"), "calendar_type": S("Calendar entry type", enum=["holiday", "vacation", "event", "exam"]), "school": sc},
         ["title", "body"], wf_urgent_broadcast, True, ["post_school_announcement", "post_announcement"]),
        ("wf_absent_followup", "ONE-SHOT attendance: mark a class (everyone else present), mark the absent / late students by NAME, and message each absent student's parent: ONE confirm card. Date defaults to today.",
         {"class_name": S('Class, e.g. "5 A"'), "absentees": _LIST("Names of absent students"), "late": _LIST("Names of late students"), "date": S("YYYY-MM-DD, default today"),
          "notify_parents": _B("Message parents of absentees (default true)"), "message": S("Extra line for the parents (optional)"), "school": sc},
         ["class_name"], wf_absent_followup, True, ["mark_attendance"]),
        ("wf_fee_reminder_campaign", "ONE-SHOT fee reminders: finds students with dues (optionally one class / minimum amount) and prepares a private message to each parent with the amount: ONE confirm card.",
         {"class_name": S("Optional class"), "min_pending": _N("Only dues of at least this many rupees"), "due_now": _B("Only what is already due (default true)"), "limit": _N("Max students, default 25, max 40"),
          "message": S("Extra line for the parents (optional)"), "school": sc}, [], wf_fee_reminder_campaign, True, ["collect_fees", "view_student_fees"]),
        ("wf_student_withdrawal", "ONE-SHOT withdrawal: checks dues, issues the Transfer Certificate, removes the student from transport and turns the account off: ONE confirm card. Stops if dues are pending unless ignore_dues=true.",
         {"student": S("Student name"), "class_name": S("Class, only if ambiguous"), "reason": S("Reason for leaving (default: Parent's request)"), "leaving_date": S("YYYY-MM-DD, default today"),
          "ignore_dues": _B("true ONLY if the user says to proceed despite pending dues"), "school": sc}, ["student"], wf_student_withdrawal, True, ["issue_documents"]),
        ("wf_staff_exit", "ONE-SHOT staff exit: warns about pending leave, issues the Experience Certificate and turns the account off: ONE confirm card.",
         {"staff": S("Employee name"), "last_working_day": S("YYYY-MM-DD"), "reason": S("Reason for leaving"), "school": sc}, ["staff"], wf_staff_exit, True, ["issue_documents"]),
        ("wf_complete_admission", "ONE-SHOT admission: creates the student account (in the class) and the parent account linked to the child: ONE confirm card. Fees follow the class fee structure.",
         {"student_name": S("Child's full name"), "class_name": S('Class, e.g. "5 A"'), "parent_name": S("Parent / guardian name (default father, then mother)"), "parent_phone": S("Parent phone"),
          "father_name": S("Father"), "mother_name": S("Mother"), "father_phone": S("Father phone"), "mother_phone": S("Mother phone"), "dob": S("Date of birth YYYY-MM-DD"), "gender": S("Gender"),
          "address": S("Address"), "create_parent": _B("Also make the parent login (default true)"), "school": sc}, ["student_name", "class_name"], wf_complete_admission, True, ["create_user"]),
        ("wf_ptm_day", "ONE-SHOT parent-teacher meeting day: calendar event + pinned notice + push to the chosen classes (or whole school): ONE confirm card.",
         {"date": S("YYYY-MM-DD"), "time": S('e.g. "10:00 AM"'), "title": S("Default: Parent-Teacher Meeting"), "body": S("Optional custom text"), "class_names": _CLS(), "school": sc}, ["date"], wf_ptm_day, True, ["post_school_announcement", "post_announcement"]),
        ("wf_desk_summary", "ONE-SHOT 'what's pending on my desk': pending leave requests, fee dues, classes whose attendance is not marked today, open queries. Read-only; for 'good morning / my pending work'.",
         {"school": sc}, [], wf_desk_summary, False, ["leave_approve", "collect_fees", "view_student_fees", "view_attendance_reports", "view_queries", "mark_attendance"]),
        ("wf_student_360", "ONE-SHOT 'show everything about <student>': fees, attendance and marks in one answer. Read-only.",
         {"student": S("Student name"), "class_name": S("Class, only if ambiguous"), "school": sc}, ["student"], wf_student_360, False, ["view_student_fees", "collect_fees"]),
        ("wf_month_end_pack", "ONE-SHOT month-end summary: fees collected, who still owes, low attendance, pending leave. Read-only.",
         {"period": S("this_month or last_month (default)", enum=["this_month", "last_month"]), "school": sc}, [], wf_month_end_pack, False, ["view_student_fees", "collect_fees", "view_attendance_reports"]),
    ]


MODULE = "workflows"
WRITE_KINDS = ("workflow",)
KEYWORDS = (r"admission|withdraw|\bleaving\b|staff exit|resign|relieve|\bptm\b|parent.?teacher|\burgent\b|closure|closed tomorrow|"
            r"reminder|remind|desk|pending work|morning|everything about|all about|360|month.?end|absent.*(parent|message|inform)|"
            r"(parent|inform).*absent|\bbroadcast\b|defaulter")
HINDI = ["प्रवेश", "एडमिशन", "टीसी", "अवकाश घोषणा", "अभिभावक बैठक"]
RULE = ("24. WORKFLOWS (one-shot tools, named wf_*). When the request matches one, call it ONCE with what the user said and do NOT call find_* / "
        "search tools first: it finds the people, applies defaults (date = today, session = current) and shows ONE confirm card for the whole job. "
        "Ask only for what the tool says is missing, and ask everything missing in ONE message. If a workflow returns an error that lists candidates, "
        "call ask_choice with them and call the same workflow again. After a card, say in one sentence that it is ready to confirm. "
        "If a confirmed workflow reports it stopped part-way, tell the user exactly what was done and what was not. Read-only workflows (wf_desk_summary, "
        "wf_student_360, wf_month_end_pack) answer directly from their result; never invent numbers.")
BLURB = "WORKFLOWS (one-shot jobs: certificates, fee collection / reminders, announcements, attendance with parent follow-up, withdrawal, staff exit, admission, PTM day, desk summary, student 360, month-end)"


def register(agent):
    """Hook everything into the running agent. Safe to call once, at the end of agent.py."""
    global A
    A = agent
    import toolkit, prompt_rules
    if any(t[0] == "wf_issue_certificate" for t in A.TOOLS):
        return
    A.EXEC.update({"workflow": _run_workflow, "wf_admission": _run_admission, "wf_calendar": _run_calendar, "wf_transport_remove": _run_transport_remove})
    A.ALWAYS_CONFIRM.add("workflow")
    tools = _tools()
    A.TOOLS.extend(tools)
    A.HANDLERS.update({t[0]: t[4] for t in tools})
    A.READ_ONLY.update({t[0] for t in tools if not t[5]})
    # token-saving router: a message only loads this module when it sounds like one of these jobs (or via load_tools)
    toolkit.MODULES.append(MODULE)
    toolkit.TOOL_MODULE.update({t[0]: MODULE for t in tools})
    toolkit._LATIN[MODULE] = KEYWORDS
    toolkit._HINDI[MODULE] = HINDI
    toolkit._RX[MODULE] = re.compile(r"(?<![a-z])(?:" + KEYWORDS + ")", re.I)
    prompt_rules.RULES[24] = RULE
    prompt_rules.RULES_BY_MODULE[MODULE] = [24]
    prompt_rules.BLURB[MODULE] = BLURB
