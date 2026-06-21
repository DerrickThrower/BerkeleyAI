# BUILD_LOG — VibeDocs AI

Timestamped, one line per major decision. Process evidence + demo-script source.

- **Stack pivot to TypeScript/Node.** Host Python is 3.9; Claude Agent SDK needs 3.10+. Built the whole stack in TS — unifies front/back and keeps Claude orchestration via the Anthropic TS SDK. Anthropic track intact.
- **Redis = the load-bearing layer.** Pub/Sub for presence fan-out, Streams for the append-only prompt+resolution ledger, Hash for file contents / locks / roster. On host 6380 (6379 was taken by another project's redis).
- **Contracts first.** `server/src/types.ts` is the single source of truth (WS envelopes, Resolution shape, ArbCase). Frontend copies it verbatim. Everything built around it.
- **Parallelized the build.** Frontend (React+CodeMirror) and docs/infra were built by background agents while the arbitration core was built by hand — arbitration is the thesis, so it was not delegated.
- **Arbitration is real, not "last write wins."** `arbiter.ts` classifies each prompt's target (file+symbol), groups by file, then: case 1 = concurrent apply; case 2 = execute both + Claude-orchestrated merge into ONE diff (deterministic 3-way merge fallback); case 3 = surface BOTH asks, apply nothing, never drop intent. Conflicts are resolvable by sequence / keep-A / keep-B.
- **Mock adapter = demo insurance.** With no API keys the whole system runs deterministically (presence → classify → merge/conflict → apply → trace). Real Claude/GPT drop in via `.env`.
- **Phoenix tracing + eval.** Each prompt round is one trace (round → classify → execute-per-model → merge → eval). The eval asks the real question: did the applied diff preserve BOTH users' intent (surfaced conflict counts as preserved — nothing dropped).
- **Validated end-to-end.** `npm run smoke` (two simulated WS clients): case-2 merges both intents, case-3 surfaces conflict + resolves via sequencing, Redis Stream ledger recorded all prompts, presence shows both users. 13/13 checks pass. Phoenix shows 2 live traces under project `vibedocs-ai`.
