// Shared workspace contracts — mirror of the server's workspace model.
// Keep in sync with server/src/types.ts.

export type ModelChoice = "claude" | "gpt" | "mock";

export interface Session {
  id: string;
  name: string;
  root: string;
  devCmd: string;
  testCmd: string;
  createdAt: number;
  lastOpenedAt: number;
  git: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface DiffFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  patch: string;
}

export type DevState = "stopped" | "starting" | "running" | "error";

export interface DevStatus {
  state: DevState;
  url: string | null;
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

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFiles: number;
  hasRemote: boolean;
  remote: string | null;
  branches: string[];
}

// ---- API response payloads ----
export interface FileContent {
  path: string;
  content: string;
}

export interface AiEditResult {
  ok: boolean;
  path: string;
  before: string;
  after: string;
  summary: string;
  model: ModelChoice;
  error?: string;
}

export interface GitOpResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface ShipResult {
  steps: { step: string; result: GitOpResult }[];
  ok: boolean;
}

// ---- Cursor-style multi-file agent ----
export type AgentPhase = "start" | "message" | "tool_use" | "tool_result" | "error" | "done";
export interface AgentEvent {
  runId: string;
  phase: AgentPhase;
  text?: string;
  tool?: string;       // list_files | read_file | edit_file | write_file | finish
  path?: string;
  detail?: string;
  iteration?: number;
  summary?: string;
  filesChanged?: string[];
}

// ---- Workspace WebSocket server messages (sent over the same WS) ----
export type WorkspaceServerMsg =
  | { type: "run_event"; event: RunEvent }
  | { type: "dev_status"; status: DevStatus }
  | { type: "agent_event"; event: AgentEvent }
  | { type: "presence"; presence: WorkspacePresence[] };

export interface WorkspacePresence {
  userId: string;
  name: string;
  color: string;
  state: string;
  file: string | null;
  ts: number;
}
