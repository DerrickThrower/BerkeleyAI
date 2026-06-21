// Reconciliation for case 2 (same file, compatible changes). The whole point of
// the project: two simultaneous edits become ONE coherent diff, never two diffs
// overwriting each other.
//
//   - When a Claude key is present, Claude orchestrates the merge (it sees the
//     base file and both proposed versions and produces one reconciled file).
//   - Otherwise a deterministic line-level 3-way merge combines non-overlapping
//     hunks. If hunks overlap it returns {conflict:true} so the arbiter can
//     escalate to case 3 instead of silently picking a winner.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, HAS_CLAUDE } from "./config.js";
import { extractJsonBlock } from "./adapters/util.js";

export interface MergeResult {
  merged: string | null; // null when genuinely conflicting
  conflict: boolean;
  summary: string;
  via: "claude" | "3way";
}

export async function mergeProposals(
  file: string,
  base: string,
  a: { prompt: string; user: string; after: string },
  b: { prompt: string; user: string; after: string }
): Promise<MergeResult> {
  if (HAS_CLAUDE) {
    try {
      return await mergeWithClaude(file, base, a, b);
    } catch {
      /* fall back to deterministic merge */
    }
  }
  return threeWayMerge(base, a.after, b.after);
}

async function mergeWithClaude(
  file: string,
  base: string,
  a: { prompt: string; user: string; after: string },
  b: { prompt: string; user: string; after: string }
): Promise<MergeResult> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You are the merge orchestrator in a collaborative code editor. Two people " +
      "edited the SAME file simultaneously. You are given the ORIGINAL file and each " +
      "person's full proposed version. Produce ONE coherent file that preserves BOTH " +
      "intents. If — and only if — the two changes are truly contradictory on the same " +
      "lines and cannot coexist, set conflict=true and return the original unchanged. " +
      'Respond STRICT JSON only: {"merged":"<full file>","conflict":<bool>,"summary":"<one line>"}.',
    messages: [
      {
        role: "user",
        content:
          `File: ${file}\n\nORIGINAL:\n\`\`\`\n${base}\n\`\`\`\n\n` +
          `${a.user} ("${a.prompt}"):\n\`\`\`\n${a.after}\n\`\`\`\n\n` +
          `${b.user} ("${b.prompt}"):\n\`\`\`\n${b.after}\n\`\`\``,
      },
    ],
  });
  const text = resp.content
    .filter((bl): bl is Anthropic.TextBlock => bl.type === "text")
    .map((bl) => bl.text)
    .join("");
  const j = extractJsonBlock(text);
  if (!j) throw new Error("merge: unparseable");
  return {
    merged: j.conflict ? null : j.merged,
    conflict: !!j.conflict,
    summary: j.summary ?? "merged both changes",
    via: "claude",
  };
}

// --------------------------- deterministic 3-way ---------------------------

export function threeWayMerge(base: string, a: string, b: string): MergeResult {
  const baseL = base.split("\n");
  const hunksA = computeHunks(baseL, a.split("\n"));
  const hunksB = computeHunks(baseL, b.split("\n"));

  // overlap check in base coordinates
  for (const ha of hunksA) {
    for (const hb of hunksB) {
      if (ha.start < hb.end && hb.start < ha.end) {
        return { merged: null, conflict: true, summary: "edits overlap the same lines", via: "3way" };
      }
    }
  }

  // apply all hunks to base from bottom to top so indices stay valid
  const all = [...hunksA, ...hunksB].sort((x, y) => y.start - x.start);
  const out = [...baseL];
  for (const h of all) out.splice(h.start, h.end - h.start, ...h.repl);
  return { merged: out.join("\n"), conflict: false, summary: "combined non-overlapping changes", via: "3way" };
}

interface Hunk {
  start: number; // base line index (inclusive)
  end: number; // base line index (exclusive)
  repl: string[];
}

// LCS-based diff → contiguous change hunks in base coordinates.
function computeHunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = base[i] === other[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const hunks: Hunk[] = [];
  let i = 0,
    j = 0;
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur) {
      hunks.push(cur);
      cur = null;
    }
  };
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      flush();
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      // deletion of base[i]
      cur ??= { start: i, end: i, repl: [] };
      cur.end = i + 1;
      i++;
    } else {
      // insertion of other[j]
      cur ??= { start: i, end: i, repl: [] };
      cur.repl.push(other[j]);
      j++;
    }
  }
  while (i < n) {
    cur ??= { start: i, end: i, repl: [] };
    cur.end = i + 1;
    i++;
  }
  if (j < m) {
    cur ??= { start: n, end: n, repl: [] };
    while (j < m) cur.repl.push(other[j++]);
  }
  flush();
  return hunks;
}
