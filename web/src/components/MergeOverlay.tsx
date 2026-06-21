import { useEffect, useState } from "react";
import type { Resolution } from "../types";
import { DiffView } from "./DiffView";

const NEUTRAL = "#8b949e";

interface MergeOverlayProps {
  resolution: Resolution;
  onResolveConflict: (
    strategy: "sequence" | "keep_a" | "keep_b"
  ) => void;
  onDismiss: () => void;
}

type Phase = "split" | "converged";

export function MergeOverlay({
  resolution,
  onResolveConflict,
  onDismiss,
}: MergeOverlayProps) {
  const isConflict = resolution.type === "case3_conflict";
  const [phase, setPhase] = useState<Phase>("split");

  // For mergeable resolutions, drive the converge animation after a beat.
  useEffect(() => {
    if (isConflict) return;
    const t = window.setTimeout(() => setPhase("converged"), 900);
    return () => window.clearTimeout(t);
  }, [isConflict, resolution.id]);

  if (isConflict) {
    return <ConflictPanel resolution={resolution} onResolveConflict={onResolveConflict} onDismiss={onDismiss} />;
  }

  const proposals = resolution.proposals;
  // The merged/applied file is the first proposal's file, resolved.
  const mergedFile = proposals[0]?.file ?? Object.keys(resolution.appliedFiles)[0];
  const mergedBefore = proposals[0]?.before ?? "";
  const mergedAfter = mergedFile ? resolution.appliedFiles[mergedFile] ?? "" : "";

  return (
    <div className="overlay-backdrop">
      <div className="merge-panel">
        <div className="merge-header">
          <span className="merge-title">
            Arbitration · {labelForType(resolution.type)}
          </span>
          <span className="merge-summary">{resolution.summary}</span>
        </div>

        <div className={`merge-stage stage-${phase}`}>
          {/* Split: each user's proposal in their color. */}
          <div className="merge-proposals">
            {proposals.map((p) => (
              <div className="proposal" key={p.promptId}>
                <div
                  className="proposal-head"
                  style={{ color: p.userColor, borderColor: p.userColor }}
                >
                  <span className="dot" style={{ background: p.userColor }} />
                  {p.userName}
                  <span className="proposal-model">{p.model}</span>
                </div>
                <div className="proposal-sum">{p.summary}</div>
                <DiffView before={p.before} after={p.after} accent={p.userColor} />
              </div>
            ))}
          </div>

          <div className="merge-arrow">→</div>

          {/* Converged: single neutral-gray resolved diff. */}
          <div className="merge-resolved">
            <div className="resolved-head" style={{ color: NEUTRAL, borderColor: NEUTRAL }}>
              <span className="dot" style={{ background: NEUTRAL }} />
              resolved · {mergedFile}
            </div>
            <DiffView before={mergedBefore} after={mergedAfter} accent={NEUTRAL} />
          </div>
        </div>

        <div className="merge-footer">
          <button className="btn-ghost" onClick={onDismiss}>
            {phase === "converged" ? "Apply & close" : "Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConflictPanel({
  resolution,
  onResolveConflict,
  onDismiss,
}: MergeOverlayProps) {
  const conflict = resolution.conflict;
  const asks = conflict?.asks ?? [];
  const nameA = asks[0]?.userName ?? "A";
  const nameB = asks[1]?.userName ?? "B";

  return (
    <div className="overlay-backdrop">
      <div className="conflict-panel">
        <div className="conflict-header">
          <span className="conflict-title">Conflict — both intents preserved</span>
          <span className="conflict-loc">
            {conflict?.file}
            {conflict?.symbol ? ` · ${conflict.symbol}` : ""}
          </span>
        </div>

        <div className="conflict-asks">
          {asks.map((a) => (
            <div
              key={a.promptId}
              className="conflict-ask"
              style={{ borderColor: a.userColor }}
            >
              <div
                className="conflict-ask-head"
                style={{ color: a.userColor }}
              >
                <span className="dot" style={{ background: a.userColor }} />
                {a.userName}
              </div>
              <div className="conflict-ask-text">{a.text}</div>
            </div>
          ))}
        </div>

        <div className="conflict-summary">{resolution.summary}</div>

        <div className="conflict-actions">
          <button
            className="btn-amber"
            onClick={() => {
              onResolveConflict("sequence");
              onDismiss();
            }}
          >
            Sequence them
          </button>
          <button
            className="btn-amber-ghost"
            onClick={() => {
              onResolveConflict("keep_a");
              onDismiss();
            }}
          >
            Keep {nameA}
          </button>
          <button
            className="btn-amber-ghost"
            onClick={() => {
              onResolveConflict("keep_b");
              onDismiss();
            }}
          >
            Keep {nameB}
          </button>
        </div>
      </div>
    </div>
  );
}

function labelForType(t: Resolution["type"]): string {
  switch (t) {
    case "case1_parallel":
      return "parallel — unrelated edits";
    case "case2_merged":
      return "compatible — merged into one diff";
    case "case3_sequenced":
      return "sequenced — re-contextualized";
    case "case3_conflict":
      return "conflict";
  }
}
