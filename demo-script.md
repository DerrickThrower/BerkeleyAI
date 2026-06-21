# VibeDocs AI — 90-second demo script

**Setup:** two laptops, two presenters (P1 = Maria's machine, P2 = Sam's machine), both
windows already open and joined to `room=demo` on `api.py`. Phoenix tab open in the
background. Mock mode on if wifi is shaky.

- P1 window: http://localhost:5173/?name=Maria&model=claude&room=demo
- P2 window: http://localhost:5173/?name=Sam&model=gpt&room=demo

Seeded demo prompts to type (don't improvise these):
- **Case 2** — Maria: `add input validation to create_user in api.py`
- **Case 2** — Sam: `add structured logging to delete_user in api.py`
- **Case 3** — Maria: `make get_user in api.py return JSON`
- **Case 3** — Sam: `make get_user in api.py return XML`

---

### [0:00] Hook — two people, one live codebase

**P1 (spoken):** "This is VibeDocs AI — Google Docs, but for vibecoding. Two of us are in
the *same* codebase right now."

**P2 (spoken):** "I'm Sam. That's Maria. Watch the top of the screen — that's the live
presence strip. You can already see both of us in here, on the same file, in real time."

> *Recovery — if presence doesn't show:* "Presence rides on Redis Pub/Sub —
> let me refresh my tab." (Reload P2; reconnect repopulates the strip in ~1s.)

### [0:15] Case 2 — two prompts, one coherent merge

**P1:** "We're both going to prompt the same file at the same time. I'll add input
validation to `create_user`." *(type the Case-2 Maria prompt, hit send)*

**P2:** "And I'll add structured logging to `delete_user` — different function, same
file." *(type the Case-2 Sam prompt, send immediately)*

**P1:** "Two prompts landed inside the arbitration window. Claude classified them as a
*compatible overlap* and merged both diffs into one patch — watch the merge animation."

> *Recovery — if the merge stalls:* "That round-trips two live models — give it a beat."
> If it truly hangs: "We're in mock mode for reliability; same path, deterministic diff."
> (Mock mode needs no network and produces the same merged patch.)

### [0:40] Case 3 — genuine conflict, nobody gets dropped

**P1:** "Now the hard case. I want `get_user` to return JSON." *(type Case-3 Maria, send)*

**P2:** "And I want it to return XML — same function, contradictory goals." *(type Case-3
Sam, send)*

**P1:** "This is the moment most tools silently overwrite someone. We don't. The system
detected a genuine conflict and *surfaced* it — both asks shown side by side. No one's
intent gets dropped; a human decides."

> *Recovery — if conflict UI doesn't pop:* "Conflicts are arbitrated server-side —
> check the ledger." (Point to the Redis Streams ledger / Phoenix trace showing
> `classified: case3` so the judge still sees the decision was made.)

### [1:00] Provider-agnostic — flip Claude → GPT through the same path

**P2:** "One more thing. Sam's been running GPT this whole time; Maria's on Claude — same
room, same file." **P1:** *(flip Maria's model toggle from Claude to GPT)* "I'll flip to
GPT mid-session. Same `execute_prompt()` interface, same arbitration — the provider is
just an adapter behind one path."

> *Recovery — if the toggle misfires:* "It's a query param too —" (reload P1 with
> `&model=gpt`; rejoin is instant.)

### [1:15] Phoenix — see the whole lifecycle in one trace

**P1:** "And every prompt is fully traced." *(switch to Phoenix tab, open the latest
trace)* "Here's one prompt's lifecycle as a span tree — received, queued, classified,
executed per model, arbitrated, applied — plus an eval checking the final diff preserved
*both* users' intent."

> *Recovery — if Phoenix is empty/slow:* "Traces export async — here's a trace from our
> pre-recorded run." (Show the backup capture; don't wait on the live exporter.)

### [1:30] Close

**P2:** "Real-time multi-user prompting, Claude-arbitrated merges, conflicts surfaced not
dropped, any model, fully traced. That's VibeDocs AI."

---

**Global fallback:** if the live run breaks anywhere, cut to the pre-recorded two-window
screen capture and keep narrating from the current beat. Mock mode (no keys, no network)
is the safest configuration for the live demo.
