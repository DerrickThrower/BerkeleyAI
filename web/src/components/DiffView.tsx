import { lineDiff, diffStat } from "../diff";

interface DiffViewProps {
  before: string;
  after: string;
  /** Header accent color (a user's color, or neutral gray for merged). */
  accent: string;
}

export function DiffView({ before, after, accent }: DiffViewProps) {
  const rows = lineDiff(before, after);
  const { added, removed } = diffStat(rows);

  return (
    <div className="diff-view">
      <div className="diff-stat">
        <span className="stat-add">+{added}</span>
        <span className="stat-del">-{removed}</span>
      </div>
      <pre className="diff-body" style={{ borderColor: accent }}>
        {rows.map((r, i) => (
          <div key={i} className={`diff-row diff-${r.op}`}>
            <span className="diff-gutter">
              {r.op === "add" ? "+" : r.op === "del" ? "-" : " "}
            </span>
            <span className="diff-text">{r.text || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
