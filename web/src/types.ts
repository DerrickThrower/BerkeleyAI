export type ModelChoice = "claude" | "gpt" | "mock";
export type PresenceState = "idle" | "typing" | "prompting" | "viewing";
export interface User { id: string; name: string; color: string; model: ModelChoice; }
export interface Presence { userId: string; name: string; color: string; state: PresenceState; file: string | null; cursor?: { line: number; ch: number }; ts: number; }
export interface PromptRequest { id: string; roomId: string; userId: string; userName: string; userColor: string; model: ModelChoice; text: string; ts: number; }
export type ArbCase = 1 | 2 | 3;
export interface TargetClassification { promptId: string; file: string; symbol: string | null; rationale: string; }
export type ResolutionType = "case1_parallel" | "case2_merged" | "case3_sequenced" | "case3_conflict";
export interface Proposal { promptId: string; userName: string; userColor: string; model: ModelChoice; file: string; before: string; after: string; summary: string; }
export interface ConflictView { file: string; symbol: string | null; asks: { promptId: string; userName: string; userColor: string; text: string }[]; }
export interface Resolution { id: string; roomId: string; arbCase: ArbCase; type: ResolutionType; prompts: PromptRequest[]; classifications: TargetClassification[]; appliedFiles: Record<string, string>; proposals: Proposal[]; conflict?: ConflictView; summary: string; ts: number; }

// Workspace WS payloads (run/dev streaming). Defined in workspace-types.ts.
import type { RunEvent, DevStatus, AgentEvent } from "./workspace-types";

export type ServerMsg =
  | { type: "room_state"; roomId: string; you: User; files: Record<string, string>; users: User[]; presence: Presence[] }
  | { type: "presence"; presence: Presence[] }
  | { type: "prompt_queued"; prompt: PromptRequest; queueDepth: number }
  | { type: "arbitrating"; promptIds: string[]; arbCase: ArbCase; classifications: TargetClassification[] }
  | { type: "resolution"; resolution: Resolution }
  | { type: "file_update"; file: string; content: string }
  | { type: "run_event"; event: RunEvent }
  | { type: "dev_status"; status: DevStatus }
  | { type: "agent_event"; event: AgentEvent }
  | { type: "error"; message: string };

export type ClientMsg =
  | { type: "join"; roomId: string; user: { name: string; color: string; model: ModelChoice } }
  | { type: "presence"; state: PresenceState; file: string | null; cursor?: { line: number; ch: number } }
  | { type: "set_model"; model: ModelChoice }
  | { type: "submit_prompt"; text: string; model: ModelChoice; file?: string }
  | { type: "resolve_conflict"; resolutionId: string; strategy: "sequence" | "keep_a" | "keep_b" }
  | { type: "run"; cmd: string; label?: string }
  | { type: "run_cancel"; runId: string }
  | { type: "agent"; prompt: string; model?: ModelChoice }
  | { type: "agent_cancel" }
  | { type: "dev_start" }
  | { type: "dev_stop" };
