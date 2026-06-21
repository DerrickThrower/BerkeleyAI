import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../workspace-types";

interface AgentPanelProps {
  events: AgentEvent[];
  running: boolean;
  onRun: (prompt: string) => void;
  onStop: () => void;
  onViewDiff: () => void;
}

const TOOL_META: Record<string, { icon: string; label: string }> = {
  list_files: { icon: "📁", label: "Listing files" },
  read_file: { icon: "📖", label: "Reading" },
  edit_file: { icon: "✏️", label: "Editing" },
  write_file: { icon: "📝", label: "Writing" },
  finish: { icon: "✓", label: "Finishing" },
};

function toolLine(ev: AgentEvent): { icon: string; text: string } {
  const meta = (ev.tool && TOOL_META[ev.tool]) || { icon: "•", text: ev.tool ?? "tool" };
  const label = "label" in meta ? meta.label : (meta as { text: string }).text;
  if (ev.path) return { icon: meta.icon, text: `${label} ${ev.path}` };
  return { icon: meta.icon, text: label };
}

export function AgentPanel({
  events,
  running,
  onRun,
  onStop,
  onViewDiff,
}: AgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to newest at bottom.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const submit = () => {
    const p = prompt.trim();
    if (!p || running) return;
    onRun(p);
    setPrompt("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // Track which tool_use lines have a matching tool_result (by path/iteration order).
  const resolvedTools = useMemo(() => {
    const done = new Set<number>();
    // Match each tool_result to the most recent unresolved tool_use.
    for (let i = 0; i < events.length; i++) {
      if (events[i].phase !== "tool_result") continue;
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].phase === "tool_use" && !done.has(j)) {
          done.add(j);
          break;
        }
      }
    }
    return done;
  }, [events]);

  return (
    <div className="ws-agent">
      <div className="ws-agent-composer">
        <textarea
          className="ws-agent-input"
          placeholder="Ask the agent to change the codebase…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ws-agent-composer-foot">
          <span className="ws-agent-hint">⌘/Ctrl+↵ to run</span>
          {running ? (
            <button className="btn-primary ws-agent-stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={!prompt.trim()}
            >
              Run
            </button>
          )}
        </div>
      </div>

      <div className="ws-agent-log" ref={logRef}>
        {events.length === 0 && (
          <div className="ws-empty-pane">
            The agent edits multiple files across the codebase from a single
            prompt. Describe a change to get started.
          </div>
        )}

        {events.map((ev, i) => {
          switch (ev.phase) {
            case "start":
              return (
                <div key={i} className="ws-agent-bubble ws-agent-user">
                  {ev.text}
                </div>
              );
            case "message":
              return ev.text ? (
                <div key={i} className="ws-agent-prose">
                  {ev.text}
                </div>
              ) : null;
            case "tool_use": {
              const { icon, text } = toolLine(ev);
              const ok = resolvedTools.has(i);
              return (
                <div key={i} className="ws-agent-tool">
                  <span className="ws-agent-tool-icon">{icon}</span>
                  <span className="ws-agent-tool-text">{text}</span>
                  {ok && <span className="ws-agent-tool-ok">✓</span>}
                </div>
              );
            }
            case "tool_result":
              // Merged into the tool_use line above; render nothing standalone
              // unless there's explicit detail text worth surfacing.
              return ev.detail ? (
                <div key={i} className="ws-agent-tool-detail">
                  {ev.detail}
                </div>
              ) : null;
            case "error":
              return (
                <div key={i} className="ws-agent-error">
                  {ev.text || "Agent error."}
                </div>
              );
            case "done":
              return (
                <div key={i} className="ws-agent-done">
                  {ev.summary && (
                    <div className="ws-agent-done-summary">{ev.summary}</div>
                  )}
                  {ev.filesChanged && ev.filesChanged.length > 0 && (
                    <>
                      <div className="ws-agent-done-count">
                        {ev.filesChanged.length} file
                        {ev.filesChanged.length === 1 ? "" : "s"} changed
                      </div>
                      <div className="ws-agent-chips">
                        {ev.filesChanged.map((p) => (
                          <span key={p} className="ws-agent-chip" title={p}>
                            {p}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="ws-agent-done-actions">
                    <button className="ws-btn-sm" onClick={onViewDiff}>
                      View diff
                    </button>
                  </div>
                </div>
              );
            default:
              return null;
          }
        })}

        {running && (
          <div className="ws-agent-working">
            working
            <span className="ws-agent-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
