// OpenAI (GPT) adapter — identical contract to the Claude adapter so the
// arbitration layer never needs to know which provider is underneath.

import OpenAI from "openai";
import { OPENAI_API_KEY, OPENAI_MODEL } from "../config.js";
import type { AdapterInput, AdapterOutput } from "./index.js";
import { extractJsonBlock } from "./util.js";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  // maxRetries:0 + short timeout so a quota/429 fails FAST and we fall back to
  // mock instantly instead of hanging the demo on SDK retry backoff.
  if (!client) client = new OpenAI({ apiKey: OPENAI_API_KEY, maxRetries: 0, timeout: 12000 });
  return client;
}

export async function runOpenAI(input: AdapterInput): Promise<AdapterOutput> {
  const sys =
    "You are a precise code-editing engine inside a collaborative editor. " +
    "Apply ONLY the requested change, keeping everything else identical. If a peer " +
    "change is provided, preserve it and integrate around it. " +
    'Respond with STRICT JSON only: {"newContent": "<entire updated file>", "summary": "<one line>"}.';

  const peer = input.peer
    ? `\n\nTeammate ${input.peer.userName} is editing the SAME file. Their instruction: ` +
      `"${input.peer.prompt}". Their proposed file:\n\`\`\`\n${input.peer.after}\n\`\`\`\n` +
      "Integrate so BOTH intents survive in one coherent file."
    : "";

  const user =
    `File: ${input.file}` +
    (input.symbol ? `\nTarget symbol: ${input.symbol}` : "") +
    `\nInstruction: ${input.prompt}` +
    `\n\nCurrent file content:\n\`\`\`\n${input.before}\n\`\`\`` +
    peer;

  const resp = await getClient().chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices[0]?.message?.content ?? "";
  const parsed = extractJsonBlock(text);
  if (!parsed || typeof parsed.newContent !== "string") {
    throw new Error("openai: could not parse JSON edit response");
  }
  return { newContent: parsed.newContent, summary: parsed.summary ?? input.prompt };
}
