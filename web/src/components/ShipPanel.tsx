import { useState } from "react";
import { api, ApiError } from "../api";
import type { GitInfo, ShipResult } from "../workspace-types";

interface ShipPanelProps {
  sessionId: string;
  git: GitInfo | null;
  onClose: () => void;
  onShipped: () => void;
}

function defaultBranch(): string {
  const slug = new Date().toISOString().slice(5, 16).replace(/[:T]/g, "-");
  return `vibedocs/ship-${slug}`;
}

export function ShipPanel({ sessionId, git, onClose, onShipped }: ShipPanelProps) {
  const [branch, setBranch] = useState(defaultBranch());
  const [message, setMessage] = useState("vibedocs: ship changes");
  const [newBranch, setNewBranch] = useState(true);
  const [push, setPush] = useState(git?.hasRemote ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShipResult | null>(null);

  const ship = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.gitShip(sessionId, { branch, newBranch, message, push });
      setResult(r);
      onShipped();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="ws-ship-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ws-ship-head">
          <h2>Ship changes</h2>
          <button className="ws-btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {git && !git.isRepo && (
          <div className="ws-error">This session's root is not a git repository.</div>
        )}

        <label className="field">
          <span>Branch</span>
          <input
            className="ws-input ws-mono"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Commit message</span>
          <input
            className="ws-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>

        <div className="ws-ship-opts">
          <label className="ws-check">
            <input
              type="checkbox"
              checked={newBranch}
              onChange={(e) => setNewBranch(e.target.checked)}
            />
            Create new branch
          </label>
          <label className="ws-check">
            <input
              type="checkbox"
              checked={push}
              onChange={(e) => setPush(e.target.checked)}
            />
            Push to {git?.remote ?? "remote"}
          </label>
        </div>

        {error && <div className="ws-error">{error}</div>}

        {result && (
          <div className="ws-ship-steps">
            {result.steps.map((s, i) => (
              <div key={i} className="ws-ship-step">
                <span className={s.result.ok ? "ws-ok" : "ws-fail"}>
                  {s.result.ok ? "✓" : "✗"}
                </span>
                <span className="ws-ship-step-name">{s.step}</span>
                {(s.result.output || s.result.error) && (
                  <pre className="ws-ship-out">
                    {s.result.output}
                    {s.result.error ? `\n${s.result.error}` : ""}
                  </pre>
                )}
              </div>
            ))}
            <div className={result.ok ? "ws-ok" : "ws-fail"}>
              {result.ok ? "Shipped." : "Ship incomplete — see steps above."}
            </div>
          </div>
        )}

        <div className="ws-ship-footer">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn-primary"
            onClick={ship}
            disabled={busy || !branch.trim() || !message.trim()}
          >
            {busy ? "Shipping…" : "Ship"}
          </button>
        </div>
      </div>
    </div>
  );
}
