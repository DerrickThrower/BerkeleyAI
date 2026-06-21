// Git helpers for the visual diff pane. Reads working-tree changes via the git
// CLI and returns structured per-file diffs the frontend can color.

import { execFileSync, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { DiffFile } from "./types.js";

const pexec = promisify(execFile);

export function isGitRepo(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", ["-C", root, ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

const STATUS_MAP: Record<string, DiffFile["status"]> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "?": "untracked",
};

// Working-tree diff (staged + unstaged + untracked) against HEAD.
export async function workingDiff(root: string): Promise<DiffFile[]> {
  if (!isGitRepo(root)) return [];
  const porcelain = await git(root, ["status", "--porcelain=v1", "-z"]);
  const entries = porcelain.split("\0").filter(Boolean);

  const out: DiffFile[] = [];
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    const x = code.trim()[0] ?? "M";
    const status = STATUS_MAP[x] ?? "modified";

    if (status === "untracked") {
      let content = "";
      try {
        content = readFileSync(resolve(root, path), "utf8");
      } catch {
        /* binary or unreadable */
      }
      const lines = content ? content.split("\n") : [];
      out.push({
        path,
        status,
        additions: lines.length,
        deletions: 0,
        patch: lines.map((l) => `+${l}`).join("\n"),
      });
      continue;
    }

    // tracked change: get the unified patch (HEAD → working tree)
    let patch = "";
    try {
      patch = await git(root, ["diff", "--no-color", "HEAD", "--", path]);
    } catch {
      try {
        patch = await git(root, ["diff", "--no-color", "--", path]);
      } catch {
        /* ignore */
      }
    }
    const additions = (patch.match(/^\+(?!\+\+)/gm) ?? []).length;
    const deletions = (patch.match(/^-(?!--)/gm) ?? []).length;
    out.push({ path, status, additions, deletions, patch });
  }
  return out;
}

// Diff for a single file's pending change vs HEAD (used after an AI edit to show
// exactly what changed). Falls back to a synthetic patch when not a repo.
export async function fileDiff(root: string, path: string): Promise<DiffFile | null> {
  const all = await workingDiff(root);
  return all.find((d) => d.path === path) ?? null;
}

export function hasUncommitted(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain"], {
      encoding: "utf8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// ===========================================================================
// Git operations — branch / commit / push (the "agentically ship" feature).
// Pushes run in the user's environment so their existing git credentials
// (ssh keys / credential helper) apply.
// ===========================================================================

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

async function tryGit(root: string, args: string[]): Promise<string> {
  try {
    return (await git(root, args)).trim();
  } catch {
    return "";
  }
}

export async function gitInfo(root: string): Promise<GitInfo> {
  if (!isGitRepo(root)) {
    return {
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      changedFiles: 0,
      hasRemote: false,
      remote: null,
      branches: [],
    };
  }
  const branch = (await tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"])) || null;
  const porcelain = await tryGit(root, ["status", "--porcelain"]);
  const changedFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const remotes = await tryGit(root, ["remote"]);
  const remote = remotes ? remotes.split("\n")[0] : null;

  let ahead = 0;
  let behind = 0;
  const counts = await tryGit(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  if (counts) {
    const [b, a] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0);
    behind = b;
    ahead = a;
  }
  const branchList = await tryGit(root, ["branch", "--format=%(refname:short)"]);
  const branches = branchList ? branchList.split("\n").filter(Boolean) : [];

  return {
    isRepo: true,
    branch,
    ahead,
    behind,
    dirty: changedFiles > 0,
    changedFiles,
    hasRemote: !!remote,
    remote,
    branches,
  };
}

export interface GitOpResult {
  ok: boolean;
  output: string;
  error?: string;
}

async function runGitCapture(root: string, args: string[]): Promise<GitOpResult> {
  try {
    const { stdout, stderr } = await pexec("git", ["-C", root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e: any) {
    return { ok: false, output: (e?.stdout ?? "") + (e?.stderr ?? ""), error: String(e?.message ?? e) };
  }
}

export async function createBranch(root: string, name: string, from?: string): Promise<GitOpResult> {
  const args = from ? ["checkout", "-b", name, from] : ["checkout", "-b", name];
  return runGitCapture(root, args);
}

export async function checkoutBranch(root: string, name: string): Promise<GitOpResult> {
  return runGitCapture(root, ["checkout", name]);
}

export async function commitAll(root: string, message: string): Promise<GitOpResult> {
  const add = await runGitCapture(root, ["add", "-A"]);
  if (!add.ok) return add;
  return runGitCapture(root, ["commit", "-m", message]);
}

export async function push(
  root: string,
  opts: { branch?: string; remote?: string; setUpstream?: boolean } = {}
): Promise<GitOpResult> {
  const info = await gitInfo(root);
  const remote = opts.remote ?? info.remote ?? "origin";
  const branch = opts.branch ?? info.branch ?? "HEAD";
  const args = ["push"];
  if (opts.setUpstream ?? info.ahead >= 0) args.push("-u");
  args.push(remote, branch);
  return runGitCapture(root, args);
}

// One-shot "ship": (optionally) branch off, commit everything, push.
export async function ship(
  root: string,
  opts: { branch?: string; message: string; newBranch?: boolean; push?: boolean }
): Promise<{ steps: { step: string; result: GitOpResult }[]; ok: boolean }> {
  const steps: { step: string; result: GitOpResult }[] = [];
  const record = (step: string, result: GitOpResult) => {
    steps.push({ step, result });
    return result.ok;
  };

  if (opts.branch && opts.newBranch) {
    if (!record("create branch", await createBranch(root, opts.branch))) return { steps, ok: false };
  } else if (opts.branch) {
    const co = await checkoutBranch(root, opts.branch);
    // if checkout fails because branch doesn't exist, create it
    if (!co.ok) {
      if (!record("create branch", await createBranch(root, opts.branch))) return { steps, ok: false };
    } else {
      record("checkout", co);
    }
  }

  const commit = await commitAll(root, opts.message);
  // "nothing to commit" is not a hard failure for shipping
  record("commit", commit);

  if (opts.push) {
    const branch = opts.branch ?? (await gitInfo(root)).branch ?? undefined;
    if (!record("push", await push(root, { branch, setUpstream: true }))) return { steps, ok: false };
  }
  return { steps, ok: true };
}
