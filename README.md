# VibeDocs AI

**Google Docs for vibecoding.** A real-time collaborative workspace where multiple people prompt the *same* shared codebase at the *same* time. Every prompt passes through a Claude-orchestrated arbitration layer that classifies intent, merges non-conflicting changes live, and — when two people genuinely collide — sequences or surfaces the conflict instead of silently dropping anyone's ask. You see who else is in the room, what they're touching, and how the system reconciled everyone's intent into one coherent diff.

---

## Architecture

```
   ┌──────────────┐                         ┌──────────────┐
   │  Browser A   │                         │  Browser B   │
   │  Maria       │                         │  Sam         │
   │  (CodeMirror)│                         │  (CodeMirror)│
   │  model=claude│                         │  model=gpt   │
   └──────┬───────┘                         └──────┬───────┘
          │            WebSocket (presence,         │
          │            prompts, diffs, conflicts)   │
          └─────────────────┬──────────────────────-┘
                            ▼
              ┌─────────────────────────────┐
              │   WebSocket Server (Node/TS) │
              │   :8787                       │
              │   - room/session mgmt         │
              │   - arbitration window batch  │
              └───┬───────────┬───────────┬───┘
                  │           │           │
        ┌─────────▼──┐  ┌─────▼──────┐  ┌─▼───────────────────┐
        │   Redis    │  │ Arbitration│  │  Model Adapters     │
        │            │  │   Agent    │  │  execute_prompt()   │
        │ Pub/Sub  ──┼─▶│  (Claude)  │  │  ┌────────┐┌──────┐ │
        │  presence  │  │ classify   │  │  │ Claude ││ GPT  │ │
        │ Streams  ──┼─▶│ case 1/2/3 │  │  └────────┘└──────┘ │
        │  ledger    │  │ merge diffs│  │  (+ mock fallback)  │
        │ Hash     ──┼─▶│            │  └─────────────────────┘
        │  files +   │  └─────┬──────┘
        │  locks     │        │
        └────────────┘        │ OTLP traces + eval
                              ▼
                    ┌───────────────────┐
                    │  Arize Phoenix    │
                    │  :6006  (traces)  │
                    │  prompt lifecycle │
                    │  + intent-preserve│
                    │    eval           │
                    └───────────────────┘
```

---

## How each sponsor tech is used (architecturally)

**Anthropic (Claude API via `@anthropic-ai/sdk`).** Claude is the *arbiter*, not a feature bolted on the side. Every incoming prompt — regardless of which model the user picked to *execute* it — first flows through a Claude-orchestrated classification step that decides whether two near-simultaneous prompts are non-overlapping, compatibly overlapping, or in genuine conflict (the three cases below). For compatible overlap, a second Claude call performs the merge step: it takes both models' candidate diffs and reconciles them into one coherent patch that preserves *both* intents. Claude is also available as one of the two execution providers. So Anthropic shows up in three architectural roles: intent classifier, diff merger, and execution model.

**Redis.** Redis is the mechanism that makes multi-user simultaneity possible at all — three distinct data structures, each doing real work. **Pub/Sub** broadcasts live presence (who's in the room, cursor/file focus) to every connected client so the presence strip updates instantly. **Streams** are an append-only, replayable ledger of every prompt and its resolution — `(user, model, prompt, classified case, final diff, applied-at)` — so the whole room history can be reconstructed or audited. **Hash** stores the canonical file contents plus per-file locks/claims, which is how the arbitration layer knows two prompts target the same file and how it stamps a short claim during execution to coordinate the window.

**Arize Phoenix (self-hosted OSS, OTLP traces).** Phoenix receives an OpenTelemetry trace for each prompt's *full lifecycle* as a span tree: `received → queued → classified (case 1/2/3) → executed per model → arbitrated/merged → applied`. Each stage is a child span with attributes (model, case, file, latency), so you can open one trace and see exactly how two colliding prompts were reconciled. On top of the trace, an **eval** runs that checks whether the final applied diff actually preserved *both* users' intent — turning "did the merge work?" into a measured signal instead of a vibe.

---

## Quickstart

**Prereqs:** Node 18+, Docker (for Redis + Phoenix). API keys are optional — see mock mode below.

```bash
# 1. Infra: Redis + Phoenix
docker compose up -d

# 2. Server (WebSocket + arbitration), on :8787
cd server
cp .env.example .env        # optional: add ANTHROPIC_API_KEY / OPENAI_API_KEY
npm install
npm run seed                # seeds the demo room + api.py into Redis
npm run dev

# 3. Web client, on :5173 (new terminal)
cd web
npm install
npm run dev
```

Open **two** browser windows side by side:

- http://localhost:5173/?name=Maria&model=claude&room=demo
- http://localhost:5173/?name=Sam&model=gpt&room=demo

Phoenix UI: http://localhost:6006

---

## The three arbitration cases

The arbitration agent batches prompts that land within `ARB_WINDOW_MS` (default 1400ms) on the same room, then classifies:

1. **Non-overlapping (different files).** The two prompts touch unrelated files. Both execute concurrently and their diffs merge cleanly — no coordination needed.

2. **Compatible overlap (same file, different functions).** Both prompts hit `api.py`, but one edits `create_user` and the other edits `delete_user`. Both execute, then a Claude **merge step** reconciles the two candidate diffs into a single coherent patch that contains both changes. This is the signature moment: two prompts in, one merged diff out.

3. **Genuine conflict (same function, contradictory goals).** Both prompts target `get_user` with incompatible asks (return JSON vs. return XML). The system **never silently drops** a prompt. It either **sequences** them — the second is re-contextualized against the first's result — or **surfaces the conflict visibly** to both users, showing both asks side by side so a human decides. Intent is always preserved or escalated, never discarded.

---

## Demo fallback

Wifi and live APIs are flaky at demo time. **Record a screen capture of a clean two-window run ahead of time** (presence strip, a case-2 merge, a case-3 conflict, a Phoenix trace) and have it ready to play. If the live demo stalls, switch to the recording without breaking stride. Mock mode (below) also de-risks the live run since it needs no network for the models.

---

## Honest notes

- **TypeScript, not Python.** The original plan was the Claude Agent SDK (Python), but the host machine only has Python 3.9 and the Agent SDK requires 3.10+. Rather than fight the environment at a hackathon, the entire stack was built in **TypeScript/Node** and the Claude orchestration is done directly through the **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`). Same architecture, same arbitration logic — different language binding.
- **Mock mode.** If `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are unset, the system falls back to a **deterministic mock adapter** behind the same `execute_prompt()` interface. The full pipeline — presence, classification, merge, conflict surfacing, Redis ledger, Phoenix traces — runs end-to-end with **no keys and no network**. Set the keys to swap in the real models with zero code changes.
