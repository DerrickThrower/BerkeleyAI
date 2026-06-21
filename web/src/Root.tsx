// URL-driven top-level router (no react-router needed).
//   ?session=<id> → Workspace (real codebase)
//   ?room=<id>    → legacy collaborative demo (App.tsx, untouched)
//   otherwise     → Dashboard (default landing)

import App from "./App";
import { Dashboard } from "./Dashboard";
import { Workspace } from "./Workspace";

export default function Root() {
  const q = new URLSearchParams(window.location.search);
  const session = q.get("session");
  const room = q.get("room");

  if (session) return <Workspace sessionId={session} />;
  if (room) return <App />;
  return <Dashboard />;
}
