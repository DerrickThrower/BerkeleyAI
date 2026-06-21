// Process runner + dev-server manager.
//   - run(): one-shot command (tests, build, arbitrary) with streamed output.
//   - DevServer: long-lived `npm run dev`-style process; we sniff its stdout for
//     a localhost URL and report status so the frontend can iframe the preview.
// Output streams to a per-room callback; the server forwards it over WS.

import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";
import type { DevStatus, RunEvent } from "./types.js";

type Emit = (e: RunEvent) => void;
type DevEmit = (s: DevStatus) => void;

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s)]*)/i;

// ---------------------------------------------------------------------------
// One-shot runs (tests / scripts / arbitrary commands)
// ---------------------------------------------------------------------------
const activeRuns = new Map<string, ChildProcess>();

export function run(root: string, cmd: string, label: string, emit: Emit): string {
  const runId = nanoid(8);
  emit({ runId, label, stream: "system", chunk: `$ ${cmd}\n` });
  const child = spawn(cmd, { cwd: root, shell: true, env: process.env });
  activeRuns.set(runId, child);

  child.stdout?.on("data", (d) => emit({ runId, label, stream: "stdout", chunk: d.toString() }));
  child.stderr?.on("data", (d) => emit({ runId, label, stream: "stderr", chunk: d.toString() }));
  child.on("error", (e) =>
    emit({ runId, label, stream: "system", chunk: `error: ${e.message}\n`, done: true, exitCode: null })
  );
  child.on("close", (code) => {
    activeRuns.delete(runId);
    emit({
      runId,
      label,
      stream: "system",
      chunk: `\n[exit ${code}]\n`,
      done: true,
      exitCode: code,
    });
  });
  return runId;
}

export function cancelRun(runId: string): void {
  const child = activeRuns.get(runId);
  if (child) {
    child.kill("SIGTERM");
    activeRuns.delete(runId);
  }
}

// ---------------------------------------------------------------------------
// Dev server (the "localhost" preview), one per session
// ---------------------------------------------------------------------------
export class DevServer {
  private child: ChildProcess | null = null;
  private status: DevStatus = { state: "stopped", url: null, pid: null };

  constructor(
    private root: string,
    private cmd: string,
    private onStatus: DevEmit,
    private onLog: Emit
  ) {}

  getStatus(): DevStatus {
    return this.status;
  }

  private set(s: Partial<DevStatus>) {
    this.status = { ...this.status, ...s };
    this.onStatus(this.status);
  }

  start(): void {
    if (this.child) {
      this.onStatus(this.status);
      return;
    }
    this.set({ state: "starting", url: null, message: this.cmd });
    const label = "dev";
    this.onLog({ runId: "dev", label, stream: "system", chunk: `$ ${this.cmd}\n` });
    const child = spawn(this.cmd, { cwd: this.root, shell: true, env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none" } });
    this.child = child;
    this.set({ pid: child.pid ?? null });

    const sniff = (text: string) => {
      if (this.status.url) return;
      const m = text.match(URL_RE);
      if (m) {
        let url = m[1].replace("0.0.0.0", "localhost").replace("127.0.0.1", "localhost");
        this.set({ state: "running", url });
      }
    };

    child.stdout?.on("data", (d) => {
      const s = d.toString();
      this.onLog({ runId: "dev", label, stream: "stdout", chunk: s });
      sniff(s);
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      this.onLog({ runId: "dev", label, stream: "stderr", chunk: s });
      sniff(s); // vite/next print the URL on stderr sometimes
    });
    child.on("error", (e) => this.set({ state: "error", message: e.message }));
    child.on("close", (code) => {
      this.child = null;
      this.set({ state: code === 0 ? "stopped" : code == null ? "stopped" : "error", url: null, pid: null, message: `exited (${code})` });
    });

    // If no URL appears within 20s but the process is alive, mark running anyway
    // (some servers don't print a parseable URL).
    setTimeout(() => {
      if (this.child && this.status.state === "starting") {
        this.set({ state: "running", message: "running (URL not auto-detected)" });
      }
    }, 20000);
  }

  stop(): void {
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.set({ state: "stopped", url: null, pid: null });
  }
}

// One dev server per session id.
const devServers = new Map<string, DevServer>();

export function getDevServer(
  sessionId: string,
  root: string,
  cmd: string,
  onStatus: DevEmit,
  onLog: Emit
): DevServer {
  let ds = devServers.get(sessionId);
  if (!ds) {
    ds = new DevServer(root, cmd, onStatus, onLog);
    devServers.set(sessionId, ds);
  }
  return ds;
}

export function peekDevServer(sessionId: string): DevServer | undefined {
  return devServers.get(sessionId);
}
