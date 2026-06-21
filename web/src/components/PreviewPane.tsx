import { useEffect, useState } from "react";
import type { DevStatus } from "../workspace-types";

interface PreviewPaneProps {
  status: DevStatus;
  devLog: string;
  onStart: () => void;
  onStop: () => void;
}

const STATE_LABEL: Record<DevStatus["state"], string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  error: "Error",
};

export function PreviewPane({ status, devLog, onStart, onStop }: PreviewPaneProps) {
  // Manual URL override when the dev server is up but no URL was detected.
  const [manualUrl, setManualUrl] = useState("");
  const [iframeKey, setIframeKey] = useState(0);

  const detected = status.url;
  const effectiveUrl = detected ?? (manualUrl.trim() || null);
  const running = status.state === "running" || status.state === "starting";

  // Reset manual URL when a real one is detected.
  useEffect(() => {
    if (detected) setManualUrl("");
  }, [detected]);

  return (
    <div className="ws-preview">
      <div className="ws-pane-toolbar">
        <span className={`ws-dev-state ws-dev-${status.state}`}>
          ● {STATE_LABEL[status.state]}
        </span>
        {running ? (
          <button className="ws-btn-sm" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="ws-btn-sm ws-btn-go" onClick={onStart}>
            ▶ Run localhost
          </button>
        )}
        {effectiveUrl && (
          <>
            <span className="ws-preview-url" title={effectiveUrl}>
              {effectiveUrl}
            </span>
            <button className="ws-btn-sm" onClick={() => setIframeKey((k) => k + 1)}>
              ↻ Reload
            </button>
          </>
        )}
      </div>

      {status.message && <div className="ws-dev-msg">{status.message}</div>}

      {effectiveUrl ? (
        <iframe
          key={iframeKey}
          className="ws-preview-frame"
          src={effectiveUrl}
          title="preview"
        />
      ) : status.state === "running" || status.state === "starting" ? (
        <div className="ws-preview-fallback">
          <p className="ws-dim">
            Dev server is up but no URL was detected. Point the preview manually:
          </p>
          <div className="ws-row">
            <input
              className="ws-input"
              placeholder="http://localhost:3000"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
          </div>
          <pre className="ws-term ws-dev-log">{devLog || "waiting for output…"}</pre>
        </div>
      ) : (
        <div className="ws-empty-pane">
          {status.state === "error"
            ? "Dev server failed to start. Check the log."
            : "Press ▶ Run localhost to start the dev server."}
          {devLog && <pre className="ws-term ws-dev-log">{devLog}</pre>}
        </div>
      )}
    </div>
  );
}
