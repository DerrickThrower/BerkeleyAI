import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT ?? 8787);
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// When no keys are present we fall back to the deterministic mock adapter so
// the whole system still runs end-to-end (presence, arbitration, merge, UI).
export const HAS_CLAUDE = ANTHROPIC_API_KEY.length > 0;
export const HAS_OPENAI = OPENAI_API_KEY.length > 0;

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

// Phoenix / OTLP
export const PHOENIX_OTLP_ENDPOINT =
  process.env.PHOENIX_OTLP_ENDPOINT ?? "http://localhost:6006/v1/traces";
export const TRACING_ENABLED = (process.env.TRACING_ENABLED ?? "true") !== "false";

// Arbitration batching window: prompts arriving within this window are
// considered "simultaneous" and arbitrated together. This is what produces the
// live "2 queued, 1 arbitrating" demo beat.
export const ARB_WINDOW_MS = Number(process.env.ARB_WINDOW_MS ?? 1400);

// Redis key helpers — one room = one collaborative codebase.
export const keys = {
  presenceChannel: (room: string) => `room:${room}:presence`,
  eventsChannel: (room: string) => `room:${room}:events`,
  presenceHash: (room: string) => `presence:${room}`,
  usersHash: (room: string) => `users:${room}`,
  filesHash: (room: string) => `files:${room}`,
  locksHash: (room: string) => `locks:${room}`,
  pendingHash: (room: string) => `pending:${room}`,
  sessionsSet: () => `sessions:index`,
  sessionHash: (id: string) => `session:${id}`,
  promptsStream: (room: string) => `prompts:${room}`,
  activityStream: (room: string) => `activity:${room}`,
};
