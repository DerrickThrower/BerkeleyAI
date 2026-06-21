// WebSocket server — the realtime transport. Carries presence, live status, and
// resolved-diff broadcast to every connected client in a room.
//
// Presence genuinely rides Redis Pub/Sub (publish on change → fan out to all
// local sockets), so two browser tabs can know about each other. The activity
// ledger is Redis Streams. Resolutions fan out to connected clients directly.

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { PORT, keys } from "./config.js";
import {
  redis,
  sub,
  waitForRedis,
  getFiles,
  getUsers,
  getPresence,
  upsertUser,
  removeUser,
  setPresence,
  clearPresence,
} from "./redis.js";
import { initTracing } from "./tracing.js";
import { Intake } from "./intake.js";
import { resolveConflict } from "./arbiter.js";
import { ensureSeed } from "./seed.js";
import {
  listSessions,
  getSession,
  createSession,
  touchSession,
  deleteSession,
} from "./sessions.js";
import { readTree, readFileSafe, writeFileSafe } from "./workspace.js";
import { execute } from "./adapters/index.js";
import { workingDiff, gitInfo, createBranch, checkoutBranch, commitAll, push, ship } from "./git.js";
import { run as runCmd, cancelRun, getDevServer, peekDevServer } from "./runner.js";
import { runAgent, cancelAgent } from "./agent.js";
import type { ClientMsg, ServerMsg, User, Presence, WorkspaceMsg } from "./types.js";

interface Conn {
  ws: WebSocket;
  roomId: string;
  user: User;
  alive: boolean;
}

const PALETTE = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c"];
const rooms = new Map<string, Set<Conn>>();
const subscribed = new Set<string>();

function broadcast(room: string, msg: ServerMsg | WorkspaceMsg): void {
  const conns = rooms.get(room);
  if (!conns) return;
  const data = JSON.stringify(msg);
  for (const c of conns) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

const intake = new Intake(broadcast);

// Presence fan-out via Redis Pub/Sub: when any presence event lands, push the
// current snapshot to all local sockets in that room.
sub.on("message", async (channel: string) => {
  const m = channel.match(/^room:(.+):presence$/);
  if (!m) return;
  const room = m[1];
  const presence = await getPresence(room);
  broadcast(room, { type: "presence", presence });
});

async function ensureSubscribed(room: string): Promise<void> {
  if (subscribed.has(room)) return;
  subscribed.add(room);
  await sub.subscribe(keys.presenceChannel(room));
}

function pickColor(room: string): string {
  const taken = new Set(Array.from(rooms.get(room) ?? []).map((c) => c.user.color));
  return PALETTE.find((c) => !taken.has(c)) ?? PALETTE[(rooms.get(room)?.size ?? 0) % PALETTE.length];
}

async function handleMessage(conn: Conn, raw: string): Promise<void> {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case "join": {
      const room = msg.roomId || "demo";
      const session = await getSession(room);
      if (session) {
        await touchSession(room); // real workspace session — don't seed demo files
      } else {
        await ensureSeed(room);
      }
      await ensureSubscribed(room);
      conn.roomId = room;
      conn.user = {
        id: nanoid(8),
        name: msg.user.name || "anon",
        color: msg.user.color || pickColor(room),
        model: msg.user.model || "claude",
      };
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(conn);
      await upsertUser(room, conn.user);

      const files = await getFiles(room);
      const firstFile = Object.keys(files)[0] ?? null;
      const presence: Presence = {
        userId: conn.user.id,
        name: conn.user.name,
        color: conn.user.color,
        state: "viewing",
        file: firstFile,
        ts: Date.now(),
      };
      await setPresence(room, presence); // publishes → fans out to everyone

      const state: ServerMsg = {
        type: "room_state",
        roomId: room,
        you: conn.user,
        files,
        users: await getUsers(room),
        presence: await getPresence(room),
      };
      conn.ws.send(JSON.stringify(state));
      break;
    }

    case "presence": {
      if (!conn.roomId) break;
      conn.alive = true;
      await setPresence(conn.roomId, {
        userId: conn.user.id,
        name: conn.user.name,
        color: conn.user.color,
        state: msg.state,
        file: msg.file,
        cursor: msg.cursor,
        ts: Date.now(),
      });
      break;
    }

    case "set_model": {
      if (!conn.roomId) break;
      conn.user.model = msg.model;
      await upsertUser(conn.roomId, conn.user);
      broadcast(conn.roomId, { type: "presence", presence: await getPresence(conn.roomId) });
      // refresh roster on clients via a fresh room_state-lite (users only)
      broadcast(conn.roomId, {
        type: "room_state",
        roomId: conn.roomId,
        you: conn.user,
        files: await getFiles(conn.roomId),
        users: await getUsers(conn.roomId),
        presence: await getPresence(conn.roomId),
      });
      break;
    }

    case "submit_prompt": {
      if (!conn.roomId) break;
      await intake.submit({
        id: nanoid(10),
        roomId: conn.roomId,
        userId: conn.user.id,
        userName: conn.user.name,
        userColor: conn.user.color,
        model: msg.model || conn.user.model,
        text: msg.text,
        ts: Date.now(),
      });
      break;
    }

    case "resolve_conflict": {
      if (!conn.roomId) break;
      const resolved = await resolveConflict(conn.roomId, msg.resolutionId, msg.strategy);
      if (resolved) {
        broadcast(conn.roomId, { type: "resolution", resolution: resolved });
        for (const [file, content] of Object.entries(resolved.appliedFiles)) {
          broadcast(conn.roomId, { type: "file_update", file, content });
        }
      }
      break;
    }

    case "run": {
      if (!conn.roomId) break;
      const session = await getSession(conn.roomId);
      if (!session) break;
      runCmd(session.root, msg.cmd, msg.label ?? "run", (event) =>
        broadcast(conn.roomId, { type: "run_event", event })
      );
      // a run usually changes files / git state → push a fresh diff shortly after
      break;
    }

    case "run_cancel": {
      cancelRun(msg.runId);
      break;
    }

    case "dev_start": {
      if (!conn.roomId) break;
      const session = await getSession(conn.roomId);
      if (!session) break;
      const ds = getDevServer(
        conn.roomId,
        session.root,
        session.devCmd,
        (status) => broadcast(conn.roomId, { type: "dev_status", status }),
        (event) => broadcast(conn.roomId, { type: "run_event", event })
      );
      ds.start();
      broadcast(conn.roomId, { type: "dev_status", status: ds.getStatus() });
      break;
    }

    case "dev_stop": {
      if (!conn.roomId) break;
      const ds = peekDevServer(conn.roomId);
      if (ds) ds.stop();
      break;
    }

    case "agent": {
      if (!conn.roomId) break;
      const session = await getSession(conn.roomId);
      if (!session) break;
      // fire-and-stream; events fan out to everyone in the session
      void runAgent(conn.roomId, session.root, msg.prompt, (event) =>
        broadcast(conn.roomId, { type: "agent_event", event })
      );
      break;
    }

    case "agent_cancel": {
      if (!conn.roomId) break;
      cancelAgent(conn.roomId);
      break;
    }
  }
}

async function main() {
  initTracing();
  const ok = await waitForRedis();
  if (!ok) {
    console.error("[fatal] Redis not reachable at startup. Run: docker compose up -d redis");
    process.exit(1);
  }
  console.log("[redis] connected");

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.get("/health", (_req, res) => res.json({ ok: true, rooms: [...rooms.keys()] }));
  app.get("/rooms/:room/files", async (req, res) => res.json(await getFiles(req.params.room)));

  // ---- Sessions (the dashboard "documents") ----
  app.get("/api/sessions", async (_req, res) => res.json(await listSessions()));
  app.post("/api/sessions", async (req, res) => {
    try {
      const s = await createSession(req.body ?? {});
      res.json(s);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });
  app.get("/api/sessions/:id", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    res.json(s);
  });
  app.delete("/api/sessions/:id", async (req, res) => {
    await deleteSession(req.params.id);
    res.json({ ok: true });
  });

  // ---- Workspace files (real codebase on disk) ----
  app.get("/api/sessions/:id/tree", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    try {
      res.json(await readTree(s.root));
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });
  app.get("/api/sessions/:id/file", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    try {
      res.json({ path: req.query.path, content: await readFileSafe(s.root, String(req.query.path ?? "")) });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });
  app.post("/api/sessions/:id/file", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    try {
      await writeFileSafe(s.root, req.body.path, req.body.content ?? "");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });
  app.get("/api/sessions/:id/diff", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    try {
      res.json({ files: await workingDiff(s.root) });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });
  app.get("/api/sessions/:id/dev", async (req, res) => {
    const ds = peekDevServer(req.params.id);
    res.json(ds ? ds.getStatus() : { state: "stopped", url: null, pid: null });
  });

  // ---- AI edit a real file on disk (the change you then ship) ----
  app.post("/api/sessions/:id/ai-edit", async (req, res) => {
    const s = await getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const { path, prompt, model } = req.body ?? {};
    if (!path || !prompt) return res.status(400).json({ error: "path and prompt required" });
    try {
      const before = await readFileSafe(s.root, path);
      const result = await execute(
        { prompt, file: path, before, symbol: null, model: model ?? "claude" },
        nanoid(8)
      );
      if (result.ok) await writeFileSafe(s.root, path, result.newContent);
      res.json({
        ok: result.ok,
        path,
        before,
        after: result.newContent,
        summary: result.summary,
        model: result.model,
        error: result.error,
      });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  // ---- Git ops: branch / commit / push (agentically ship changes) ----
  const withSession = async (req: any, res: any): Promise<string | null> => {
    const s = await getSession(req.params.id);
    if (!s) {
      res.status(404).json({ error: "not found" });
      return null;
    }
    return s.root;
  };
  app.get("/api/sessions/:id/git", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    res.json(await gitInfo(root));
  });
  app.post("/api/sessions/:id/git/branch", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    res.json(await createBranch(root, req.body.name, req.body.from));
  });
  app.post("/api/sessions/:id/git/checkout", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    res.json(await checkoutBranch(root, req.body.name));
  });
  app.post("/api/sessions/:id/git/commit", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    res.json(await commitAll(root, req.body.message ?? "vibedocs: update"));
  });
  app.post("/api/sessions/:id/git/push", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    res.json(await push(root, req.body ?? {}));
  });
  // One-shot "ship to branch": branch + commit + push.
  app.post("/api/sessions/:id/git/ship", async (req, res) => {
    const root = await withSession(req, res);
    if (!root) return;
    const result = await ship(root, {
      branch: req.body.branch,
      message: req.body.message ?? "vibedocs: ship changes",
      newBranch: req.body.newBranch ?? false,
      push: req.body.push ?? true,
    });
    res.json(result);
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const conn: Conn = { ws, roomId: "", user: {} as User, alive: true };
    ws.on("message", (data) => void handleMessage(conn, data.toString()));
    ws.on("pong", () => (conn.alive = true));
    ws.on("close", async () => {
      if (conn.roomId && conn.user?.id) {
        rooms.get(conn.roomId)?.delete(conn);
        await removeUser(conn.roomId, conn.user.id);
        await clearPresence(conn.roomId, conn.user.id); // publishes → fans out
      }
    });
    ws.on("error", () => {});
  });

  // ghost reaping: ping every 12s, drop unresponsive sockets
  setInterval(() => {
    for (const conns of rooms.values()) {
      for (const c of conns) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {}
      }
    }
  }, 12000);

  server.listen(PORT, () => {
    console.log(`[server] VibeDocs AI on http://localhost:${PORT}  (ws: ws://localhost:${PORT}/ws)`);
  });
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
