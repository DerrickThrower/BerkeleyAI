// Seed the demo "codebase" into Redis. The function bodies are shaped so the
// seeded scenarios resolve deterministically even with no API keys (mock mode):
//
//   CASE 2 (compatible): "add validation to create_user" + "add logging to
//           delete_user" — same file (api.py), different symbols → one merge.
//   CASE 3 (conflict):   "make get_user return JSON" + "make get_user return
//           XML" — same symbol, contradictory → surfaced, nothing dropped.
//   CASE 1 (parallel):   anything touching auth.py vs routes.py.

import { redis, getFiles, setFiles, waitForRedis } from "./redis.js";

export const DEMO_FILES: Record<string, string> = {
  "api.py": `from flask import jsonify, Response, request

logger = get_logger(__name__)


def create_user(payload):
    """Create a new user from the request payload."""
    user_id = db.insert("users", payload)
    return {"id": user_id}


def delete_user(user_id):
    """Delete a user by id."""
    db.delete("users", user_id)
    return {"deleted": user_id}


def get_user(user_id):
    """Fetch a single user by id."""
    user = db.find("users", user_id)
    return user
`,

  "auth.py": `import jwt

SECRET = load_secret()


def require_auth(request):
    """Reject the request if it carries no valid token."""
    token = request.headers.get("Authorization")
    return verify(token)


def verify(token):
    """Verify a bearer token."""
    return jwt.decode(token, SECRET, algorithms=["HS256"])
`,

  "routes.py": `from api import create_user, delete_user, get_user


def register_routes(app):
    """Wire HTTP routes to their handlers."""
    app.post("/users", create_user)
    app.delete("/users/<user_id>", delete_user)
    app.get("/users/<user_id>", get_user)
`,
};

// Seed only if the room has no files yet (don't clobber a live demo room).
export async function ensureSeed(room: string): Promise<void> {
  const existing = await getFiles(room);
  if (Object.keys(existing).length > 0) return;
  await setFiles(room, DEMO_FILES);
  console.log(`[seed] seeded room "${room}" with ${Object.keys(DEMO_FILES).length} files`);
}

// Force (re)seed — used by `npm run seed`.
export async function reseed(room: string): Promise<void> {
  await setFiles(room, DEMO_FILES);
  console.log(`[seed] (re)seeded room "${room}"`);
}

// Standalone entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const room = process.argv[2] ?? "demo";
  (async () => {
    const ok = await waitForRedis();
    if (!ok) {
      console.error("Redis not reachable. Run: docker compose up -d redis");
      process.exit(1);
    }
    await reseed(room);
    await redis.quit();
    process.exit(0);
  })();
}
