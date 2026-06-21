import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWs } from "./ws";
import type { ServerMsg, Presence, IntentItem, ActiveRunView } from "./types";
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
import { TeamContext } from "./components/TeamContext";

const PALETTE = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c"];
const SAVE_DEBOUNCE = 800;

type RightTab = "preview" | "diff" | "tests";

function userName(): string {
  try {
    const urlName = new URLSearchParams(window.location.search).get("name");
    if (urlName) {
      localStorage.setItem("vibedocs.name", urlName);
      return urlName;
    }
    return localStorage.getItem("vibedocs.name") || "you";
  } catch {
    return "you";
  }
}
// Stable id PER TAB (sessionStorage): reconnects reuse the same presence slot
// instead of piling up ghosts, while two tabs are still distinct people.
function clientId(): string {
  try {
    let id = sessionStorage.getItem("vibedocs.cid");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("vibedocs.cid", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
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

  const [tab, setTab] = useState<RightTab>("diff");
  const [showShip, setShowShip] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  // Agent (Cursor-style multi-file)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);

  // Shared session context (who else is here, what they're prompting/building)
  const [presence, setPresence] = useState<Presence[]>([]);
  const [intents, setIntents] = useState<IntentItem[]>([]);
  const [runs, setRuns] = useState<ActiveRunView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);

  // The agent always runs on Claude. (The single-file "AI edit" bar was removed
  // in favor of the agent as the one prompting surface.)
  const [aiModel] = useState<ModelChoice>("claude");

  // Terminal (one-shot runs + tests)
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termExit, setTermExit] = useState<number | null | undefined>(undefined);
  const [running, setRunning] = useState(false);

  const name = useMemo(userName, []);
  const color = useMemo(() => userColor(name), [name]);
  const cid = useMemo(clientId, []);

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
  const selfIdRef = useRef<string | null>(null);
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
      case "room_state":
        if (msg.you?.id) {
          selfIdRef.current = msg.you.id;
          setSelfId(msg.you.id);
        }
        setPresence(msg.presence);
        break;
      case "presence":
        setPresence(msg.presence);
        break;
      case "intents":
        setIntents(msg.intents);
        break;
      case "runs":
        setRuns(msg.runs);
        break;
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
        // My own run streams into the agent log; teammates' runs surface in the
        // Team Context bar (and via the active-runs broadcast) instead.
        const mine = !ev.userId || ev.userId === selfIdRef.current;
        if (mine) {
          setAgentEvents((prev) => [...prev, ev]);
          if (ev.phase === "done" || ev.phase === "error") setAgentRunning(false);
        }
        // Any run finishing changed files on disk in this shared repo → refresh.
        if (ev.phase === "done") onAgentDoneRef.current(ev);
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
      send({ type: "join", roomId: sessionId, user: { id: cid, name, color, model: aiModel } });
      // refresh dev status on (re)connect
      api
        .dev(sessionId)
        .then(setDev)
        .catch(() => {});
    },
  });

  // ---- agent (Cursor-style multi-file) ----
  const runAgent = (prompt: string) => {
    setActivePath(null); // keep the chat in view
    setAgentEvents([]);
    setAgentRunning(true);
    send({ type: "agent", prompt, model: aiModel });
  };
  const stopAgent = () => {
    send({ type: "agent_cancel" });
    setAgentRunning(false);
  };
  const handleDraft = useCallback(
    (text: string) => send({ type: "draft", text }),
    [send]
  );

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

      <TeamContext
        presence={presence}
        intents={intents}
        runs={runs}
        selfId={selfId}
      />

      <div className={"ws-main" + (filesCollapsed ? " files-collapsed" : "")}>
        {/* LEFT: file tree (collapsible) */}
        {filesCollapsed ? (
          <aside className="ws-left ws-left-collapsed">
            <button
              className="ws-btn-sm ws-left-expand"
              title="Show files"
              onClick={() => setFilesCollapsed(false)}
            >
              ▸
            </button>
          </aside>
        ) : (
          <aside className="ws-left">
            <div className="ws-left-head">
              <span>Files</span>
              <div className="ws-left-head-actions">
                <button className="ws-btn-sm" title="Refresh" onClick={() => void loadTree()}>
                  ↻
                </button>
                <button
                  className="ws-btn-sm"
                  title="Collapse files"
                  onClick={() => setFilesCollapsed(true)}
                >
                  ⟨
                </button>
              </div>
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
        )}

        {/* CENTER: the agent chat (Claude Code style); a file opens over it */}
        <section className="ws-center">
          {activePath ? (
            <>
              <div className="ws-editor-head">
                <button
                  className="ws-btn-sm ws-back-chat"
                  title="Back to chat"
                  onClick={() => setActivePath(null)}
                >
                  ← Chat
                </button>
                <span className="ws-mono ws-editor-path">{activePath}</span>
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
                ) : (
                  <WorkspaceEditor
                    value={fileContent}
                    path={activePath}
                    onChange={onEditorChange}
                  />
                )}
              </div>
            </>
          ) : (
            <AgentPanel
              events={agentEvents}
              running={agentRunning}
              onRun={runAgent}
              onStop={stopAgent}
              onDraft={handleDraft}
              onViewDiff={() => {
                setTab("diff");
                void loadDiff();
              }}
            />
          )}
        </section>

        {/* RIGHT: tabbed pane */}
        <section className="ws-right">
          <div className="ws-tabbar">
            {(["preview", "diff", "tests"] as RightTab[]).map((t) => (
              <button
                key={t}
                className={`ws-tab${tab === t ? " ws-tab-active" : ""}`}
                onClick={() => {
                  setTab(t);
                  if (t === "diff") void loadDiff();
                }}
              >
                {t === "preview" ? "Preview" : t === "diff" ? "Diff" : "Tests"}
              </button>
            ))}
          </div>
          <div className="ws-pane">
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
