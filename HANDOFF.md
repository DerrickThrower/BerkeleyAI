# VibeDocs AI — Master Handoff & Architecture

> Single source of truth for picking this project up — by a teammate, by Devin, or by any
> agent. Read this top-to-bottom before changing anything. Last updated: 2026-06-20.

---

## 1. What this is

**VibeDocs AI** started as "Google Docs for vibecoding" (multiple people prompting one shared
codebase, with live arbitration of conflicting intent) and has since grown a second, now-primary
surface: a **real IDE-style workspace** where you open an actual codebase on disk, edit it, run its
localhost in a live preview, see visual git diffs, run tests, drive a **Cursor-style multi-file AI
agent**, and **ship changes to a git branch** (branch + commit + push).

There are therefore **two coexisting surfaces** sharing one server + one web app:

| Surface | Route | What it is |
|---|---|---|
| **Workspace** (primary) | `/?session=<id>` | Real codebase on disk: tree + editor, AI agent, Preview/Diff/Tests, git Ship |
| **Dashboard** | `/` (no query) | Google-Docs-style list of sessions ("documents"); create/open/delete |
| **Collaborative demo** | `/?room=<id>&name=<n>` | Original multi-user simultaneous-prompt + arbitration demo (kept, secondary) |

---

## 2. Current state (what's built & working)

**Backend (Node + TypeScript, `server/`)** — all validated via API/CLI/WS (see §9):
- Sessions registry (Redis-backed): create / list / get / delete / touch.
- Workspace filesystem: file tree, safe read/write (path-escape guarded), scoped to a session root.
- Visual git diff: `git status` + per-file unified patch with add/del counts.
- Git ops: branch, checkout, commit-all, push, and one-shot **ship** (branch + commit + push).
- Process runner: run arbitrary commands / tests with streamed stdout/stderr + exit code.
- Dev-server manager: start/stop a `npm run dev`-style process, **auto-detect its localhost URL** from stdout, report status (used by the Preview iframe).
- **Cursor-style agent**: a Claude tool-use loop (`list_files`/`read_file`/`edit_file`/`write_file`/`finish`) that edits **multiple files** across the real codebase from one prompt, streaming each step; cancellable.
- Single-file AI edit endpoint (quick action).
- Original arbitration engine (rooms): classify → case 1/2/3 → Claude-orchestrated merge / surfaced conflict; Redis presence (Pub/Sub) + append-only ledger (Streams); Phoenix/OTLP tracing + intent-preservation eval.

**Frontend (Vite + React + TS, `web/`)** — passes `tsc --noEmit` + `vite build`:
- Dashboard (session cards, new-session modal, delete).
- Workspace: file tree, CodeMirror editor (language-by-extension), debounced save-to-disk, right-pane tabs **Agent | Preview | Diff | Tests**, Ship panel, single-file AI-edit bar.
- AgentPanel: composer + live streaming activity log (read/edit/write steps), done-card with changed-file chips + "View diff".
- Original collaborative UI (presence strip, invite links, merge-convergence animation, conflict panel) untouched.

**Infra**: `docker-compose.yml` runs Redis (host **:6380**) + Arize Phoenix (**:6006**). Server **:8787**, web **:5173**.

---

## 3. Architecture

```
  Browser (web :5173)
  ┌─────────────────────────────────────────────┐
  │ Root.tsx  ──route──►  Dashboard | Workspace | App(demo) │
  │   Workspace: tree+editor · Agent · Preview · Diff · Tests · Ship │
  └───────────────┬───────────────────────┬─────────────────┘
        REST (fetch)│            WebSocket  │ (presence, run/dev/agent streams)
                    ▼                       ▼
  Server (Node + TS :8787)  ── ws + express ──
  ┌──────────────────────────────────────────────────────────────┐
  │ sessions.ts   session registry (Redis)                         │
  │ workspace.ts  fs tree / read / write (path-safe, on disk)      │
  │ git.ts        diff + branch/commit/push/ship  ──► `git` CLI     │
  │ runner.ts     run cmds + DevServer (sniffs localhost URL)       │
  │ agent.ts      Claude tool-use loop (multi-file edits on disk)   │
  │ arbiter.ts    case 1/2/3 arbitration  (collaborative demo)      │
  │ adapters/     execute_prompt: claude | gpt | mock (one iface)   │
  │ tracing.ts    OTLP spans + intent eval  ──► Phoenix             │
  └───────┬───────────────────────┬──────────────────┬────────────┘
          ▼                       ▼                  ▼
     Redis (:6380)          disk (session.root)   Phoenix (:6006)
   presence / streams /     REAL codebase files   prompt-lifecycle traces
   locks / sessions
          ▲
   Anthropic API (Claude) — agent loop, arbitration merge, single-file edits
   OpenAI API (GPT) — provider-agnostic adapter (see §8 caveat)
```

**Two data-flow paths:**
1. **Workspace/agent** (primary): files live **on disk** at `session.root`. Editor + agent read/write disk via `workspace.ts`. Changes show in the Diff pane and are shipped via `git.ts`.
2. **Collaborative arbitration** (demo): files live in a **Redis hash** per room; prompts are arbitrated and merged. This path does NOT touch disk. (Unifying the two is a known next step — §10.)

---

## 4. Tech stack & sponsor mapping

- **Anthropic (Claude, `@anthropic-ai/sdk`)** — the orchestration backbone: the multi-file agent loop, the arbitration merge step, classification, and single-file edits all run through Claude. Model id `claude-opus-4-8`.
- **Redis (`ioredis`, via Docker :6380)** — Pub/Sub for live presence fan-out, Streams for the append-only prompt/resolution ledger, Hash for session registry + collaborative file state + per-file locks.
- **Arize Phoenix (OTLP, Docker :6006)** — traces each arbitration round (round → classify → execute-per-model → merge → eval) and runs an intent-preservation eval. Project name `vibedocs-ai`.
- **OpenAI (GPT, `openai`)** — provider-agnostic adapter so a prompt can run on Claude *or* GPT through one interface.

> **Stack note:** built in **TypeScript/Node**, not Python — the host has Python 3.9 and the Claude
> Agent SDK needs 3.10+. Claude orchestration is done via the Anthropic TS SDK.

---

## 5. Repository layout

```
vibedocs-ai/
├─ docker-compose.yml        redis (:6380) + phoenix (:6006)
├─ start-demo.sh             one-command bring-up
├─ README.md                 product/demo readme
├─ demo-script.md            90s collaborative-demo script (legacy surface)
├─ BUILD_LOG.md              decision log
├─ HANDOFF.md                ← this file
├─ server/
│  ├─ .env                   SECRETS (gitignored) — API keys live here
│  ├─ .env.example           template
│  └─ src/
│     ├─ server.ts           ws + express; REST routes + WS message router
│     ├─ config.ts           env + Redis key helpers
│     ├─ redis.ts            Redis client + presence/streams/locks/files helpers
│     ├─ types.ts            ★ shared contracts (WS msgs, Session, DiffFile, AgentEvent…)
│     ├─ sessions.ts         session registry (the dashboard "documents")
│     ├─ workspace.ts        disk fs: tree + safe read/write
│     ├─ git.ts              diff + branch/commit/push/ship
│     ├─ runner.ts           one-shot run() + DevServer (localhost URL sniffing)
│     ├─ agent.ts            ★ Cursor-style multi-file Claude tool-use loop
│     ├─ adapters/           execute(): claude.ts | openai.ts | mock.ts behind index.ts
│     ├─ arbiter.ts          ★ case 1/2/3 arbitration (collaborative demo)
│     ├─ classify.ts         prompt → {file, symbol}
│     ├─ merge.ts            Claude merge + deterministic 3-way fallback
│     ├─ intake.ts           prompt batching window → arbitrate
│     ├─ tracing.ts          OTLP/Phoenix spans + intent eval
│     ├─ seed.ts             demo room seed files (collab demo only)
│     ├─ pyutil.ts           tiny python-symbol locator (mock adapter/classifier)
│     └─ smoketest.ts        end-to-end arbitration test (npm run smoke)
└─ web/
   └─ src/
      ├─ main.tsx            renders <Root/>
      ├─ Root.tsx            ★ URL router (session / room / dashboard)
      ├─ Dashboard.tsx       session list + new-session modal
      ├─ Workspace.tsx       ★ workspace shell + WS wiring
      ├─ App.tsx             original collaborative demo (untouched)
      ├─ api.ts              typed REST client (VITE_API_URL)
      ├─ ws.ts               reconnecting useWs hook
      ├─ types.ts            ServerMsg/ClientMsg unions (mirror server/src/types.ts)
      ├─ workspace-types.ts  Session/FileNode/DiffFile/DevStatus/RunEvent/GitInfo/AgentEvent
      ├─ styles.css          all styles (dark tokens)
      └─ components/         AgentPanel, FileTree, WorkspaceEditor, DiffViewer,
                             PreviewPane, Terminal, ShipPanel, NewSessionModal,
                             + legacy demo components (PresenceStrip, MergeOverlay, …)
```
★ = the load-bearing files.

---

## 6. How to run

```bash
# 0. infra
docker compose up -d                  # redis :6380, phoenix :6006

# 1. server
cd server && npm install
#   put API keys in server/.env (see §7); no keys = mock mode
npm run dev                           # :8787  (tsx watch, no build step)

# 2. web
cd ../web && npm install
npm run dev                           # :5173

# open http://localhost:5173/  → dashboard → New session → point at any folder
```
Validate the collaborative arbitration engine: `cd server && npm run smoke` (12 checks).
One-shot: `./start-demo.sh`.

---

## 7. Environment & secrets

`server/.env` (gitignored — **never commit**):
```
ANTHROPIC_API_KEY=sk-ant-...     # enables Claude (agent, merge, edits). Present in dev.
OPENAI_API_KEY=sk-...            # GPT adapter. See §8 caveat.
REDIS_URL=redis://localhost:6380 # 6380, not 6379 (another project's redis holds 6379)
PORT=8787
CLAUDE_MODEL=claude-opus-4-8
OPENAI_MODEL=gpt-4o
PHOENIX_OTLP_ENDPOINT=http://localhost:6006/v1/traces
TRACING_ENABLED=true
ARB_WINDOW_MS=1400               # simultaneity window for collaborative arbitration
```
No keys ⇒ the system falls back to a deterministic **mock adapter** so everything still runs.

---

## 8. API reference

### REST (base `http://localhost:8787`)
| Method | Path | Body → Result |
|---|---|---|
| GET | `/health` | `{ok, rooms}` |
| GET | `/api/sessions` | `Session[]` |
| POST | `/api/sessions` | `{name, root, devCmd?, testCmd?}` → `Session` (400 `{error}` if root not a dir) |
| GET | `/api/sessions/:id` | `Session` |
| DELETE | `/api/sessions/:id` | `{ok}` |
| GET | `/api/sessions/:id/tree` | `FileNode` (nested) |
| GET | `/api/sessions/:id/file?path=` | `{path, content}` |
| POST | `/api/sessions/:id/file` | `{path, content}` → `{ok}` |
| GET | `/api/sessions/:id/diff` | `{files: DiffFile[]}` |
| POST | `/api/sessions/:id/ai-edit` | `{path, prompt, model}` → `{ok, before, after, summary, model}` |
| GET | `/api/sessions/:id/git` | `GitInfo` |
| POST | `/api/sessions/:id/git/branch` | `{name, from?}` → `{ok, output}` |
| POST | `/api/sessions/:id/git/checkout` | `{name}` → `{ok, output}` |
| POST | `/api/sessions/:id/git/commit` | `{message}` → `{ok, output}` |
| POST | `/api/sessions/:id/git/push` | `{branch?, remote?, setUpstream?}` → `{ok, output}` |
| POST | `/api/sessions/:id/git/ship` | `{branch, newBranch?, message, push?}` → `{steps[], ok}` |
| GET | `/api/sessions/:id/dev` | `DevStatus` |

### WebSocket (`ws://localhost:8787/ws`)
**Client → server** (`ClientMsg`): `join` · `presence` · `set_model` · `submit_prompt` · `resolve_conflict` · `run` · `run_cancel` · `dev_start` · `dev_stop` · **`agent`** `{prompt, model?}` · **`agent_cancel`**

**Server → client** (`ServerMsg` + workspace msgs): `room_state` · `presence` · `prompt_queued` · `arbitrating` · `resolution` · `file_update` · `run_event` · `dev_status` · **`agent_event`** · `error`

`AgentEvent.phase`: `start | message | tool_use | tool_result | error | done`. Authoritative
`filesChanged[]` + `summary` arrive on `done`. `RunEvent.runId === "dev"` ⇒ dev-server log.

All contracts live in **`server/src/types.ts`** (mirrored in `web/src/types.ts` + `web/src/workspace-types.ts`). Change there first.

---

## 9. What's validated vs not

**Validated (by the builder, via API/CLI/WS):**
- Sessions CRUD; file tree/read/write; visual diff (with patch).
- Git ship: created + committed to a `vibedocs/*` branch on a throwaway repo.
- Run streaming; dev-server start + **URL auto-detection serving real content** (`http://localhost:5151/`).
- **Multi-file agent**: from one prompt it read 2 files, edited **both**, finished with `filesChanged`.
- Collaborative arbitration: `npm run smoke` 12/12 (case-2 merge keeps both intents; case-3 surfaces conflict, drops nothing; ledger recorded; Phoenix shows live traces).
- Frontend `tsc --noEmit` + `vite build` pass; all modules serve.

**NOT yet validated (do this first when you pick it up):**
- **Browser click-through of the workspace UI** — the builder could not drive a real browser. Open a session and exercise: Agent panel streaming, Preview iframe, Diff rendering, Tests terminal, Ship modal. Fix any wiring gaps.
- Live **GPT** path end-to-end (see caveat).
- Agent behavior on a **large** repo (file list is capped at 600; no real search tool yet).

---

## 10. Known gaps & next steps (the Devin backlog)

Highest-leverage first:
1. **QA the workspace UI in a browser** and fix anything broken (see §9).
2. **OpenAI quota**: the provided key authenticates but returns `429 quota exceeded`; GPT calls fail-fast and fall back to mock. Add billing/credits or swap providers to make the multi-model path genuinely live. Adapter is provider-agnostic (`server/src/adapters/`).
3. **Agent self-verification**: give the agent a `run_command`/`run_tests` tool so it can run the build/tests and iterate before you ship. Loop already supports adding tools in `agent.ts`.
4. **Agent model picker** (Claude vs GPT) in the composer; currently the agent always uses Claude.
5. **Unify collaboration + workspace**: today arbitration edits Redis-hash files, the workspace edits disk. Make multi-user presence/arbitration operate on the real on-disk codebase (route `getFiles`/`setFile` through `workspace.ts` for session rooms; scope classifier/merge to relevant files rather than the whole repo).
6. **Search/large-repo support**: add a grep/ripgrep tool (and optionally embeddings) so the agent scales past the 600-file cap.
7. **Diff UX**: syntax-highlighted diffs, per-hunk staging, and a commit-from-diff flow.
8. **Tests pane**: parse pass/fail counts instead of raw output only.
9. **Preview robustness**: proxy/iframe handling for dev servers that don't print a parseable URL or block framing.
10. **Security before any non-localhost deploy**: sessions are open (anyone with the id joins), and the server runs arbitrary shell commands + dev servers + git push in the user's environment. Add auth, sandboxing, and a command allowlist before exposing beyond localhost.
11. **Persistence**: session metadata is in Redis without a volume — add a Redis volume (or a DB) so the dashboard survives `docker compose down`. (File edits are already durable on disk.)

---

## 11. Conventions

- TypeScript ESM throughout; **no build step** — `tsx watch` runs `src/server.ts` directly. Imports use `.js` extensions (ESM resolution) even for `.ts` files.
- Strict TS; `skipLibCheck` on. Keep `server/src/types.ts` the single source of truth and mirror to web.
- Redis keys are centralized in `config.ts` (`keys.*`). Path safety for all disk writes goes through `workspace.ts#safeResolve`.
- Errors never silently drop user intent (arbitration thesis) and never crash the request — adapters fall back to mock on provider failure.
- Frontend: dark token system in `styles.css`; CodeMirror for editing; `useWs` for the single shared socket.

---

## 12. Handing off to Devin

1. **Confirm no secrets are tracked**: `git status` should not list `server/.env` or `.env` (both gitignored). Verify with `git check-ignore server/.env`.
2. **Commit** (initial commit on `master`, or a feature branch).
3. **Create a GitHub remote and push** so Devin can access it:
   ```bash
   gh repo create vibedocs-ai --private --source=. --remote=origin --push
   ```
   (No remote is configured yet — Devin works from a hosted git repo.)
4. **Point Devin at this file (`HANDOFF.md`)** as its primary context, and at §10 for the backlog.
5. Give Devin its own API keys via its secret store — do **not** put keys in the repo.
6. First task suggestion for Devin: **§10 item 1 (browser QA of the workspace) + item 3 (agent self-verification)**.
