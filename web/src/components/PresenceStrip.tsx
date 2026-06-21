import { useState } from "react";
import type { Presence } from "../types";
import type { WsStatus } from "../ws";
import { inviteLink as buildInviteLink } from "../session";

interface PresenceStripProps {
  presence: Presence[];
  selfId: string | null;
  status: WsStatus;
  room: string;
}

const STATE_LABEL: Record<Presence["state"], string> = {
  idle: "idle",
  typing: "typing",
  prompting: "prompting",
  viewing: "viewing",
};

export function PresenceStrip({
  presence,
  selfId,
  status,
  room,
}: PresenceStripProps) {
  const [copied, setCopied] = useState(false);
  const inviteLink = buildInviteLink(room);
  const invite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      /* clipboard may be blocked; the link is still shown below */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="presence-strip">
      <div className="presence-chips">
        {presence.length === 0 && (
          <span className="presence-empty">no one here yet…</span>
        )}
        {presence.map((p) => {
          const isSelf = p.userId === selfId;
          return (
            <div
              key={p.userId}
              className={`chip${isSelf ? " chip-self" : ""}`}
              style={{ borderColor: p.color }}
            >
              <span className="dot" style={{ background: p.color }} />
              <span className="chip-name" style={{ color: p.color }}>
                {p.name}
                {isSelf ? " (you)" : ""}
              </span>
              {p.file && (
                <span className="chip-file">editing {p.file}</span>
              )}
              <span className={`badge badge-${p.state}`}>
                {STATE_LABEL[p.state]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="presence-right">
        <button
          type="button"
          className="invite-btn"
          onClick={invite}
          title={inviteLink}
        >
          {copied ? "✓ link copied" : `⧉ invite · ${room}`}
        </button>
        <div className={`conn conn-${status}`}>
          <span className="conn-dot" />
          {status === "open"
            ? "connected"
            : status === "connecting"
            ? "connecting…"
            : "reconnecting…"}
        </div>
      </div>
    </div>
  );
}
