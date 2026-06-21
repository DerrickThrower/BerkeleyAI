// ============================================================================
// THE ARBITRATION AGENT — the entire thesis of the project.
//
// Two people, same room, same moment, prompts that may or may not touch the
// same files. Three cases, handled DISTINCTLY (never "last write wins"):
//
//   case 1  non-overlapping   different files            -> run concurrently, both apply
//   case 2  compatible overlap same file, diff symbols   -> run both, Claude-merge into ONE diff
//   case 3  genuine conflict   same symbol, contradictory -> SURFACE both asks; drop nothing
//
// A round = the set of prompts that arrived inside the arbitration window.
// We group by target file; each group becomes one Resolution.
// ============================================================================

import { nanoid } from "nanoid";
import { redis, getFiles, setFile, claimFile, releaseFile, recordResolution } from "./redis.js";
import { keys } from "./config.js";
import { classifyTarget } from "./classify.js";
import { execute } from "./adapters/index.js";
import { mergeProposals } from "./merge.js";
import { withSpan, evaluateIntentPreservation } from "./tracing.js";
import type {
  ArbCase,
  Proposal,
  PromptRequest,
  Resolution,
  TargetClassification,
} from "./types.js";

export interface ArbOutcome {
  arbCase: ArbCase; // round severity (max across groups), for the UI label
  classifications: TargetClassification[];
  resolutions: Resolution[];
}

// onClassified fires right after the (fast) classification so the UI can show
// the "arbitrating · case N" state DURING the slow execute+merge work, not
// after it.
export async function arbitrate(
  room: string,
  prompts: PromptRequest[],
  onClassified?: (arbCase: ArbCase, classifications: TargetClassification[]) => void
): Promise<ArbOutcome> {
  return withSpan(
    "arbitration.round",
    { "vibedocs.room": room, "vibedocs.prompt_count": prompts.length },
    async (span) => {
      const files = await getFiles(room);

      // 1) classify every prompt (target file + symbol)
      const classifications = await withSpan(
        "arbitration.classify",
        { prompts: prompts.map((p) => p.text) },
        () => Promise.all(prompts.map((p) => classifyTarget(p.id, p.text, files))),
        "CHAIN"
      );
      const classOf = (id: string) => classifications.find((c) => c.promptId === id)!;

      // 2) group prompts by target file
      const byFile = new Map<string, PromptRequest[]>();
      for (const p of prompts) {
        const f = classOf(p.id).file;
        (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(p);
      }

      // Preliminary case from classification alone (before execution): single
      // prompt/file = 1, same file/distinct symbols = 2, same symbol = 3.
      let prelim: ArbCase = 1;
      for (const [, group] of byFile) {
        if (group.length === 1) continue;
        const syms = group.map((g) => classOf(g.id).symbol);
        const same = syms.some((s) => s === null) || new Set(syms).size < syms.length;
        prelim = Math.max(prelim, same ? 3 : 2) as ArbCase;
      }
      onClassified?.(prelim, classifications);

      // 3) resolve each file-group into a Resolution
      const resolutions: Resolution[] = [];
      let severity: ArbCase = 1;
      for (const [file, group] of byFile) {
        const res = await resolveGroup(room, file, group, classifications, files[file] ?? "");
        severity = Math.max(severity, res.arbCase) as ArbCase;
        resolutions.push(res);
      }

      span?.setAttribute("vibedocs.round_case", severity);
      return { arbCase: severity, classifications, resolutions };
    }
  );
}

async function resolveGroup(
  room: string,
  file: string,
  group: PromptRequest[],
  classifications: TargetClassification[],
  before: string
): Promise<Resolution> {
  const classOf = (id: string) => classifications.find((c) => c.promptId === id)!;

  // --- CASE 1: a single prompt on this file (no contention) ---
  if (group.length === 1) {
    const p = group[0];
    const c = classOf(p.id);
    await claimFile(room, file, p.userId);
    const r = await withSpan(
      "execute",
      { model: p.model, file, symbol: c.symbol ?? "", prompt: p.text },
      () => execute({ prompt: p.text, file, before, symbol: c.symbol, model: p.model }, p.id),
      "LLM"
    );
    await setFile(room, file, r.newContent);
    await releaseFile(room, file);
    const proposal: Proposal = {
      promptId: p.id,
      userName: p.userName,
      userColor: p.userColor,
      model: r.model,
      file,
      before,
      after: r.newContent,
      summary: r.summary,
    };
    return finalize(room, {
      arbCase: 1,
      type: "case1_parallel",
      prompts: group,
      classifications: group.map((g) => classOf(g.id)),
      appliedFiles: { [file]: r.newContent },
      proposals: [proposal],
      summary: `${p.userName}: ${r.summary}`,
    });
  }

  // --- CASE 2 or 3: multiple prompts contend for the same file ---
  // First, execute each prompt INDEPENDENTLY against the original file so we
  // have each user's proposed diff (the side-by-side "both intents" view).
  await claimFile(room, file, "arbiter");
  const execs = await Promise.all(
    group.map((p) => {
      const c = classOf(p.id);
      return withSpan(
        "execute",
        { model: p.model, file, symbol: c.symbol ?? "", prompt: p.text },
        () => execute({ prompt: p.text, file, before, symbol: c.symbol, model: p.model }, p.id),
        "LLM"
      );
    })
  );
  const proposals: Proposal[] = group.map((p, i) => ({
    promptId: p.id,
    userName: p.userName,
    userColor: p.userColor,
    model: execs[i].model,
    file,
    before,
    after: execs[i].newContent,
    summary: execs[i].summary,
  }));

  // Same symbol (or whole-file / null symbol) => contradictory intent => case 3.
  const symbols = group.map((p) => classOf(p.id).symbol);
  const sameSymbol =
    symbols.some((s) => s === null) || new Set(symbols).size < symbols.length;

  if (!sameSymbol) {
    // CASE 2: distinct symbols — attempt a real reconciliation into ONE diff.
    const [a, b] = group;
    const merge = await withSpan(
      "merge.reconcile",
      { file, userA: a.userName, userB: b.userName },
      () =>
        mergeProposals(
          file,
          before,
          { prompt: a.text, user: a.userName, after: proposals[0].after },
          { prompt: b.text, user: b.userName, after: proposals[1].after }
        ),
      "CHAIN"
    );

    if (!merge.conflict && merge.merged != null) {
      await setFile(room, file, merge.merged);
      await releaseFile(room, file);
      return finalize(room, {
        arbCase: 2,
        type: "case2_merged",
        prompts: group,
        classifications: group.map((g) => classOf(g.id)),
        appliedFiles: { [file]: merge.merged },
        proposals,
        summary: `merged (${merge.via}): ${proposals.map((p) => p.summary).join(" + ")}`,
      });
    }
    // merge said the changes actually collide -> fall through to conflict.
  }

  // CASE 3: genuine conflict. SURFACE both asks; apply NOTHING automatically.
  await releaseFile(room, file);
  const symbol = symbols.find((s) => s != null) ?? null;
  return finalize(room, {
    arbCase: 3,
    type: "case3_conflict",
    prompts: group,
    classifications: group.map((g) => classOf(g.id)),
    appliedFiles: {}, // nothing applied — nothing dropped
    proposals,
    conflict: {
      file,
      symbol,
      asks: group.map((p) => ({
        promptId: p.id,
        userName: p.userName,
        userColor: p.userColor,
        text: p.text,
      })),
    },
    summary: `conflict on ${file}${symbol ? `:${symbol}` : ""} — surfaced for human resolution`,
  });
}

// Resolve a surfaced case-3 conflict via a user choice. Never reached unless a
// human picks; until then both intents stay visible.
export async function resolveConflict(
  room: string,
  resolutionId: string,
  strategy: "sequence" | "keep_a" | "keep_b"
): Promise<Resolution | null> {
  const raw = await redis.hget(keys.pendingHash(room), resolutionId);
  if (!raw) return null;
  const pending = JSON.parse(raw) as Resolution;
  const file = pending.conflict!.file;
  const before = pending.proposals[0]?.before ?? (await getFiles(room))[file] ?? "";
  const [a, b] = pending.prompts;
  const classOf = (id: string) => pending.classifications.find((c) => c.promptId === id)!;

  let applied: string;
  let type: Resolution["type"];
  let summary: string;

  if (strategy === "keep_a") {
    applied = pending.proposals[0].after;
    type = "case3_sequenced";
    summary = `kept ${a.userName}'s change`;
  } else if (strategy === "keep_b") {
    applied = pending.proposals[1].after;
    type = "case3_sequenced";
    summary = `kept ${b.userName}'s change`;
  } else {
    // SEQUENCE: apply A, then re-run B against A's result (re-contextualized).
    const ca = classOf(a.id);
    const cb = classOf(b.id);
    const ra = await execute({ prompt: a.text, file, before, symbol: ca.symbol, model: a.model }, a.id);
    const rb = await execute(
      {
        prompt: b.text,
        file,
        before: ra.newContent,
        symbol: cb.symbol,
        model: b.model,
        peer: { userName: a.userName, prompt: a.text, after: ra.newContent },
      },
      b.id
    );
    applied = rb.newContent;
    type = "case3_sequenced";
    summary = `sequenced: ${a.userName} then ${b.userName} (re-contextualized)`;
  }

  await setFile(room, file, applied);
  await releaseFile(room, file);
  await redis.hdel(keys.pendingHash(room), resolutionId);

  const resolved: Resolution = {
    ...pending,
    id: nanoid(),
    type,
    appliedFiles: { [file]: applied },
    conflict: undefined,
    summary,
    ts: Date.now(),
  };
  await recordResolution(room, resolved);
  return resolved;
}

// Stamp id/ts, persist case-3 conflicts so they can be resolved later, and
// record every resolution to the append-only ledger with its intent eval.
async function finalize(
  room: string,
  partial: Omit<Resolution, "id" | "roomId" | "ts">
): Promise<Resolution> {
  const r: Resolution = { ...partial, id: nanoid(), roomId: room, ts: Date.now() };
  if (r.type === "case3_conflict") {
    await redis.hset(keys.pendingHash(room), r.id, JSON.stringify(r));
  }
  const evalResult = evaluateIntentPreservation(r);
  await withSpan(
    "eval.intent_preservation",
    {
      "vibedocs.resolution_type": r.type,
      "eval.passed": evalResult.passed,
      "eval.rationale": evalResult.rationale,
      "eval.per_user": evalResult.perUser,
    },
    async () => evalResult,
    "CHAIN"
  );
  await recordResolution(room, r);
  return r;
}
