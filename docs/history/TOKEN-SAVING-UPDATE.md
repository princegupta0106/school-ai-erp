# AI token-saving + speed update (v30)

**Problem:** every AI call sent ~20,000 tokens for an admin, even for "hi" (112 tool definitions as verbose JSON + the whole 21-rule prompt),
and again at every step of a tool loop.

**Now:** only what the message needs is sent. Typical admin message: **~2,200 - 4,200 tokens (-79% to -89%)**. Teacher: ~750 - 1,500 (-77% to -89%).

| Message (admin) | Before | After | Loaded |
|---|---|---|---|
| hi | 19,990 | 2,209 | users |
| Rahul ki fees kitni baaki hai? | 19,990 | 3,271 | fees |
| Mark attendance 6A: Priya absent | 19,990 | 2,404 | attendance |
| Issue a Transfer Certificate... | 19,990 | 3,137 | documents |
| Run payroll for last month | 19,990 | 2,772 | leave_payroll |

(estimates at ~4 characters per token; Hindi text costs more per character, so real numbers differ a little, the ratio holds.)

## How it works (ai-server/)
* `toolkit.py` (new): tools and rules are grouped in 9 modules. A keyword router (English / Hindi / Hinglish) loads only the modules a message is about.
* `prompt_rules.py` (new): the original prompt rules, word for word, split per module. Rule 4 now names only the loaded write tools.
* `agent.py`: uses the above; `load_tools` meta-tool; compact tool text for the Velona path; old tool results trimmed; history window of 30 messages.

## Why quality stays the same
* A module stays loaded for 3 turns after it was last relevant, so "yes", "cash", "the second one" keep working.
* If the router misses, the model can call `load_tools`, and calling a tool of an unloaded module still runs (it is loaded from the next step).
* Permissions are untouched: modules only decide what is *described*, never what is *allowed*. `allowed_tools()` is unchanged.
* Compact tool text keeps every name, type, allowed value, required flag and description (tested).
* The 139 original AI tests pass unchanged, plus 31 new ones (`test_ai_toolkit.py`).
* Parents / students (few tools) get everything as before: nothing to save.

## Measure it yourself
* Set `AI_DEBUG_TOKENS=1` on the AI service: each call prints `[ai] prompt ~N tokens`.
* Or open `<ai-service-url>/api/health`: shows `usage: {calls, avg, max, last}`.

## Switch off / tune
* `AI_TOKEN_SAVER=off` (env of the AI service): back to describing every tool (compact format and history trimming stay).
* Router keywords: `toolkit.py` -> `_LATIN` / `_HINDI`. A new tool: add its name to the module in `toolkit._M` (an unmapped tool is treated as always-loaded, so it can never vanish).
* `STICKY_TURNS`, `OLD_RESULT_CHARS`, `WINDOW` at the top of the history section in `toolkit.py`.

Run the tests: `cd ai-server && python -m unittest discover -p "test_ai*.py"`

---
## Speed update (v30)
Goal: fast answers without limiting answer length.

* **Model:** `VELONA_MODEL=anthropic/claude-haiku-5.5` (in `.env`; also the built-in default now).
* **Thinking level = low.** Before, `GEMINI_THINKING` was read but never actually sent to the gateway, so it did nothing.
  Now it is sent with every call (`GEMINI_THINKING=off|minimal|low|medium|high`, default `low`). If the gateway rejects the field,
  the service logs one line, retries that call without it and stops sending it, so a request never fails because of it.
* **No output limit:** the Anthropic path had `max_tokens: 700`; it now allows 16,000 (`AI_MAX_TOKENS` to change). The Velona path never had one.
* **Less waiting before the first model call:** the whole people list is only prefetched when the message is about people (before: on every message, even "hi").
* **Smaller prompts are faster too** (previous update): fewer input tokens = quicker first token.
* **See where the time goes:** `AI_DEBUG_TOKENS=1` logs `[ai] model call 1.8s`; `/api/health` shows `latency: {avg, last, max, calls}`.

Tests: 176 pass (139 original + 37 new). Run: `cd ai-server && python -m unittest discover -p "test_ai*.py"`
