import type { Presence } from "../types";

interface FileTabsProps {
  files: string[];
  active: string | null;
  presence: Presence[];
  selfId: string | null;
  onSelect: (file: string) => void;
}

export function FileTabs({
  files,
  active,
  presence,
  selfId,
  onSelect,
}: FileTabsProps) {
  return (
    <div className="file-tabs">
      {files.map((f) => {
        // Other users focused on this file → dot stack in their colors.
        const watchers = presence.filter(
          (p) => p.file === f && p.userId !== selfId
        );
        return (
          <button
            key={f}
            className={`tab${f === active ? " tab-active" : ""}`}
            onClick={() => onSelect(f)}
          >
            <span className="tab-name">{f}</span>
            {watchers.length > 0 && (
              <span className="tab-watchers">
                {watchers.map((w) => (
                  <span
                    key={w.userId}
                    className="dot dot-sm"
                    title={w.name}
                    style={{ background: w.color }}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
