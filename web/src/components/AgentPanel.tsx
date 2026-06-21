import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../workspace-types";

interface AgentPanelProps {
  events: AgentEvent[];
  running: boolean;
  onRun: (prompt: string) => void;
  onStop: () => void;
  onViewDiff: () => void;
  // Live draft for the shared session context — fires (debounced) as you type,
  // so teammates see what you're about to ask before you run it.
  onDraft: (text: string) => void;
}

const TOOL_META: Record<string, { icon: string; label: string }> = {
  list_files: { icon: "●", label: "Listed files" },
  read_file: { icon: "●", label: "Read" },
  edit_file: { icon: "●", label: "Edited" },
  write_file: { icon: "●", label: "Wrote" },
  finish: { icon: "●", label: "Done" },
};

function toolLabel(ev: AgentEvent): string {
  const meta = TOOL_META[ev.tool ?? ""] ?? { label: ev.tool ?? "tool" };
  return meta.label;
}

export function AgentPanel({
  events,
  running,
  onRun,
  onStop,
  onViewDiff,
  onDraft,
}: AgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const draftTimer = useRef<number | null>(null);

  const emitDraft = (value: string) => {
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => onDraft(value), 250);
  };
  useEffect(
    () => () => {
      if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    },
    []
  );

  // Auto-scroll the transcript to the newest message.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, running]);

  const submit = () => {
    const p = prompt.trim();
    if (!p || running) return;
    onRun(p);
    setPrompt("");
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    onDraft("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // Mark each tool_use that has a matching tool_result, so we can show a check.
  const resolvedTools = useMemo(() => {
    const done = new Set<number>();
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
    <div className="cc">
      <div className="cc-log" ref={logRef}>
        {events.length === 0 && (
          <div className="cc-empty">
            <div className="cc-empty-title">Code with an agent</div>
            <p>
              Describe a change in plain language. The agent reads and edits files
              across the whole codebase, and shows its work as it goes. When a
              teammate is also working, it reads what they’re doing and
              coordinates before it starts.
            </p>
          </div>
        )}

        {events.map((ev, i) => {
          switch (ev.phase) {
            case "start":
              return (
                <div key={i} className="cc-turn cc-user">
                  <span className="cc-prompt-mark">❯</span>
                  <span className="cc-user-text">{ev.text}</span>
                </div>
              );
            case "message":
              return ev.text ? (
                <div key={i} className="cc-assistant">
                  {ev.text}
                </div>
              ) : null;
            case "tool_use": {
              const ok = resolvedTools.has(i);
              return (
                <div key={i} className={"cc-tool" + (ok ? " ok" : "")}>
                  <span className="cc-tool-bullet">●</span>
                  <span className="cc-tool-label">{toolLabel(ev)}</span>
                  {ev.path && <code className="cc-tool-path">{ev.path}</code>}
                </div>
              );
            }
            case "tool_result":
              return ev.detail && /error/i.test(ev.detail) ? (
                <div key={i} className="cc-tool-err">{ev.detail}</div>
              ) : null;
            case "error":
              return (
                <div key={i} className="cc-error">
                  {ev.text || "Agent error."}
                </div>
              );
            case "done":
              return (
                <div key={i} className="cc-done">
                  {ev.summary && <div className="cc-done-text">{ev.summary}</div>}
                  {ev.filesChanged && ev.filesChanged.length > 0 && (
                    <div className="cc-done-files">
                      {ev.filesChanged.map((p) => (
                        <span key={p} className="cc-file-chip" title={p}>
                          {p}
                        </span>
                      ))}
                      <button className="cc-viewdiff" onClick={onViewDiff}>
                        View diff →
                      </button>
                    </div>
                  )}
                </div>
              );
            default:
              return null;
          }
        })}

        {running && (
          <div className="cc-running">
            <span className="cc-spinner" /> working…
          </div>
        )}
      </div>

      <div className="cc-composer">
        <textarea
          className="cc-input"
          placeholder="Ask the agent to change the codebase…  (⌘/Ctrl+↵ to send)"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            emitDraft(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="cc-send cc-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="cc-send" onClick={submit} disabled={!prompt.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
