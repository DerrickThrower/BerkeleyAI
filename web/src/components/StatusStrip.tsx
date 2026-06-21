import type { ArbCase } from "../types";

interface StatusStripProps {
  queueDepth: number;
  arbitrating: boolean;
  arbCase: ArbCase | null;
}

const CASE_LABEL: Record<ArbCase, string> = {
  1: "parallel",
  2: "compatible-merge",
  3: "conflict",
};

export function StatusStrip({
  queueDepth,
  arbitrating,
  arbCase,
}: StatusStripProps) {
  return (
    <div className="status-strip">
      <span className="status-seg">
        prompts-in-flight: <b>{queueDepth}</b> queued
      </span>
      <span className="status-dot">·</span>
      <span className={`status-seg ${arbitrating ? "status-active" : ""}`}>
        {arbitrating ? "arbitrating" : "idle"}
      </span>
      {arbitrating && arbCase != null && (
        <>
          <span className="status-dot">·</span>
          <span className={`status-case status-case-${arbCase}`}>
            case {arbCase} / {CASE_LABEL[arbCase]}
          </span>
        </>
      )}
    </div>
  );
}
