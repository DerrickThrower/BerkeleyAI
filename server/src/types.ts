// ============================================================================
// VibeDocs AI — Shared Contracts
// The single source of truth for every module (server, arbiter, adapters,
// frontend). Change here = change everywhere. Build this first; build the rest
// around it.
// ============================================================================

export type ModelChoice = "claude" | "gpt" | "mock";

export type PresenceState = "idle" | "typing" | "prompting" | "viewing";

export interface User {
  id: string;
  name: string;
  color: string; // hex accent color, assigned per session
  model: ModelChoice;
}

export interface Presence {
  userId: string;
  name: string;
  color: string;
  state: PresenceState;
  file: string | null; // file they're focused on
  cursor?: { line: number; ch: number };
  ts: number;
}

export interface PromptRequest {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  userColor: string;
  model: ModelChoice;
  text: string;
  ts: number;
}

// 1 = non-overlapping, 2 = compatible overlap, 3 = genuine conflict
export type ArbCase = 1 | 2 | 3;

export interface TargetClassification {
  promptId: string;
  file: string; // target file path
  symbol: string | null; // target function/symbol if identifiable
  rationale: string;
}

export interface ExecResult {
  promptId: string;
  file: string;
  newContent: string;
  summary: string;
  model: ModelChoice;
  ok: boolean;
  error?: string;
}

export type ResolutionType =
  | "case1_parallel" // both unrelated, applied concurrently
  | "case2_merged" // same file, different symbols, Claude-merged into one diff
  | "case3_sequenced" // same symbol, 2nd re-contextualized against 1st's result
  | "case3_conflict"; // same symbol, contradictory — surfaced, nothing dropped

export interface Proposal {
  promptId: string;
  userName: string;
  userColor: string;
  model: ModelChoice;
  file: string;
  before: string; // original file content
  after: string; // proposed file content from this user's prompt
  summary: string;
}

export interface ConflictView {
  file: string;
  symbol: string | null;
  asks: { promptId: string; userName: string; userColor: string; text: string }[];
}

export interface Resolution {
  id: string;
  roomId: string;
  arbCase: ArbCase;
  type: ResolutionType;
  prompts: PromptRequest[];
  classifications: TargetClassification[];
  // per-file final content after applying resolution (empty for unresolved conflict)
  appliedFiles: Record<string, string>;
  // for the signature merge animation: each user's proposed change, in their color
  proposals: Proposal[];
  // present only for case3_conflict — both asks shown, nothing applied
  conflict?: ConflictView;
  summary: string;
  ts: number;
}

// ============================================================================
// WebSocket message envelopes
// ============================================================================

export type ServerMsg =
  | { type: "room_state"; roomId: string; you: User; files: Record<string, string>; users: User[]; presence: Presence[] }
  | { type: "presence"; presence: Presence[] }
  | { type: "prompt_queued"; prompt: PromptRequest; queueDepth: number }
  | { type: "arbitrating"; promptIds: string[]; arbCase: ArbCase; classifications: TargetClassification[] }
  | { type: "resolution"; resolution: Resolution }
  | { type: "file_update"; file: string; content: string }
  | { type: "error"; message: string };

export type ClientMsg =
  | { type: "join"; roomId: string; user: { name: string; color: string; model: ModelChoice } }
  | { type: "presence"; state: PresenceState; file: string | null; cursor?: { line: number; ch: number } }
  | { type: "set_model"; model: ModelChoice }
  | { type: "submit_prompt"; text: string; model: ModelChoice; file?: string }
  | { type: "resolve_conflict"; resolutionId: string; strategy: "sequence" | "keep_a" | "keep_b" }
  // workspace control
  | { type: "run"; cmd: string; label?: string }
  | { type: "run_cancel"; runId: string }
  | { type: "dev_start" }
  | { type: "dev_stop" }
  // Cursor-style multi-file agent
  | { type: "agent"; prompt: string; model?: ModelChoice }
  | { type: "agent_cancel" };

// ============================================================================
// Workspace model — sessions backed by a REAL codebase on disk.
// A session is one "document" in the dashboard; its id doubles as the room id
// for presence/collaboration.
// ============================================================================

export interface Session {
  id: string;
  name: string;
  root: string; // absolute path to the project directory on disk
  devCmd: string; // command to start the localhost dev server (e.g. "npm run dev")
  testCmd: string; // command to run tests (e.g. "npm test")
  createdAt: number;
  lastOpenedAt: number;
  git: boolean; // is root a git repo?
}

export interface FileNode {
  name: string;
  path: string; // relative to session root, POSIX separators
  type: "file" | "dir";
  children?: FileNode[];
}

export interface DiffFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  patch: string; // unified diff text (no color), or full content for untracked
}

export type DevState = "stopped" | "starting" | "running" | "error";

export interface DevStatus {
  state: DevState;
  url: string | null; // detected localhost URL once running
  pid: number | null;
  message?: string;
}

export interface RunEvent {
  runId: string;
  label: string;
  stream: "stdout" | "stderr" | "system";
  chunk: string;
  done?: boolean;
  exitCode?: number | null;
}

// Cursor-style agent: one event per step in the agentic loop, streamed live.
export type AgentPhase =
  | "start"
  | "message" // assistant prose
  | "tool_use" // about to run a tool (read/list/write/edit)
  | "tool_result" // tool finished
  | "error"
  | "done";

export interface AgentEvent {
  runId: string;
  phase: AgentPhase;
  text?: string; // assistant prose or error text
  tool?: string; // tool name (list_files / read_file / write_file / edit_file)
  path?: string; // file the tool touched
  detail?: string; // short human label, e.g. "edited 3 lines"
  iteration?: number;
  summary?: string; // final summary (phase=done)
  filesChanged?: string[]; // cumulative changed file paths (phase=done)
}

// Workspace-related server messages (sent over the same WS as ServerMsg)
export type WorkspaceMsg =
  | { type: "tree"; tree: FileNode }
  | { type: "file"; path: string; content: string }
  | { type: "diff"; files: DiffFile[] }
  | { type: "run_event"; event: RunEvent }
  | { type: "dev_status"; status: DevStatus }
  | { type: "agent_event"; event: AgentEvent };
