"""Token-saving layer for the AI assistant (standard library only).

Why this exists
---------------
Before: every LLM call carried ALL ~112 tool definitions (as verbose JSON) plus the whole 21-rule prompt
-> about 20,000 tokens for "hi", and the whole thing was sent again at every step of a tool loop.

What this does (the same ideas as mcp-compressor / Agentgateway / RTK, but built in, because this app has
in-process tools and a text-only gateway, not MCP servers):

1. MODULES + ROUTER      Tools and prompt rules are grouped into modules (fees, attendance, ...). A message
                         only loads the modules it is about (keywords in English / Hindi / Hinglish).
2. PROGRESSIVE DISCLOSURE  A `load_tools` meta-tool lets the model pull in any module the router missed, and
                         calling a tool of an unloaded module still works (it is loaded for the next step).
                         Modules stay loaded for a few follow-up turns, so "yes" / "cash" / "the second one" work.
3. COMPACT SCHEMAS       Tools are shown as short signatures instead of JSON-schema, repeated parameters once.
4. HISTORY COMPACTION    Old tool results (already acted on) are shortened, and the replayed history is windowed.

Nothing here changes what a tool does, who may use it, or the confirm-card flow.
"""
import json
import os
import re

# ------------------------------------------------------------------ modules
CORE = "core"
MODULES = ["users", "fees", "visitors", "leave_payroll", "attendance", "documents", "homework", "communication", "academics"]

_M = {
    "users": "search_users list_users get_user_details list_classes list_schools list_features create_user edit_user set_user_active "
             "reset_password change_role delete_user link_children create_class change_features",
    "fees": "find_fee_student student_fees pending_fees fee_collection fee_structure my_fees record_fee_payment cancel_fee_payment adjust_fee "
            "void_fee_adjustment add_fee_item update_fee_item delete_fee_item copy_fee_structure get_receipt get_fee_statement get_fee_report",
    "visitors": "visitors add_visitor delete_visitor",
    "leave_payroll": "find_employee leave_settings leave_requests leave_balances my_leave payslips payroll_adjustments apply_leave cancel_leave "
                     "decide_leave grant_leave add_payroll_adjustment remove_payroll_adjustment generate_payroll finalize_payroll pay_payroll "
                     "reopen_payslip update_pay_settings add_leave_type update_leave_type",
    "attendance": "attendance_overview class_attendance find_attendance_student student_attendance class_attendance_report low_attendance "
                  "class_teachers class_rolls my_attendance mark_attendance set_class_teachers auto_assign_rolls set_roll_number",
    "documents": "document_types find_document_person issued_documents my_documents get_document_file issue_document cancel_document "
                 "update_document_settings update_document_template reset_document_template",
    "homework": "homework_classes homework_list homework_submissions create_homework check_homework delete_homework",
    "communication": "notice_board post_notice edit_notice delete_notice find_contact my_conversations read_messages my_notifications "
                     "send_message send_notification",
    "academics": "academics_overview find_academic_student student_academics class_academics academic_assessments assessment_marks my_academics "
                 "add_subject update_subject delete_subject create_exam update_exam delete_exam create_assessment update_assessment "
                 "delete_assessment enter_marks",
}
TOOL_MODULE = {n: m for m, names in _M.items() for n in names.split()}


def module_of(tool_name):
    """A tool nobody mapped is treated as core (always loaded), so a new tool can never silently disappear."""
    return TOOL_MODULE.get(tool_name, CORE)


# Words that say "this message is about module X". Generous on purpose: a false hit only costs a few tokens,
# a miss costs one extra step (the model can call load_tools, or just call the tool).
_LATIN = {
    "users": r"account|login|log in|username|user id|password|pass word|passcode|\brole\b|permission|\bfeatures?\b|\baccess\b|deactivat|\bactivat|"
             r"turn (on|off)|(delete|remove|disable|enable) (the |this |that )?(user|account|id|student|teacher|parent|staff|admin)|admission|"
             r"(new|add|create|make|register) (a |an |new )?(student|teacher|parent|staff|user|admin|class|section)|\blink\b|unlink|child|children|"
             r"how many|kitne|who is|who are|kaun|list of|(find|search|look up|dhundh|khoj)\w* (a |the |for )?(user|teacher|student|parent|staff|person|people)|"
             r"\bsearch\b|profile|phone|email|designation|promote|classes\b",
    "fees": r"fee|payment|paid|unpaid|\bpay\b|pend|\bdues?\b|receipt|rasid|raseed|\bcash\b|\bupi\b|cheque|discount|concession|waive|installment|"
            r"instalment|balance|collect|statement|rupee|\brs\b|baaki|bakaya|jama|tuition|outstanding|defaulter|refund|term [0-9ivx]+|amount",
    "visitors": r"visitor|\bvisit|guest|\bgate\b|aaya|aaye|mulakat|milne",
    "leave_payroll": r"leave|chutti|chhutti|salary|salaries|payroll|payslip|pay slip|bonus|deduction|wage|vetan|sick|casual|advance|increment|\blop\b|encash",
    "attendance": r"attend|present|absent|absence|\blate\b|\broll|haziri|hajri|hazri|class teacher|bunk|punctual",
    "documents": r"certificat|\btc\b|transfer|bonafide|bona fide|character|conduct|\bnoc\b|report card|marksheet|mark sheet|document|letterhead|"
                 r"letter\b|experience|\bseal\b|signature|template|issued|register|principal",
    "homework": r"homework|home work|assignment|\bhw\b|submission|submitted|study material|worksheet|classwork",
    "communication": r"notice|announce|circular|message|\bmsg|notif|\bpush\b|inbox|\bchat|sandesh|inform|tell (all|everyone|parents|class)|broadcast|alert",
    "academics": r"\bmarks\b|exam|\btests?\b|subject|result|grade|\brank|percent|score|assessment|unit test|half.?yearly|annual|topper|syllabus|"
                 r"\bpass\b|\bfail|\but[ -]?[0-9]",
}
# Devanagari has combining marks that break \b, so these are plain substring matches
_HINDI = {
    "users": ["पासवर्ड", "खाता", "कौन", "कितने", "परमिशन", "अनुमति", "प्रोफाइल"],
    "fees": ["₹", "फीस", "फ़ीस", "शुल्क", "रसीद", "बकाया", "जमा", "भुगतान"],
    "visitors": ["आगंतुक", "मिलने", "विज़िटर", "विजिटर", "मुलाकात"],
    "leave_payroll": ["छुट्टी", "सैलरी", "वेतन", "बोनस"],
    "attendance": ["हाज़िरी", "हाजिरी", "उपस्थित", "अनुपस्थित", "गैरहाज"],
    "documents": ["प्रमाण", "दस्तावेज", "रिपोर्ट कार्ड", "सर्टिफिकेट"],
    "homework": ["होमवर्क", "गृहकार्य", "गृह कार्य"],
    "communication": ["सूचना", "संदेश", "नोटिस", "घोषणा"],
    "academics": ["अंक", "परीक्षा", "रिज़ल्ट", "रिजल्ट", "नंबर", "विषय", "टेस्ट"],
}
_RX = {m: re.compile(r"(?<![a-z])(?:" + p + ")", re.I) for m, p in _LATIN.items()}

STICKY_TURNS = 3      # a module stays loaded this many turns after it was last relevant (follow-ups like "yes", "cash", "the 2nd one")
SMALL_TOOLSET = 14    # people with this few tools (parents, students) just get everything: nothing to save


def matches(text):
    t = text or ""
    return [m for m in MODULES if _RX[m].search(t) or any(h in t for h in _HINDI[m])]


def available_modules(allowed):
    """Modules in which the person has at least one permitted tool."""
    return [m for m in MODULES if any(module_of(n) == m for n in allowed)]


def select(text, state, allowed, has_files=False):
    """Pick the modules to load for this message. `state` is a dict kept per conversation (mutated)."""
    avail = available_modules(allowed)
    state["turn"] = turn = state.get("turn", 0) + 1
    seen = state.setdefault("seen", {})                       # module -> last turn it was relevant
    if len(allowed) <= SMALL_TOOLSET or os.environ.get("AI_TOKEN_SAVER", "").lower() in ("off", "0", "false", "no"):
        return set(avail)                                       # AI_TOKEN_SAVER=off in the environment = describe every tool again, as before
    hit = [m for m in matches(text) if m in avail]
    if has_files and "homework" in avail:
        hit.append("homework")
    for m in hit:
        seen[m] = turn
    chosen = {m for m in avail if turn - seen.get(m, -99) <= STICKY_TURNS}
    if not chosen and "users" in avail:                         # nothing recognisable: people-lookup is the best default, load_tools covers the rest
        chosen = {"users"}
        seen["users"] = turn
    return chosen


def touch(state, modules):
    """Mark modules as used this turn (a tool of that module was called, or the model asked for it)."""
    seen, turn = state.setdefault("seen", {}), state.get("turn", 0)
    for m in modules:
        if m in MODULES:
            seen[m] = turn


# ------------------------------------------------------------------ compact tool rendering
_T = {"string": "str", "number": "num", "integer": "int", "boolean": "bool"}


def _ty(p):
    if not isinstance(p, dict):
        return "any"
    if "enum" in p:
        return "|".join(str(x) for x in p["enum"])
    t = p.get("type", "string")
    if t == "array":
        it = p.get("items") or {}
        return "list[" + (_ty(it) if it.get("type") != "object" else json.dumps(_obj(it), separators=(",", ":"), ensure_ascii=False)) + "]"
    if t == "object":
        return json.dumps(_obj(p), separators=(",", ":"), ensure_ascii=False) if p.get("properties") else "obj"
    return _T.get(t, str(t))


def _obj(p):
    req = set(p.get("required") or [])
    return {k + ("*" if k in req else ""): _ty(v) + ((": " + v["description"]) if isinstance(v, dict) and v.get("description") else "")
            for k, v in (p.get("properties") or {}).items()}


def render_tools(schemas):
    """Compact text form of the tool list. Same information as the JSON schemas (names, descriptions, parameter
    names / types / enum values / required / descriptions), without the JSON punctuation; a long parameter
    description that already appeared for another tool is not repeated."""
    seen, out = {}, []
    for s in schemas:
        pr, req = (s.get("parameters") or {}).get("properties") or {}, set((s.get("parameters") or {}).get("required") or [])
        out.append(f"## {s['name']}: {s.get('description', '')}")
        for k, v in pr.items():
            d = (v.get("description") or "") if isinstance(v, dict) else ""
            sig = (k + ("*" if k in req else ""), _ty(v), d)
            if len(d) > 40 and sig[1:] in seen:
                out.append(f"  {sig[0]} {sig[1]} (as in {seen[sig[1:]]})")
                continue
            if len(d) > 40:
                seen[sig[1:]] = s["name"]
            out.append(f"  {sig[0]} {sig[1]}" + (f": {d}" if d else ""))
    return "\n".join(out)


# ------------------------------------------------------------------ history compaction
OLD_RESULT_CHARS = 600      # tool results from earlier turns (the answer was already given)
NEW_RESULT_CHARS = 6000     # tool results of the current turn (the model is working with them right now)
WINDOW = 30                 # messages replayed to the model (older ones are dropped, from a user message on)


def _cut(s, n):
    s = s if isinstance(s, str) else json.dumps(s, default=str, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + f" ...[{len(s) - n} more chars trimmed]"


def compact_history(msgs, window=WINDOW, old=OLD_RESULT_CHARS, new=NEW_RESULT_CHARS):
    """Copy of the stored conversation, ready to send. The stored conversation itself is not touched."""
    msgs = msgs[-window:]
    while msgs and msgs[0].get("role") != "user":
        msgs = msgs[1:]
    last_user = max((i for i, m in enumerate(msgs) if m.get("role") == "user"), default=0)
    out = []
    for i, m in enumerate(msgs):
        if m.get("role") == "tool":
            lim = new if i > last_user else old
            m = {**m, "results": [{**r, "content": _cut(r.get("content"), lim)} for r in m.get("results", [])]}
        out.append(m)
    return out


# ------------------------------------------------------------------ measuring
STATS = {"calls": 0, "tokens": 0, "last": 0, "max": 0}


def est_tokens(s):
    """~4 characters per token for English / JSON; Devanagari costs more, so this is a floor, fine for before/after comparisons."""
    return max(1, len(s if isinstance(s, str) else json.dumps(s, default=str)) // 4)


TIMES = {"calls": 0, "total": 0.0, "last": 0.0, "max": 0.0}


def timing(seconds):
    """How long one model call took (wall clock). Shown in /api/health and, with AI_DEBUG_TOKENS, in the log."""
    TIMES["calls"] += 1
    TIMES["total"] += seconds
    TIMES["last"] = round(seconds, 2)
    TIMES["max"] = round(max(TIMES["max"], seconds), 2)
    if os.environ.get("AI_DEBUG_TOKENS"):
        print(f"[ai] model call {seconds:.2f}s (avg {TIMES['total'] / TIMES['calls']:.2f}s)", flush=True)


def record(prompt_text):
    n = est_tokens(prompt_text)
    STATS["calls"] += 1
    STATS["tokens"] += n
    STATS["last"] = n
    STATS["max"] = max(STATS["max"], n)
    if os.environ.get("AI_DEBUG_TOKENS"):
        print(f"[ai] prompt ~{n} tokens (avg {STATS['tokens'] // STATS['calls']}, max {STATS['max']})", flush=True)
    return n
