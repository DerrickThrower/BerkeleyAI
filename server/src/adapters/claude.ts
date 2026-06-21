// Claude adapter — Anthropic TypeScript SDK. Returns a full new version of the
// target file plus a one-line summary. Strict JSON output, defensively parsed.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL } from "../config.js";
import type { AdapterInput, AdapterOutput } from "./index.js";
import { extractJsonBlock } from "./util.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

export async function runClaude(input: AdapterInput): Promise<AdapterOutput> {
  const sys =
    "You are a precise code-editing engine inside a collaborative editor. " +
    "You are given one source file and an instruction. Apply ONLY the requested " +
    "change, keeping everything else byte-for-byte identical. If a peer change is " +
    "provided, preserve it and integrate around it without clobbering it. " +
    'Respond with STRICT JSON only: {"newContent": "<entire updated file>", "summary": "<one line>"}.';

  const peer = input.peer
    ? `\n\nA teammate (${input.peer.userName}) is editing the SAME file at the same time. ` +
      `Their instruction: "${input.peer.prompt}". Their proposed version of the file:\n` +
      "```\n" + input.peer.after + "\n```\n" +
      "Integrate your change so BOTH intents survive in one coherent file."
    : "";

  const user =
    `File: ${input.file}` +
    (input.symbol ? `\nTarget symbol: ${input.symbol}` : "") +
    `\nInstruction: ${input.prompt}` +
    `\n\nCurrent file content:\n\`\`\`\n${input.before}\n\`\`\`` +
    peer;

  const resp = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = extractJsonBlock(text);
  if (!parsed || typeof parsed.newContent !== "string") {
    throw new Error("claude: could not parse JSON edit response");
  }
  return { newContent: parsed.newContent, summary: parsed.summary ?? input.prompt };
}
