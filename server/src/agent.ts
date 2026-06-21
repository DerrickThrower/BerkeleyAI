// ============================================================================
// Cursor-style coding agent — a Claude tool-use loop that works across the
// WHOLE codebase, not one file at a time. Given a single high-level prompt it
// reads/searches files and applies edits to as many files as needed, streaming
// each step so the UI can show a live activity log. Edits land on disk and show
// up in the Diff pane, ready to Ship.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, HAS_CLAUDE } from "./config.js";
import { readTree, readFileSafe, writeFileSafe, fileExists } from "./workspace.js";
import { withSpan } from "./tracing.js";
import type { AgentEvent } from "./types.js";

type Emit = (e: AgentEvent) => void;

const MAX_ITERATIONS = 40;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_files",
    description:
      "List the files in the project (relative paths). Call this first to understand the codebase layout.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read the full contents of a file by its project-relative path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact substring in a file with new text. old_string must match EXACTLY once. " +
      "Use this for targeted edits to existing files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing one with the given content. " +
      "Prefer edit_file for small changes to existing files.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "finish",
    description: "Call when the task is complete. Provide a short summary of what you changed.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

// Track running agents per session so they can be cancelled.
const running = new Map<string, { cancelled: boolean }>();

export function cancelAgent(sessionId: string): void {
  const r = running.get(sessionId);
  if (r) r.cancelled = true;
}

export async function runAgent(
  sessionId: string,
  root: string,
  prompt: string,
  emit: Emit
): Promise<void> {
  const runId = nanoid(8);
  const changed = new Set<string>();
  const token = { cancelled: false };
  running.set(sessionId, token);

  emit({ runId, phase: "start", text: prompt });

  if (!HAS_CLAUDE) {
    emit({
      runId,
      phase: "error",
      text: "Agent needs an ANTHROPIC_API_KEY (the multi-file agent runs on Claude).",
    });
    emit({ runId, phase: "done", summary: "no model available", filesChanged: [] });
    running.delete(sessionId);
    return;
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const tree = await readTree(root);
  const fileList = flatten(tree).slice(0, 600);

  const system =
    "You are a coding agent operating directly on a real codebase on disk. " +
    "Accomplish the user's request by reading and editing files with the provided tools. " +
    "Work across as many files as needed. Make minimal, correct, idiomatic changes that match " +
    "the surrounding code. Read a file before editing it. When fully done, call finish with a " +
    "concise summary. Do not ask the user questions — make reasonable decisions and proceed.\n\n" +
    `Project files (relative paths):\n${fileList.join("\n")}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  await withSpan(
    "agent.run",
    { "vibedocs.session": sessionId, "vibedocs.prompt": prompt },
    async (span) => {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (token.cancelled) {
          emit({ runId, phase: "error", text: "cancelled" });
          break;
        }

        let resp: Anthropic.Message;
        try {
          resp = await client.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 8192,
            system,
            tools: TOOLS,
            messages,
          });
        } catch (e: any) {
          emit({ runId, phase: "error", text: String(e?.message ?? e) });
          break;
        }

        // surface any assistant prose
        for (const block of resp.content) {
          if (block.type === "text" && block.text.trim()) {
            emit({ runId, phase: "message", text: block.text, iteration: i });
          }
        }

        if (resp.stop_reason !== "tool_use") {
          // model finished without calling finish()
          const last = resp.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
          emit({ runId, phase: "done", summary: last?.text ?? "done", filesChanged: [...changed] });
          break;
        }

        messages.push({ role: "assistant", content: resp.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        let finished = false;

        for (const block of resp.content) {
          if (block.type !== "tool_use") continue;
          const input = (block.input ?? {}) as any;
          const path = input.path as string | undefined;
          emit({ runId, phase: "tool_use", tool: block.name, path, iteration: i });

          let resultText = "";
          try {
            switch (block.name) {
              case "list_files":
                resultText = fileList.join("\n");
                break;
              case "read_file":
                resultText = await readFileSafe(root, path!);
                break;
              case "edit_file": {
                resultText = await applyEdit(root, path!, input.old_string, input.new_string);
                changed.add(path!);
                emit({ runId, phase: "tool_result", tool: "edit_file", path, detail: "edited" });
                break;
              }
              case "write_file": {
                const existed = await fileExists(root, path!);
                await writeFileSafe(root, path!, input.content ?? "");
                changed.add(path!);
                resultText = `ok (${existed ? "overwrote" : "created"} ${path})`;
                emit({
                  runId,
                  phase: "tool_result",
                  tool: "write_file",
                  path,
                  detail: existed ? "overwrote" : "created",
                });
                break;
              }
              case "finish":
                finished = true;
                resultText = "ok";
                emit({ runId, phase: "done", summary: input.summary ?? "done", filesChanged: [...changed] });
                break;
              default:
                resultText = `unknown tool: ${block.name}`;
            }
          } catch (e: any) {
            resultText = `ERROR: ${String(e?.message ?? e)}`;
            emit({ runId, phase: "tool_result", tool: block.name, path, detail: `error: ${resultText}` });
          }

          if (block.name === "read_file" || block.name === "list_files") {
            emit({ runId, phase: "tool_result", tool: block.name, path, detail: "read" });
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText.slice(0, 60000),
          });
        }

        messages.push({ role: "user", content: toolResults });
        if (finished) break;

        if (i === MAX_ITERATIONS - 1) {
          emit({
            runId,
            phase: "done",
            summary: "reached step limit",
            filesChanged: [...changed],
          });
        }
      }
      span?.setAttribute("vibedocs.files_changed", changed.size);
    }
  );

  running.delete(sessionId);
}

// Apply an exact-match single-occurrence replacement.
async function applyEdit(
  root: string,
  path: string,
  oldStr: string,
  newStr: string
): Promise<string> {
  const content = await readFileSafe(root, path);
  if (oldStr === "") {
    // empty old_string => append
    await writeFileSafe(root, path, content + newStr);
    return "ok (appended)";
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) return `ERROR: old_string not found in ${path}`;
  if (content.indexOf(oldStr, idx + oldStr.length) !== -1) {
    return `ERROR: old_string is not unique in ${path}; include more context`;
  }
  await writeFileSafe(root, path, content.slice(0, idx) + newStr + content.slice(idx + oldStr.length));
  return "ok";
}

function flatten(node: { path: string; type: string; children?: any[] }, acc: string[] = []): string[] {
  if (node.type === "file" && node.path) acc.push(node.path);
  for (const c of node.children ?? []) flatten(c, acc);
  return acc;
}
