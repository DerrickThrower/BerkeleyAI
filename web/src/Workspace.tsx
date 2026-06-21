import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWs } from "./ws";
import type { ServerMsg } from "./types";
import { api, ApiError } from "./api";
import type {
  Session,
  FileNode,
  DiffFile,
  GitInfo,
  DevStatus,
  ModelChoice,
  AgentEvent,
} from "./workspace-types";
import { FileTree } from "./components/FileTree";
import { WorkspaceEditor } from "./components/WorkspaceEditor";
import { DiffViewer } from "./components/DiffViewer";
import { PreviewPane } from "./components/PreviewPane";
import { Terminal, type TermLine } from "./components/Terminal";
import { ShipPanel } from "./components/ShipPanel";
import { AgentPanel } from "./components/AgentPanel";

const PALETTE = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c"];
const SAVE_DEBOUNCE = 800;

type RightTab = "agent" | "preview" | "diff" | "tests";

function userName(): string {
  try {
    return localStorage.getItem("vibedocs.name") || "you";
  } catch {
    return "you";
  }
}
function userColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface WorkspaceProps {
  sessionId: string;
}

export function Workspace({ sessionId }: WorkspaceProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tree, setTree] = useState<FileNode | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [git, setGit] = useState<GitInfo | null>(null);
  const [dev, setDev] = useState<DevStatus>({ state: "stopped", url: null, pid: null });
  const [devLog, setDevLog] = useState("");

  const [tab, setTab] = useState<RightTab>("agent");
  const [showShip, setShowShip] = useState(false);

  // Agent (Cursor-style multi-file)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);

  // AI edit
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiModel, setAiModel] = useState<ModelChoice>("claude");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Terminal (one-shot runs + tests)
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termExit, setTermExit] = useState<number | null | undefined>(undefined);
  const [running, setRunning] = useState(false);

  const name = useMemo(userName, []);
  const color = useMemo(() => userColor(name), [name]);

  // ---- data loaders ----
  const loadDiff = useCallback(async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const r = await api.diff(sessionId);
      setDiffFiles(r.files);
    } catch (e) {
      setDiffError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setDiffLoading(false);
    }
  }, [sessionId]);

  const loadGit = useCallback(async () => {
    try {
      setGit(await api.git(sessionId));
    } catch {
      /* git info is best-effort */
    }
  }, [sessionId]);

  const loadTree = useCallback(async () => {
    setTreeError(null);
    try {
      setTree(await api.tree(sessionId));
    } catch (e) {
      setTreeError(e instanceof ApiError ? e.message : String(e));
    }
  }, [sessionId]);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getSession(sessionId);
        if (cancelled) return;
        setSession(s);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : String(e));
        return;
      }
      void loadTree();
      void loadDiff();
      void loadGit();
      try {
        const d = await api.dev(sessionId);
        if (!cancelled) setDev(d);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadTree, loadDiff, loadGit]);

  // ---- file open / save ----
  const openFile = useCallback(
    async (path: string) => {
      setActivePath(path);
      setFileError(null);
      setSaveState("idle");
      try {
        const r = await api.readFile(sessionId, path);
        setFileContent(r.content);
      } catch (e) {
        setFileError(e instanceof ApiError ? e.message : String(e));
        setFileContent("");
      }
    },
    [sessionId]
  );

  const reloadFile = useCallback(
    async (path: string) => {
      try {
        const r = await api.readFile(sessionId, path);
        setFileContent(r.content);
      } catch {
        /* best-effort reload */
      }
    },
    [sessionId]
  );

  const saveTimer = useRef<number | null>(null);
  const onEditorChange = useCallback(
    (value: string) => {
      setFileContent(value);
      if (!activePath) return;
      setSaveState("saving");
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      const path = activePath;
      saveTimer.current = window.setTimeout(async () => {
        try {
          await api.writeFile(sessionId, path, value);
          setSaveState("saved");
          void loadDiff();
          void loadGit();
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE);
    },
    [activePath, sessionId, loadDiff, loadGit]
  );

  // Mirror latest values/loaders so the stable WS handler reads fresh state.
  const onAgentDoneRef = useRef<(ev: AgentEvent) => void>(() => {});
  onAgentDoneRef.current = (ev: AgentEvent) => {
    void loadTree();
    void loadDiff();
    void loadGit();
    if (activePath && ev.filesChanged?.includes(activePath)) {
      void reloadFile(activePath);
    }
  };

  // ---- websocket ----
  const handleMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case "run_event": {
        const ev = msg.event;
        if (ev.runId === "dev") {
          if (ev.chunk) setDevLog((prev) => (prev + ev.chunk).slice(-20000));
          return;
        }
        if (ev.chunk) {
          setTermLines((prev) => [...prev, { stream: ev.stream, text: ev.chunk }]);
        }
        if (ev.done) {
          setRunning(false);
          setTermExit(ev.exitCode ?? null);
        }
        break;
      }
      case "agent_event": {
        const ev = msg.event;
        setAgentEvents((prev) => [...prev, ev]);
        if (ev.phase === "done" || ev.phase === "error") {
          setAgentRunning(false);
        }
        if (ev.phase === "done") {
          onAgentDoneRef.current(ev);
        }
        break;
      }
      case "dev_status":
        setDev(msg.status);
        break;
      default:
        break;
    }
  }, []);

  const { status, send } = useWs({
    enabled: !!session,
    onMessage: handleMessage,
    onOpen: () => {
      send({ type: "join", roomId: sessionId, user: { name, color, model: aiModel } });
      // refresh dev status on (re)connect
      api
        .dev(sessionId)
        .then(setDev)
        .catch(() => {});
    },
  });

  // ---- AI edit ----
  const runAiEdit = async () => {
    if (!activePath || !aiPrompt.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await api.aiEdit(sessionId, activePath, aiPrompt.trim(), aiModel);
      if (r.ok) {
        setFileContent(r.after);
        setAiPrompt("");
        setSaveState("saved");
        void loadDiff();
        void loadGit();
        setTab("diff");
      } else {
        setAiError(r.error || "AI edit failed.");
      }
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  // ---- agent (Cursor-style multi-file) ----
  const runAgent = (prompt: string) => {
    setAgentEvents([]);
    setAgentRunning(true);
    setTab("agent");
    send({ type: "agent", prompt, model: aiModel });
  };
  const stopAgent = () => {
    send({ type: "agent_cancel" });
    setAgentRunning(false);
  };

  // ---- run / tests ----
  const runCommand = (cmd: string, label: string) => {
    setTermLines([{ stream: "system", text: `$ ${cmd}\n` }]);
    setTermExit(undefined);
    setRunning(true);
    setTab("tests");
    send({ type: "run", cmd, label });
  };

  const modifiedPaths = useMemo(
    () => new Set(diffFiles.map((d) => d.path)),
    [diffFiles]
  );

  if (loadError) {
    return (
      <div className="ws-fatal">
        <button className="ws-back" onClick={() => (window.location.href = "/")}>
          ← Dashboard
        </button>
        <div className="ws-error">{loadError}</div>
      </div>
    );
  }

  if (!session) {
    return <div className="ws-loading">Loading session…</div>;
  }

  return (
    <div className="ws">
      <header className="ws-top">
        <button className="ws-back" onClick={() => (window.location.href = "/")}>
          ← Dashboard
        </button>
        <div className="ws-top-title">{session.name}</div>
        {git?.branch && (
          <span className="ws-branch" title={git.remote ?? undefined}>
            ⎇ {git.branch}
            {git.dirty && <span className="ws-dirty"> •</span>}
          </span>
        )}
        <span className={`conn conn-${status}`}>
          <span className="conn-dot" /> {status}
        </span>
        <button
          className="btn-primary ws-ship-btn"
          onClick={() => setShowShip(true)}
          disabled={!git?.isRepo}
        >
          Ship
        </button>
      </header>

      <div className="ws-main">
        {/* LEFT: file tree */}
        <aside className="ws-left">
          <div className="ws-left-head">
            <span>Files</span>
            <button className="ws-btn-sm" onClick={() => void loadTree()}>
              ↻
            </button>
          </div>
          {treeError ? (
            <div className="ws-error">{treeError}</div>
          ) : !tree ? (
            <div className="ws-dim ws-pad">loading tree…</div>
          ) : (
            <FileTree
              root={tree}
              activePath={activePath}
              modifiedPaths={modifiedPaths}
              onSelect={openFile}
            />
          )}
        </aside>

        {/* CENTER: editor + AI bar */}
        <section className="ws-center">
          <div className="ws-editor-head">
            <span className="ws-mono ws-editor-path">
              {activePath ?? "no file open"}
            </span>
            <span className={`ws-save ws-save-${saveState}`}>
              {saveState === "saving"
                ? "saving…"
                : saveState === "saved"
                ? "saved"
                : saveState === "error"
                ? "save failed"
                : ""}
            </span>
          </div>
          <div className="ws-editor-region">
            {fileError ? (
              <div className="ws-error ws-pad">{fileError}</div>
            ) : activePath ? (
              <WorkspaceEditor
                value={fileContent}
                path={activePath}
                onChange={onEditorChange}
              />
            ) : (
              <div className="editor-empty">Select a file to edit.</div>
            )}
          </div>
          <div className="ws-ai-bar">
            <textarea
              className="prompt-input"
              placeholder={
                activePath
                  ? `Ask the model to edit ${activePath}…`
                  : "Open a file to use AI edit"
              }
              value={aiPrompt}
              disabled={!activePath || aiBusy}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            <select
              className="prompt-model"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value as ModelChoice)}
            >
              <option value="claude">Claude</option>
              <option value="gpt">GPT</option>
              <option value="mock">Mock</option>
            </select>
            <button
              className="btn-primary"
              onClick={runAiEdit}
              disabled={!activePath || !aiPrompt.trim() || aiBusy}
            >
              {aiBusy ? "Editing…" : "Edit with AI"}
            </button>
          </div>
          {aiError && <div className="ws-error ws-pad">{aiError}</div>}
        </section>

        {/* RIGHT: tabbed pane */}
        <section className="ws-right">
          <div className="ws-tabbar">
            {(["agent", "preview", "diff", "tests"] as RightTab[]).map((t) => (
              <button
                key={t}
                className={`ws-tab${tab === t ? " ws-tab-active" : ""}`}
                onClick={() => {
                  setTab(t);
                  if (t === "diff") void loadDiff();
                }}
              >
                {t === "agent"
                  ? "Agent"
                  : t === "preview"
                  ? "Preview"
                  : t === "diff"
                  ? "Diff"
                  : "Tests"}
              </button>
            ))}
          </div>
          <div className="ws-pane">
            {tab === "agent" && (
              <AgentPanel
                events={agentEvents}
                running={agentRunning}
                onRun={runAgent}
                onStop={stopAgent}
                onViewDiff={() => {
                  setTab("diff");
                  void loadDiff();
                }}
              />
            )}
            {tab === "preview" && (
              <PreviewPane
                status={dev}
                devLog={devLog}
                onStart={() => {
                  setDevLog("");
                  send({ type: "dev_start" });
                }}
                onStop={() => send({ type: "dev_stop" })}
              />
            )}
            {tab === "diff" && (
              <DiffViewer
                files={diffFiles}
                loading={diffLoading}
                error={diffError}
                onRefresh={() => void loadDiff()}
              />
            )}
            {tab === "tests" && (
              <Terminal
                lines={termLines}
                exitCode={termExit}
                running={running}
                testCmd={session.testCmd}
                onRunTests={() => runCommand(session.testCmd, "tests")}
                onRunCmd={(cmd) => runCommand(cmd, "run")}
                onClear={() => {
                  setTermLines([]);
                  setTermExit(undefined);
                }}
              />
            )}
          </div>
        </section>
      </div>

      {showShip && (
        <ShipPanel
          sessionId={sessionId}
          git={git}
          onClose={() => setShowShip(false)}
          onShipped={() => {
            void loadGit();
            void loadDiff();
          }}
        />
      )}
    </div>
  );
}
