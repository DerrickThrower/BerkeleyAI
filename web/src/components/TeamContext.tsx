// ============================================================================
// TEAM CONTEXT — the shared awareness bar for a real coding session.
//
// Shows, for every teammate: what they're about to prompt (live draft) and what
// their agent is actively building (prompt + files it's touching + the plan it
// reported back). When you fire your own prompt, your agent reads exactly this
// and coordinates around it before editing — so nobody clobbers anyone.
// ============================================================================
import type { Presence, IntentItem, ActiveRunView } from "../types";

interface TeamContextProps {
  presence: Presence[];
  intents: IntentItem[]; // live drafts ("about to prompt")
  runs: ActiveRunView[]; // agents currently building
  selfId: string | null;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function TeamContext({ presence, intents, runs, selfId }: TeamContextProps) {
  const others = presence.filter((p) => p.userId !== selfId);
  const runBy = new Map(runs.filter((r) => r.userId !== selfId).map((r) => [r.userId, r]));
  const draftBy = new Map(intents.filter((d) => d.userId !== selfId).map((d) => [d.userId, d]));

  const anyActivity = runBy.size > 0 || draftBy.size > 0;

  return (
    <div className={"team-ctx" + (runBy.size ? " team-ctx-live" : "")}>
      <div className="team-ctx-head">
        <span className="team-ctx-title">👥 Shared session</span>
        <span className="team-ctx-sub">
          your agent reads this and coordinates before it builds
        </span>
      </div>

      <div className="team-ctx-cards">
        {others.length === 0 && (
          <span className="team-ctx-empty">
            You’re solo — share the session link to vibecode together.
          </span>
        )}

        {others.map((p) => {
          const run = runBy.get(p.userId);
          const draft = draftBy.get(p.userId);
          return (
            <div
              key={p.userId}
              className={"team-card" + (run ? " building" : draft ? " composing" : "")}
              style={{ borderColor: p.color }}
            >
              <div className="team-card-who">
                <span className="team-chip" style={{ background: p.color }}>
                  {initials(p.name)}
                </span>
                <span className="team-name">{p.name}</span>
                <span className="team-state">
                  {run ? "🤖 building" : draft ? "✎ composing" : "viewing"}
                </span>
              </div>

              {run ? (
                <>
                  <div className="team-prompt">“{run.prompt}”</div>
                  {run.plan && <div className="team-plan">↳ {run.plan}</div>}
                  {run.files.length > 0 && (
                    <div className="team-files">
                      {run.files.map((f) => (
                        <span key={f} className="team-file" title={f}>
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : draft ? (
                <div className="team-prompt draft">“{draft.text}”</div>
              ) : (
                p.file && <div className="team-viewing">viewing {p.file}</div>
              )}
            </div>
          );
        })}
      </div>

      {!anyActivity && others.length > 0 && (
        <span className="team-ctx-idle">everyone’s idle</span>
      )}
    </div>
  );
}
