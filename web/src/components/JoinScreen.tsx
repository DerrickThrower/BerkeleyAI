import { useMemo, useState } from "react";
import type { ModelChoice } from "../types";
import { genRoomCode, inviteLink as buildInviteLink } from "../session";

interface JoinScreenProps {
  initialName: string;
  initialModel: ModelChoice;
  invitedRoom: string | null; // present when arriving via an invite link
  color: string;
  onJoin: (name: string, model: ModelChoice, room: string) => void;
}

const MODELS: { value: ModelChoice; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "gpt", label: "GPT" },
  { value: "mock", label: "Mock" },
];

export function JoinScreen({
  initialName,
  initialModel,
  invitedRoom,
  color,
  onJoin,
}: JoinScreenProps) {
  const [name, setName] = useState(initialName);
  const [model, setModel] = useState<ModelChoice>(initialModel);

  // "start" = host a fresh session; "join" = enter an existing code.
  const [mode, setMode] = useState<"start" | "join">("start");
  const [newCode, setNewCode] = useState(() => genRoomCode());
  const [joinCode, setJoinCode] = useState("");

  const invited = !!invitedRoom;
  const resolvedRoom = invited
    ? invitedRoom!
    : mode === "start"
    ? newCode
    : joinCode.trim().toLowerCase();

  const canSubmit = name.trim().length > 0 && resolvedRoom.length > 0;
  const ctaLabel = invited || mode === "join" ? "Join session" : "Start session";

  const inviteLink = useMemo(() => buildInviteLink(resolvedRoom), [resolvedRoom]);
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onJoin(name.trim(), model, resolvedRoom);
  };

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={submit}>
        <div className="join-brand">
          <span className="join-logo" style={{ background: color }} />
          <h1>VibeDocs AI</h1>
        </div>
        <p className="join-tagline">
          Google Docs for vibecoding — one shared codebase, many prompts at once.
        </p>

        <label className="field">
          <span>Your name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Maria"
          />
        </label>

        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value as ModelChoice)}>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {/* ---- Session block ---- */}
        {invited ? (
          <div className="session-invited">
            <span className="session-invited-label">You're invited to session</span>
            <span className="session-code">{invitedRoom}</span>
          </div>
        ) : (
          <div className="session-block">
            <div className="seg">
              <button
                type="button"
                className={`seg-btn${mode === "start" ? " seg-on" : ""}`}
                onClick={() => setMode("start")}
              >
                Start new session
              </button>
              <button
                type="button"
                className={`seg-btn${mode === "join" ? " seg-on" : ""}`}
                onClick={() => setMode("join")}
              >
                Join with a code
              </button>
            </div>

            {mode === "start" ? (
              <div className="session-new">
                <div className="session-new-row">
                  <span className="field-sub">Session code</span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setNewCode(genRoomCode())}
                  >
                    ↻ new code
                  </button>
                </div>
                <div className="session-code-row">
                  <span className="session-code">{newCode}</span>
                  <button type="button" className="copy-btn" onClick={copyLink}>
                    {copied ? "✓ copied" : "copy invite link"}
                  </button>
                </div>
                <p className="field-hint">
                  Share the invite link — anyone who opens it joins this same live codebase.
                </p>
              </div>
            ) : (
              <label className="field">
                <span>Invite code</span>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="e.g. k7mp2x"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
            )}
          </div>
        )}

        <div className="join-meta">
          <span className="join-color">
            color
            <span className="dot" style={{ background: color }} />
          </span>
        </div>

        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {ctaLabel}
        </button>
      </form>
    </div>
  );
}
