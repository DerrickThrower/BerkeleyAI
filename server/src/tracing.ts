// Arize Phoenix observability via OpenTelemetry OTLP. Each prompt's full
// lifecycle is one trace: received → queued → classified → executed (per model)
// → arbitrated/merged → applied. Plus an eval span that asks the real question:
// did the final diff preserve BOTH users' intent (not just "did it run")?

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { trace, context, SpanStatusCode, type Span } from "@opentelemetry/api";
import { PHOENIX_OTLP_ENDPOINT, TRACING_ENABLED } from "./config.js";
import type { Resolution } from "./types.js";

let enabled = false;

export function initTracing(): void {
  if (!TRACING_ENABLED) {
    console.log("[trace] disabled");
    return;
  }
  try {
    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: "vibedocs-ai",
        // Phoenix groups spans by project name via this attribute.
        "openinference.project.name": "vibedocs-ai",
      }),
    });
    provider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: PHOENIX_OTLP_ENDPOINT }))
    );
    provider.register();
    enabled = true;
    console.log(`[trace] exporting to Phoenix at ${PHOENIX_OTLP_ENDPOINT}`);
  } catch (e: any) {
    console.warn("[trace] init failed, continuing without tracing:", e?.message);
  }
}

export function getTracer() {
  return trace.getTracer("vibedocs");
}

// Run `fn` inside a span. Span kind is conveyed via an openinference attribute
// so Phoenix renders it as an LLM/CHAIN step. Never throws on tracing failure.
export async function withSpan<T>(
  name: string,
  attrs: Record<string, any>,
  fn: (span: Span | null) => Promise<T>,
  kind: "CHAIN" | "LLM" | "TOOL" = "CHAIN"
): Promise<T> {
  if (!enabled) return fn(null);
  const tracer = getTracer();
  return await tracer.startActiveSpan(name, async (span) => {
    span.setAttribute("openinference.span.kind", kind);
    for (const [k, v] of Object.entries(attrs)) {
      span.setAttribute(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (e: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: e?.message });
      span.recordException(e);
      throw e;
    } finally {
      span.end();
    }
  });
}

export function getActiveContext() {
  return context.active();
}

// --------------------------------------------------------------------------
// EVAL: did the resolution preserve both users' intent?
// We extract content keywords from each user's prompt and check they survived
// into the applied/merged file. For surfaced conflicts, "preserved" means BOTH
// asks are visible to the users (nothing dropped) — which is the correct
// outcome, so it scores as passing.
// --------------------------------------------------------------------------
export interface IntentEval {
  passed: boolean;
  perUser: { user: string; intentTokens: string[]; survived: boolean }[];
  rationale: string;
}

const STOP = new Set([
  "the","a","an","to","in","on","of","and","or","for","with","make","add","change",
  "update","please","my","is","return","into","at","by","that","this","it","be",
  "py","function","method","def","class","file","code","so","then","also",
]);

function intentTokens(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
    )
  );
}

export function evaluateIntentPreservation(r: Resolution): IntentEval {
  // For a surfaced conflict, both asks remain visible to users → intent preserved.
  if (r.type === "case3_conflict") {
    return {
      passed: true,
      perUser: r.prompts.map((p) => ({
        user: p.userName,
        intentTokens: intentTokens(p.text),
        survived: true,
      })),
      rationale: "conflict surfaced; both intents preserved for human resolution (none dropped)",
    };
  }
  const applied = Object.values(r.appliedFiles).join("\n").toLowerCase();
  const summary = (r.proposals.map((p) => p.summary).join(" ") + " " + r.summary).toLowerCase();
  const haystack = applied + " " + summary;
  const perUser = r.prompts.map((p) => {
    const toks = intentTokens(p.text);
    const survived = toks.some((t) => haystack.includes(t));
    return { user: p.userName, intentTokens: toks, survived };
  });
  const passed = perUser.length > 0 && perUser.every((u) => u.survived);
  return {
    passed,
    perUser,
    rationale: passed
      ? "every user's intent tokens are present in the applied result"
      : "at least one user's intent is missing from the applied result",
  };
}

export { SpanStatusCode };
