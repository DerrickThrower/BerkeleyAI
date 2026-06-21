// Session registry — the "documents" in the dashboard. Each session points at a
// real project directory on disk; its id doubles as the collaboration room id.
// Metadata lives in Redis so the dashboard survives restarts.

import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { nanoid } from "nanoid";
import { redis } from "./redis.js";
import { keys } from "./config.js";
import { isGitRepo } from "./git.js";
import type { Session } from "./types.js";

export function expandPath(p: string): string {
  let out = p.trim();
  if (out.startsWith("~")) out = out.replace(/^~(?=$|\/)/, homedir());
  return resolve(out);
}

export async function listSessions(): Promise<Session[]> {
  const ids = await redis.smembers(keys.sessionsSet());
  const sessions = await Promise.all(ids.map((id) => getSession(id)));
  return sessions
    .filter((s): s is Session => !!s)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getSession(id: string): Promise<Session | null> {
  const raw = await redis.hget(keys.sessionHash(id), "data");
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function createSession(input: {
  name: string;
  root: string;
  devCmd?: string;
  testCmd?: string;
}): Promise<Session> {
  const root = expandPath(input.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const session: Session = {
    id: nanoid(8),
    name: input.name?.trim() || root.split("/").pop() || "session",
    root,
    devCmd: input.devCmd?.trim() || (await guessDevCmd(root)),
    testCmd: input.testCmd?.trim() || (await guessTestCmd(root)),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    git: isGitRepo(root),
  };
  await saveSession(session);
  await redis.sadd(keys.sessionsSet(), session.id);
  return session;
}

export async function saveSession(s: Session): Promise<void> {
  await redis.hset(keys.sessionHash(s.id), "data", JSON.stringify(s));
}

export async function touchSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s) return;
  s.lastOpenedAt = Date.now();
  await saveSession(s);
}

export async function deleteSession(id: string): Promise<void> {
  await redis.srem(keys.sessionsSet(), id);
  await redis.del(keys.sessionHash(id));
}

// Best-effort command guesses from the project manifest.
async function guessDevCmd(root: string): Promise<string> {
  const pkg = readPkg(root);
  if (pkg?.scripts?.dev) return "npm run dev";
  if (pkg?.scripts?.start) return "npm start";
  if (existsSync(resolve(root, "manage.py"))) return "python manage.py runserver";
  if (existsSync(resolve(root, "index.html"))) return "npx serve -l 5050 .";
  return "npm run dev";
}
async function guessTestCmd(root: string): Promise<string> {
  const pkg = readPkg(root);
  if (pkg?.scripts?.test) return "npm test";
  if (existsSync(resolve(root, "pytest.ini")) || existsSync(resolve(root, "tests"))) return "pytest";
  return "npm test";
}
function readPkg(root: string): any | null {
  try {
    const p = resolve(root, "package.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
