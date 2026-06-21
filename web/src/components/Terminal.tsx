import { useEffect, useRef, useState } from "react";

export interface TermLine {
  stream: "stdout" | "stderr" | "system";
  text: string;
}

interface TerminalProps {
  lines: TermLine[];
  exitCode: number | null | undefined;
  running: boolean;
  testCmd: string;
  onRunTests: () => void;
  onRunCmd: (cmd: string) => void;
  onClear: () => void;
}

export function Terminal({
  lines,
  exitCode,
  running,
  testCmd,
  onRunTests,
  onRunCmd,
  onClear,
}: TerminalProps) {
  const [cmd, setCmd] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const submit = () => {
    const c = cmd.trim();
    if (!c) return;
    onRunCmd(c);
    setCmd("");
  };

  return (
    <div className="ws-tests">
      <div className="ws-pane-toolbar">
        <button
          className="ws-btn-sm ws-btn-go"
          onClick={onRunTests}
          disabled={running || !testCmd}
          title={testCmd || "no test command configured"}
        >
          ▶ Run tests
        </button>
        <span className="ws-cmd-preview" title={testCmd}>
          {testCmd || "(no testCmd)"}
        </span>
        <button className="ws-btn-sm" onClick={onClear} disabled={running}>
          Clear
        </button>
      </div>

      <div className="ws-row ws-cmd-row">
        <input
          className="ws-input ws-mono"
          placeholder="run a command, e.g. npm run lint"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="ws-btn-sm" onClick={submit} disabled={running || !cmd.trim()}>
          Run
        </button>
      </div>

      <pre className="ws-term">
        {lines.length === 0 && <span className="ws-dim">No output yet.</span>}
        {lines.map((l, i) => (
          <span key={i} className={`ws-term-${l.stream}`}>
            {l.text}
          </span>
        ))}
        {exitCode != null && (
          <span className={`ws-term-exit ${exitCode === 0 ? "ws-ok" : "ws-fail"}`}>
            {"\n"}— exited with code {exitCode} —
          </span>
        )}
        <div ref={bottomRef} />
      </pre>
    </div>
  );
}
