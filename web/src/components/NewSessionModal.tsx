import { useState } from "react";
import { api, ApiError } from "../api";
import type { Session } from "../workspace-types";

interface NewSessionModalProps {
  onClose: () => void;
  onCreated: (session: Session) => void;
}

export function NewSessionModal({ onClose, onCreated }: NewSessionModalProps) {
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [devCmd, setDevCmd] = useState("");
  const [testCmd, setTestCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!root.trim()) {
      setError("A project root path is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await api.createSession({
        name: name.trim() || root.trim(),
        root: root.trim(),
        devCmd: devCmd.trim() || undefined,
        testCmd: testCmd.trim() || undefined,
      });
      onCreated(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ws-ship-head">
          <h2>New session</h2>
          <button className="ws-btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            className="ws-input"
            placeholder="My project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Project root</span>
          <input
            className="ws-input ws-mono"
            placeholder="~/path/to/project"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>

        <label className="field">
          <span>Dev command (optional)</span>
          <input
            className="ws-input ws-mono"
            placeholder="npm run dev"
            value={devCmd}
            onChange={(e) => setDevCmd(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Test command (optional)</span>
          <input
            className="ws-input ws-mono"
            placeholder="npm test"
            value={testCmd}
            onChange={(e) => setTestCmd(e.target.value)}
          />
        </label>

        {error && <div className="ws-error">{error}</div>}

        <div className="ws-ship-footer">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create session"}
          </button>
        </div>
      </div>
    </div>
  );
}
