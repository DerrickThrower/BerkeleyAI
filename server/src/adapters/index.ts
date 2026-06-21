// Provider-agnostic adapter layer. The arbitration agent calls execute() and
// never knows or cares which model is underneath — "you're not beholden to any
// one model" made literal and demoable.

import type { ExecResult, ModelChoice } from "../types.js";
import { HAS_CLAUDE, HAS_OPENAI } from "../config.js";
import { runMock } from "./mock.js";
import { runClaude } from "./claude.js";
import { runOpenAI } from "./openai.js";

export interface AdapterInput {
  prompt: string;
  file: string;
  before: string; // current content of the target file
  symbol: string | null;
  model: ModelChoice;
  // For case 2/3: the peer's simultaneous change, so a model can integrate it.
  peer?: { userName: string; prompt: string; after: string };
}

export interface AdapterOutput {
  newContent: string;
  summary: string;
}

// Resolve the effective adapter. If a provider key is missing we transparently
// fall back to the deterministic mock so the demo never hard-fails on keys.
function resolve(model: ModelChoice): {
  run: (i: AdapterInput) => Promise<AdapterOutput>;
  effective: ModelChoice;
} {
  if (model === "claude" && HAS_CLAUDE) return { run: runClaude, effective: "claude" };
  if (model === "gpt" && HAS_OPENAI) return { run: runOpenAI, effective: "gpt" };
  return { run: runMock, effective: "mock" };
}

export async function execute(input: AdapterInput, promptId: string): Promise<ExecResult> {
  const { run, effective } = resolve(input.model);
  try {
    const out = await run(input);
    return {
      promptId,
      file: input.file,
      newContent: out.newContent,
      summary: out.summary,
      model: effective,
      ok: true,
    };
  } catch (e: any) {
    // Last-ditch fallback to mock so a single provider hiccup never drops a
    // user's prompt during the demo.
    try {
      const out = await runMock({ ...input, model: "mock" });
      return {
        promptId,
        file: input.file,
        newContent: out.newContent,
        summary: out.summary + " (fallback: mock)",
        model: "mock",
        ok: true,
      };
    } catch {
      return {
        promptId,
        file: input.file,
        newContent: input.before,
        summary: "execution failed",
        model: effective,
        ok: false,
        error: String(e?.message ?? e),
      };
    }
  }
}
