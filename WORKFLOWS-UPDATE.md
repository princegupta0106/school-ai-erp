# One-shot workflows for the AI assistant

Before: "withdraw Rahul" meant find student -> check dues -> issue TC -> turn account off, one model round-trip each.
Now: the model picks ONE `wf_*` tool and fills what the user said. The tool does the lookups, defaults, validation
and ordering itself and shows ONE confirm card.

## Files
- `ai-server/workflows.py`  (new) all workflows + registration
- `ai-server/agent.py`      (2 small edits) a capture hook at the top of `_register`, and 3 lines at the very end that call `workflows.register(...)`
- `ai-server/test_ai_workflows.py` (new, 14 tests); `test_ai_toolkit.py` rule count 23 -> 24

## Workflows (12)
| Tool | One sentence does | Risk |
|---|---|---|
| wf_issue_certificate | name + type -> find person, fill details, certificate card | confirm |
| wf_collect_fee | student name + amount + mode -> payment card (receipt on confirm) | confirm |
| wf_urgent_broadcast | pinned notice + push (+ calendar entry) | confirm |
| wf_absent_followup | mark class, absentees/late by name, message absent students' parents | confirm |
| wf_fee_reminder_campaign | defaulters -> a private reminder per parent, with amounts | confirm |
| wf_student_withdrawal | dues check -> Transfer Certificate -> off transport -> account off | confirm |
| wf_staff_exit | pending-leave warning -> Experience Certificate -> account off | confirm |
| wf_complete_admission | student account + linked parent account (fees follow class structure) | confirm |
| wf_ptm_day | calendar event + notice + push | confirm |
| wf_desk_summary | pending leave, fee dues, unmarked attendance, open queries | read-only |
| wf_student_360 | fees + attendance + marks of one student | read-only |
| wf_month_end_pack | collection, dues, low attendance, pending leave | read-only |

## How it works / safety
- Each step is prepared by the SAME `t_*` function as the single tools (same validation), collected instead of shown as its own card.
- On confirm the steps run in order through the SAME executors with the person's own token: the portal still checks every permission.
- All write workflows are in `ALWAYS_CONFIRM`: auto-confirm never skips them.
- Ambiguous names stop BEFORE the card with the candidates; the model asks once (`ask_choice`) and calls again.
- Partial failure: the run stops at the failing step and says what was done, what failed, what did not run. The portal API has no cross-call transaction,
  so there is NO automatic rollback; steps are ordered so the hardest-to-undo comes first and the account switch-off last.
- Routing: new module `workflows` in toolkit.py (keywords: withdraw, admission, reminder, desk, ptm, month-end ...); `load_tools` also reaches it.
  Rule 24 in the prompt tells the model to call the workflow once and not to search first.

## Known limits (be aware)
- Parents are messaged 1-to-1 only if they have a linked parent login; the rest are listed in the card footer ("No parent login").
- Reminders/follow-ups are capped at 40 parents per card.
- Idempotency: a confirm card is single-use (existing behaviour), so a double tap cannot run twice.
  Re-asking after a partial failure re-prepares the whole job: the portal will refuse duplicates it knows about (e.g. attendance "already marked").
- Tested offline with a faked portal. Run the first real confirm of each workflow on a test school (`TestSchoolCreationSeed.bat`).
- Not built yet (needs new backend routes): substitution arrangement, report-card batch with pre-check, year-end rollover, class promotion, payroll one-shot, section transfer, sibling linking.

## Run the tests
    cd ai-server && python -m unittest discover -p "test_*.py"
