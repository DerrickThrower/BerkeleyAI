// Target classification: which file + symbol does a prompt intend to change?
// This is what lets the arbiter decide case 1 / 2 / 3 BEFORE execution.
//
// Heuristic-first (fast + deterministic for the demo): match a filename and a
// def/class name that actually exist in the room. Falls back to a Claude call
// only when the heuristic can't find a confident file match and a key is set.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, HAS_CLAUDE } from "./config.js";
import { listSymbols } from "./pyutil.js";
import type { TargetClassification } from "./types.js";
import { extractJsonBlock } from "./adapters/util.js";

export async function classifyTarget(
  promptId: string,
  prompt: string,
  files: Record<string, string>
): Promise<TargetClassification> {
  const paths = Object.keys(files);
  const p = prompt.toLowerCase();

  // 1) file: explicit filename mention wins
  let file =
    paths.find((path) => p.includes(path.toLowerCase())) ??
    paths.find((path) => p.includes(basename(path).toLowerCase()));

  // 2) symbol: a def/class name present in the (candidate) files that the
  // prompt names.
  const candidateFiles = file ? [file] : paths;
  let symbol: string | null = null;
  for (const path of candidateFiles) {
    const syms = listSymbols(files[path]).map((s) => s.name);
    const hit = syms.find((name) => new RegExp(`\\b${escapeRe(name)}\\b`).test(prompt));
    if (hit) {
      symbol = hit;
      if (!file) file = path; // symbol pins the file too
      break;
    }
  }

  if (file) {
    return {
      promptId,
      file,
      symbol,
      rationale: symbol
        ? `prompt names symbol "${symbol}" in ${file}`
        : `prompt references file ${file}`,
    };
  }

  // 3) Claude fallback for ambiguous prompts
  if (HAS_CLAUDE) {
    try {
      return await classifyWithClaude(promptId, prompt, files);
    } catch {
      /* fall through */
    }
  }

  // 4) default: first file, no symbol
  return {
    promptId,
    file: paths[0] ?? "main.py",
    symbol: null,
    rationale: "no explicit target; defaulted to first file",
  };
}

async function classifyWithClaude(
  promptId: string,
  prompt: string,
  files: Record<string, string>
): Promise<TargetClassification> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const manifest = Object.entries(files)
    .map(([path, content]) => `### ${path}\n${listSymbols(content).map((s) => `- ${s.kind} ${s.name}`).join("\n")}`)
    .join("\n\n");
  const resp = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      "Classify which file and symbol a code-edit instruction targets. " +
      'Respond STRICT JSON only: {"file":"<path>","symbol":"<name or null>","rationale":"<short>"}.',
    messages: [
      {
        role: "user",
        content: `Files and their symbols:\n${manifest}\n\nInstruction: ${prompt}`,
      },
    ],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const j = extractJsonBlock(text);
  return {
    promptId,
    file: j?.file ?? Object.keys(files)[0],
    symbol: j?.symbol ?? null,
    rationale: j?.rationale ?? "claude classification",
  };
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
