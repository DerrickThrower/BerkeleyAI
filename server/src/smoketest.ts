// End-to-end validation: two simulated clients prompt the same room
// simultaneously. Exercises case 2 (compatible merge), case 3 (surfaced
// conflict), and case-3 resolution via sequencing. Run with the server up.
import WebSocket from "ws";
import { reseed } from "./seed.js";
import { redis, waitForRedis } from "./redis.js";

const URL = "ws://localhost:8787/ws";
type Any = any;

function client(name: string, model: string) {
  const ws = new WebSocket(URL);
  const inbox: Any[] = [];
  const waiters: { pred: (m: Any) => boolean; resolve: (m: Any) => void }[] = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) {
        waiters[i].resolve(m);
        waiters.splice(i, 1);
      }
    }
  });
  const api = {
    ws,
    ready: new Promise<void>((res) => ws.on("open", () => res())),
    send: (m: Any) => ws.send(JSON.stringify(m)),
    wait: (pred: (m: Any) => boolean, ms = 45000) =>
      new Promise<Any>((resolve, reject) => {
        const hit = inbox.find(pred);
        if (hit) return resolve(hit);
        const t = setTimeout(() => reject(new Error(`${name}: timeout waiting`)), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      }),
    join: (room: string) => api.send({ type: "join", roomId: room, user: { name, color: "", model } }),
    submit: (text: string) => api.send({ type: "submit_prompt", text, model }),
  };
  return api;
}

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  await waitForRedis();
  const ROOM = "smoke";

  // ---------- CASE 2 ----------
  await reseed(ROOM);
  let maria = client("Maria", "claude");
  let sam = client("Sam", "gpt");
  await Promise.all([maria.ready, sam.ready]);
  maria.join(ROOM);
  sam.join(ROOM);
  const rs = await maria.wait((m) => m.type === "room_state");
  check("room_state delivered with self identity", !!rs.you?.id, `you=${rs.you?.name}`);
  check("presence shows both users", (await sam.wait((m) => m.type === "presence" && m.presence.length >= 2)).presence.length >= 2);

  maria.submit("add input validation to create_user in api.py");
  sam.submit("add structured logging to delete_user in api.py");

  const arb2 = await maria.wait((m) => m.type === "arbitrating");
  check("case 2 classified as case 2", arb2.arbCase === 2, `arbCase=${arb2.arbCase}`);
  const res2 = await maria.wait((m) => m.type === "resolution");
  const r2 = res2.resolution;
  check("case 2 type is case2_merged", r2.type === "case2_merged", r2.type);
  const merged = Object.values(r2.appliedFiles)[0] as string;
  // wording-agnostic: live models phrase edits differently than the mock.
  const validationPresent = /raise|valueerror|valid|isinstance|required|assert/i.test(merged);
  const loggingPresent = /logging|logger|log\.|log\(/i.test(merged);
  check("merged file keeps BOTH intents (validation + logging)", validationPresent && loggingPresent,
    `validation=${validationPresent} logging=${loggingPresent}`);
  check("case 2 has 2 proposals for side-by-side view", r2.proposals.length === 2);
  maria.ws.close(); sam.ws.close();

  // ---------- CASE 3 ----------
  await reseed(ROOM);
  maria = client("Maria", "claude");
  sam = client("Sam", "gpt");
  await Promise.all([maria.ready, sam.ready]);
  maria.join(ROOM); sam.join(ROOM);
  await maria.wait((m) => m.type === "room_state");

  maria.submit("make get_user in api.py return JSON");
  sam.submit("make get_user in api.py return XML");

  const arb3 = await maria.wait((m) => m.type === "arbitrating");
  check("case 3 classified as case 3", arb3.arbCase === 3, `arbCase=${arb3.arbCase}`);
  const res3 = await maria.wait((m) => m.type === "resolution");
  const r3 = res3.resolution;
  check("case 3 type is case3_conflict", r3.type === "case3_conflict", r3.type);
  check("case 3 applies NOTHING (no silent winner)", Object.keys(r3.appliedFiles).length === 0);
  check("case 3 surfaces BOTH asks (nothing dropped)", r3.conflict?.asks?.length === 2);

  // resolve by sequencing
  maria.send({ type: "resolve_conflict", resolutionId: r3.id, strategy: "sequence" });
  const resolved = await maria.wait((m) => m.type === "resolution" && m.resolution.type === "case3_sequenced");
  check("conflict resolvable via sequencing", resolved.resolution.type === "case3_sequenced",
    Object.values(resolved.resolution.appliedFiles)[0] ? "applied" : "none");
  maria.ws.close(); sam.ws.close();

  // ---------- ledger (Redis Streams) ----------
  const len = await redis.xlen(`prompts:${ROOM}`);
  check("Redis Stream ledger recorded all prompts", len >= 4, `xlen=${len}`);

  console.log(`\n${failures === 0 ? "🎉 ALL CHECKS PASSED" : `⚠️ ${failures} CHECK(S) FAILED`}`);
  await redis.quit();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
