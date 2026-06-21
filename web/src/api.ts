// Typed REST client for the VibeDocs workspace backend.
// Base URL configurable via VITE_API_URL (default http://localhost:8787).

import type {
  Session,
  FileNode,
  FileContent,
  DiffFile,
  AiEditResult,
  GitInfo,
  GitOpResult,
  ShipResult,
  DevStatus,
  ModelChoice,
} from "./workspace-types";

const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new ApiError(
      `Cannot reach server at ${API_URL}. Is it running?`,
      0
    );
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string" && body
        ? body
        : `Request failed (${res.status})`) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

function jsonBody(data: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(data) };
}

export const api = {
  base: API_URL,

  // ---- Sessions ----
  listSessions: () => req<Session[]>("/api/sessions"),
  createSession: (data: {
    name: string;
    root: string;
    devCmd?: string;
    testCmd?: string;
  }) => req<Session>("/api/sessions", jsonBody(data)),
  getSession: (id: string) => req<Session>(`/api/sessions/${id}`),
  deleteSession: (id: string) =>
    req<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),

  // ---- Files ----
  tree: (id: string) => req<FileNode>(`/api/sessions/${id}/tree`),
  readFile: (id: string, path: string) =>
    req<FileContent>(
      `/api/sessions/${id}/file?path=${encodeURIComponent(path)}`
    ),
  writeFile: (id: string, path: string, content: string) =>
    req<{ ok: boolean }>(`/api/sessions/${id}/file`, jsonBody({ path, content })),

  // ---- Diff ----
  diff: (id: string) => req<{ files: DiffFile[] }>(`/api/sessions/${id}/diff`),

  // ---- AI edit ----
  aiEdit: (id: string, path: string, prompt: string, model: ModelChoice) =>
    req<AiEditResult>(
      `/api/sessions/${id}/ai-edit`,
      jsonBody({ path, prompt, model })
    ),

  // ---- Git ----
  git: (id: string) => req<GitInfo>(`/api/sessions/${id}/git`),
  gitBranch: (id: string, name: string, from?: string) =>
    req<GitOpResult>(`/api/sessions/${id}/git/branch`, jsonBody({ name, from })),
  gitCheckout: (id: string, name: string) =>
    req<GitOpResult>(`/api/sessions/${id}/git/checkout`, jsonBody({ name })),
  gitCommit: (id: string, message: string) =>
    req<GitOpResult>(`/api/sessions/${id}/git/commit`, jsonBody({ message })),
  gitPush: (
    id: string,
    opts: { branch?: string; remote?: string; setUpstream?: boolean } = {}
  ) => req<GitOpResult>(`/api/sessions/${id}/git/push`, jsonBody(opts)),
  gitShip: (
    id: string,
    opts: { branch: string; newBranch?: boolean; message: string; push?: boolean }
  ) => req<ShipResult>(`/api/sessions/${id}/git/ship`, jsonBody(opts)),

  // ---- Dev server status ----
  dev: (id: string) => req<DevStatus>(`/api/sessions/${id}/dev`),
};
