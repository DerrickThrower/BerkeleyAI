// ============================================================================
// THE INTENT MAP — the shared, live picture of what everyone is about to ask.
//
// Every teammate's in-progress prompt is classified to a {file, symbol} the
// instant they type it, and projected onto the codebase here. When two intents
// land on the same symbol you SEE the collision form — red glow — before anyone
// hits send. That's the whole "don't step on each other's shoes" idea, visible.
// ============================================================================
import { useMemo } from "react";
import type { IntentItem } from "../types";

interface IntentMapProps {
  intents: IntentItem[];
  files: Record<string, string>;
  selfId: string | null;
}

// Lightweight source-order symbol extraction (py / js / ts) — enough to render
// the codebase as a map of functions to light up.
function extractSymbols(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    /^\s*class\s+([A-Za-z_]\w*)/,
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(?.*=>/,
  ];
  for (const line of content.split("\n")) {
    for (const re of patterns) {
      const m = re.exec(line);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push(m[1]);
      }
    }
  }
  return out;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

interface SymbolRow {
  symbol: string; // "" === whole-file intent
  hits: IntentItem[];
  conflict: boolean; // >= 2 distinct users on this exact symbol
}

export function IntentMap({ intents, files, selfId }: IntentMapProps) {
  const view = useMemo(() => {
    const byFile = new Map<string, IntentItem[]>();
    for (const it of intents) {
      (byFile.get(it.file) ?? byFile.set(it.file, []).get(it.file)!).push(it);
    }

    const fileRows = Object.keys(files)
      .map((path) => {
        const hits = byFile.get(path) ?? [];
        const symbols = extractSymbols(files[path] ?? "");

        // group hits by symbol ("" = whole-file / unresolved symbol)
        const bySymbol = new Map<string, IntentItem[]>();
        for (const h of hits) {
          const k = h.symbol ?? "";
          (bySymbol.get(k) ?? bySymbol.set(k, []).get(k)!).push(h);
        }

        const rows: SymbolRow[] = [...bySymbol.entries()]
          .map(([symbol, h]) => ({
            symbol,
            hits: h,
            conflict: new Set(h.map((x) => x.userId)).size >= 2,
          }))
          // targeted symbols first, in source order
          .sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));

        const users = new Set(hits.map((h) => h.userId));
        return {
          path,
          rows,
          active: hits.length > 0,
          // 2+ people on the file but no single-symbol collision = compatible overlap
          compatible: users.size >= 2 && !rows.some((r) => r.conflict),
          conflict: rows.some((r) => r.conflict),
        };
      })
      .sort((a, b) => Number(b.active) - Number(a.active));

    // collision banners (symbol-level conflicts across the room)
    const collisions = fileRows.flatMap((f) =>
      f.rows
        .filter((r) => r.conflict)
        .map((r) => ({
          file: f.path,
          symbol: r.symbol || "(whole file)",
          names: [...new Set(r.hits.map((h) => h.userName))],
        }))
    );

    return { fileRows, collisions, any: intents.length > 0 };
  }, [intents, files]);

  const chip = (it: IntentItem) => (
    <span
      key={it.userId}
      className={"intent-chip" + (it.userId === selfId ? " me" : "")}
      style={{ background: it.userColor }}
      title={`${it.userName}: ${it.text}`}
    >
      {initials(it.userName)}
    </span>
  );

  return (
    <div className={"intent-map" + (view.collisions.length ? " has-conflict" : "")}>
      <div className="intent-map-head">
        <span className="intent-map-title">◎ Shared Intent</span>
        <span className="intent-map-sub">
          what everyone’s about to prompt — live
        </span>
      </div>

      {view.collisions.map((c, i) => (
        <div className="intent-collision" key={i}>
          <span className="bolt">⚡</span>
          <strong>{c.names.join(" & ")}</strong> both targeting{" "}
          <code>
            {c.file}:{c.symbol}
          </code>{" "}
          — heads up, you’ll collide
        </div>
      ))}

      <div className="intent-files">
        {view.fileRows.map((f) => (
          <div
            key={f.path}
            className={
              "intent-file" +
              (f.conflict ? " conflict" : f.compatible ? " compatible" : f.active ? " active" : "")
            }
          >
            <div className="intent-file-name">
              <span className="dot" /> {f.path}
              {f.compatible && <span className="tag amber">compatible</span>}
              {f.conflict && <span className="tag red">conflict</span>}
              {!f.active && <span className="tag idle">idle</span>}
            </div>
            {f.rows.map((r) => (
              <div
                key={r.symbol || "_file"}
                className={"intent-sym" + (r.conflict ? " conflict" : "")}
              >
                <span className="sym-name">{r.symbol || "‹whole file›"}</span>
                <span className="sym-chips">{r.hits.map(chip)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {view.any ? (
        <div className="intent-rail">
          {intents.map((it) => (
            <div className="intent-draft" key={it.userId}>
              <span className="intent-dot" style={{ background: it.userColor }} />
              <span className="intent-who">{it.userName}</span>
              <span className="intent-text">“{it.text}”</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="intent-empty">
          Start typing a prompt — everyone sees where it’ll land.
        </div>
      )}
    </div>
  );
}
