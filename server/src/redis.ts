// ============================================================================
// Redis layer — the single most load-bearing piece of infrastructure here.
// Without Redis two browser tabs can't even know about each other.
//
//   Pub/Sub  -> live presence + event broadcast across all connected clients
//   Streams  -> append-only ledger of every prompt + every resolution (replayable)
//   Hash     -> file contents, per-file locks/claims, room user roster
// ============================================================================

import Redis from "ioredis";
import { REDIS_URL, keys } from "./config.js";
import type { Presence, PromptRequest, Resolution, User } from "./types.js";

// Separate connections: ioredis requires a dedicated connection for subscribe.
export const redis = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
export const sub = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });

redis.on("error", (e) => console.error("[redis] error:", e.message));
sub.on("error", (e) => console.error("[redis:sub] error:", e.message));

export async function waitForRedis(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const pong = await redis.ping();
      if (pong === "PONG") return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Files (the shared codebase)
// ---------------------------------------------------------------------------
export async function getFiles(room: string): Promise<Record<string, string>> {
  return (await redis.hgetall(keys.filesHash(room))) ?? {};
}
export async function getFile(room: string, path: string): Promise<string | null> {
  return await redis.hget(keys.filesHash(room), path);
}
export async function setFile(room: string, path: string, content: string): Promise<void> {
  await redis.hset(keys.filesHash(room), path, content);
}
export async function setFiles(room: string, files: Record<string, string>): Promise<void> {
  if (Object.keys(files).length === 0) return;
  await redis.hset(keys.filesHash(room), files);
}

// ---------------------------------------------------------------------------
// Users roster
// ---------------------------------------------------------------------------
export async function upsertUser(room: string, user: User): Promise<void> {
  await redis.hset(keys.usersHash(room), user.id, JSON.stringify(user));
}
export async function removeUser(room: string, userId: string): Promise<void> {
  await redis.hdel(keys.usersHash(room), userId);
}
export async function getUsers(room: string): Promise<User[]> {
  const h = await redis.hgetall(keys.usersHash(room));
  return Object.values(h).map((v) => JSON.parse(v) as User);
}

// ---------------------------------------------------------------------------
// Presence (Pub/Sub + Hash for current snapshot)
// ---------------------------------------------------------------------------
export async function setPresence(room: string, p: Presence): Promise<void> {
  await redis.hset(keys.presenceHash(room), p.userId, JSON.stringify(p));
  await redis.publish(keys.presenceChannel(room), JSON.stringify(p));
}
export async function clearPresence(room: string, userId: string): Promise<void> {
  await redis.hdel(keys.presenceHash(room), userId);
  await redis.publish(keys.presenceChannel(room), JSON.stringify({ userId, _gone: true }));
}
export async function getPresence(room: string): Promise<Presence[]> {
  const h = await redis.hgetall(keys.presenceHash(room));
  return Object.values(h).map((v) => JSON.parse(v) as Presence);
}

// ---------------------------------------------------------------------------
// File locks / claims (case classification + safe concurrent writes)
// ---------------------------------------------------------------------------
export async function claimFile(room: string, file: string, userId: string): Promise<boolean> {
  // NX claim; returns true if we got it.
  const ok = await redis.hsetnx(keys.locksHash(room), file, userId);
  return ok === 1;
}
export async function releaseFile(room: string, file: string): Promise<void> {
  await redis.hdel(keys.locksHash(room), file);
}
export async function getLocks(room: string): Promise<Record<string, string>> {
  return (await redis.hgetall(keys.locksHash(room))) ?? {};
}

// ---------------------------------------------------------------------------
// Streams — append-only ledger
// ---------------------------------------------------------------------------
export async function appendPrompt(room: string, p: PromptRequest): Promise<string> {
  return await redis.xadd(keys.promptsStream(room), "*", "data", JSON.stringify(p)) as string;
}
export async function appendActivity(
  room: string,
  kind: string,
  payload: unknown
): Promise<string> {
  return (await redis.xadd(
    keys.activityStream(room),
    "*",
    "kind",
    kind,
    "data",
    JSON.stringify(payload)
  )) as string;
}
export async function readActivity(room: string, count = 100) {
  const entries = await redis.xrevrange(keys.activityStream(room), "+", "-", "COUNT", count);
  return entries.map(([id, fields]) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return { id, kind: obj.kind, data: obj.data ? JSON.parse(obj.data) : null };
  });
}

// ---------------------------------------------------------------------------
// Event broadcast (resolutions, arbitration state) — fan out to all clients
// ---------------------------------------------------------------------------
export async function publishEvent(room: string, msg: unknown): Promise<void> {
  await redis.publish(keys.eventsChannel(room), JSON.stringify(msg));
}
export async function recordResolution(room: string, r: Resolution): Promise<void> {
  await appendActivity(room, "resolution", r);
}
