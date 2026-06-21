import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./workspace-types";
import { NewSessionModal } from "./components/NewSessionModal";

function relativeTime(ts: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function openSession(id: string): void {
  window.location.search = "?session=" + encodeURIComponent(id);
}

export function Dashboard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const list = await api.listSessions();
      list.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
      setSessions(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSessions([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string) => {
    try {
      await api.deleteSession(id);
      setPendingDelete(null);
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="join-logo" style={{ background: "var(--accent)" }} />
          <h1>VibeDocs AI</h1>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          + New session
        </button>
      </header>

      <div className="dash-body">
        {error && (
          <div className="ws-error dash-error">
            {error}
            <button className="ws-btn-sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {sessions === null && <div className="dash-loading">Loading sessions…</div>}

        {sessions !== null && sessions.length === 0 && !error && (
          <div className="dash-empty">
            <h2>No sessions yet</h2>
            <p className="ws-dim">
              A session is a real codebase on your disk. Create one to open it in the
              workspace.
            </p>
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              + New session
            </button>
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <div className="dash-grid">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="dash-card"
                onClick={() => openSession(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openSession(s.id);
                }}
              >
                <div className="dash-card-top">
                  <div className="dash-card-name">{s.name}</div>
                  <div className="dash-card-menu">
                    {pendingDelete === s.id ? (
                      <span className="dash-confirm" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="ws-btn-sm ws-fail"
                          onClick={() => void remove(s.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="ws-btn-sm"
                          onClick={() => setPendingDelete(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="dash-dots"
                        title="Delete session"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(s.id);
                        }}
                      >
                        ⋯
                      </button>
                    )}
                  </div>
                </div>
                <div className="dash-card-root" title={s.root}>
                  {s.root}
                </div>
                <div className="dash-card-foot">
                  <span className="ws-dim">{relativeTime(s.lastOpenedAt)}</span>
                  {s.git && <span className="dash-git-badge">git</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewSessionModal
          onClose={() => setShowNew(false)}
          onCreated={(s) => openSession(s.id)}
        />
      )}
    </div>
  );
}
