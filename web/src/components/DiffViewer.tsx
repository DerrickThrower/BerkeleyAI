import { useState } from "react";
import type { DiffFile } from "../workspace-types";

interface DiffViewerProps {
  files: DiffFile[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function DiffViewer({ files, loading, error, onRefresh }: DiffViewerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = files.find((f) => f.path === selected) ?? files[0] ?? null;

  return (
    <div className="ws-diff">
      <div className="ws-pane-toolbar">
        <span className="ws-pane-title">
          {files.length} changed file{files.length === 1 ? "" : "s"}
        </span>
        <button className="ws-btn-sm" onClick={onRefresh} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div className="ws-error">{error}</div>}

      {!error && !loading && files.length === 0 && (
        <div className="ws-empty-pane">No changes. Working tree is clean.</div>
      )}

      {files.length > 0 && (
        <div className="ws-diff-body">
          <div className="ws-diff-files">
            {files.map((f) => (
              <button
                key={f.path}
                className={`ws-diff-file${active?.path === f.path ? " ws-diff-file-active" : ""}`}
                onClick={() => setSelected(f.path)}
                title={f.path}
              >
                <span className={`ws-diff-status ws-status-${f.status}`}>
                  {STATUS_LABEL[f.status]}
                </span>
                <span className="ws-diff-path">{f.path}</span>
                <span className="ws-diff-counts">
                  <span className="stat-add">+{f.additions}</span>{" "}
                  <span className="stat-del">−{f.deletions}</span>
                </span>
              </button>
            ))}
          </div>
          {active && <UnifiedPatch patch={active.patch} />}
        </div>
      )}
    </div>
  );
}

function UnifiedPatch({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="ws-patch">
      {lines.map((line, i) => {
        let cls = "diff-same";
        if (line.startsWith("@@")) cls = "ws-patch-hunk";
        else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff "))
          cls = "ws-patch-meta";
        else if (line.startsWith("+")) cls = "diff-add";
        else if (line.startsWith("-")) cls = "diff-del";
        return (
          <div key={i} className={`ws-patch-row ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
