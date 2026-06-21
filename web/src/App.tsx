import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWs } from "./ws";
import type {
  ArbCase,
  IntentItem,
  ModelChoice,
  Presence,
  PresenceState,
  Resolution,
  ServerMsg,
  User,
} from "./types";
import { JoinScreen } from "./components/JoinScreen";
import { PresenceStrip } from "./components/PresenceStrip";
import { FileTabs } from "./components/FileTabs";
import { CodeEditor } from "./components/CodeEditor";
import { StatusStrip } from "./components/StatusStrip";
import { PromptBar } from "./components/PromptBar";
import { MergeOverlay } from "./components/MergeOverlay";
import { IntentMap } from "./components/IntentMap";

const PALETTE = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c"];

function pickColor(name: string): string {
  // Stable per-name color from the palette.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  const model = q.get("model");
  const validModel: ModelChoice =
    model === "claude" || model === "gpt" || model === "mock"
      ? model
      : "claude";
  return {
    name: q.get("name") ?? "",
    model: validModel,
    // null = fresh visit → offer "start a session"; a value = invited / scripted.
    room: q.get("room"),
  };
}

export default function App() {
  const query = useMemo(readQuery, []);
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState(query.name);
  const [model, setModel] = useState<ModelChoice>(query.model);
  const [room, setRoom] = useState<string>(query.room ?? "");
  const color = useMemo(() => pickColor(name || "anon"), [name]);

  // Room state
  const [files, setFiles] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [intents, setIntents] = useState<IntentItem[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Arbitration / status
  const [queueDepth, setQueueDepth] = useState(0);
  const [arbitrating, setArbitrating] = useState(false);
  const [arbCase, setArbCase] = useState<ArbCase | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  // Local presence tracking so heartbeats keep current state/file.
  const presenceRef = useRef<{ state: PresenceState; file: string | null }>({
    state: "viewing",
    file: null,
  });

  const fileNames = useMemo(() => Object.keys(files), [files]);

  // Server assigns our id and echoes it back in room_state.you; fall back to
  // matching by name if an older server doesn't send it.
  const [youId, setYouId] = useState<string | null>(null);
  const selfId = useMemo(() => {
    if (youId) return youId;
    const me = users.find((u) => u.name === name);
    return me?.id ?? null;
  }, [youId, users, name]);

  const handleMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case "room_state": {
        if (msg.you?.id) setYouId(msg.you.id);
        setFiles(msg.files);
        setUsers(msg.users);
        setPresence(msg.presence);
        setActiveFile((cur) => cur ?? Object.keys(msg.files)[0] ?? null);
        break;
      }
      case "presence":
        setPresence(msg.presence);
        break;
      case "intents":
        setIntents(msg.intents);
        break;
      case "prompt_queued":
        setQueueDepth(msg.queueDepth);
        break;
      case "arbitrating":
        setArbitrating(true);
        setArbCase(msg.arbCase);
        break;
      case "resolution": {
        setArbitrating(false);
        setQueueDepth((d) => Math.max(0, d - msg.resolution.prompts.length));
        // Apply resolved files into the buffer set.
        setFiles((prev) => ({ ...prev, ...msg.resolution.appliedFiles }));
        // Show the signature overlay when there are >= 2 proposals,
        // or whenever it's a conflict (always surface the conflict).
        if (
          msg.resolution.proposals.length >= 2 ||
          msg.resolution.type === "case3_conflict"
        ) {
          setResolution(msg.resolution);
        }
        break;
      }
      case "file_update":
        setFiles((prev) => ({ ...prev, [msg.file]: msg.content }));
        break;
      case "error":
        // eslint-disable-next-line no-console
        console.warn("server error:", msg.message);
        break;
    }
  }, []);

  const { status, send } = useWs({
    enabled: joined,
    onMessage: handleMessage,
    onOpen: () => {
      send({ type: "join", roomId: room, user: { name, color, model } });
      // Announce initial presence.
      send({
        type: "presence",
        state: presenceRef.current.state,
        file: presenceRef.current.file,
      });
    },
  });

  // Heartbeat presence every ~10s so the server can prune ghosts.
  useEffect(() => {
    if (!joined || status !== "open") return;
    const id = window.setInterval(() => {
      send({
        type: "presence",
        state: presenceRef.current.state,
        file: presenceRef.current.file,
      });
    }, 10000);
    return () => window.clearInterval(id);
  }, [joined, status, send]);

  const sendPresence = useCallback(
    (state: PresenceState, file: string | null) => {
      presenceRef.current = { state, file };
      send({ type: "presence", state, file });
    },
    [send]
  );

  // Auto-join only when BOTH name and room are in the URL (scripted demo links).
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (!autoJoinedRef.current && query.name.trim() && query.room) {
      autoJoinedRef.current = true;
      presenceRef.current = { state: "viewing", file: null };
      setJoined(true);
    }
  }, [query.name, query.room]);

  const handleJoin = (n: string, m: ModelChoice, r: string) => {
    setName(n);
    setModel(m);
    setRoom(r);
    // Put the session in the URL so it survives refresh and the bar is shareable.
    try {
      window.history.replaceState({}, "", `?room=${encodeURIComponent(r)}`);
    } catch {
      /* ignore */
    }
    presenceRef.current = { state: "viewing", file: null };
    setJoined(true);
  };

  const handleSelectFile = (file: string) => {
    setActiveFile(file);
    sendPresence("viewing", file);
  };

  const handleModelChange = (m: ModelChoice) => {
    setModel(m);
    send({ type: "set_model", model: m });
  };

  const handleSubmitPrompt = (text: string) => {
    sendPresence("prompting", activeFile);
    send({
      type: "submit_prompt",
      text,
      model,
      file: activeFile ?? undefined,
    });
  };

  const handleTyping = (typing: boolean) => {
    sendPresence(typing ? "typing" : "viewing", activeFile);
  };

  const handleDraft = useCallback(
    (text: string) => send({ type: "draft", text }),
    [send]
  );

  if (!joined) {
    return (
      <JoinScreen
        initialName={name}
        initialModel={model}
        invitedRoom={query.room}
        color={color}
        onJoin={handleJoin}
      />
    );
  }

  const editorValue = activeFile ? files[activeFile] ?? "" : "";

  return (
    <div className="app">
      <PresenceStrip presence={presence} selfId={selfId} status={status} room={room} />

      <FileTabs
        files={fileNames}
        active={activeFile}
        presence={presence}
        selfId={selfId}
        onSelect={handleSelectFile}
      />

      <div className="editor-region">
        {fileNames.length === 0 ? (
          <div className="editor-empty">
            {status === "open" ? "loading room…" : "connecting…"}
          </div>
        ) : (
          <CodeEditor
            value={editorValue}
            onChange={(v) =>
              activeFile &&
              setFiles((prev) => ({ ...prev, [activeFile]: v }))
            }
            onFocus={() => sendPresence("viewing", activeFile)}
          />
        )}
      </div>

      <IntentMap intents={intents} files={files} selfId={selfId} />

      <StatusStrip
        queueDepth={queueDepth}
        arbitrating={arbitrating}
        arbCase={arbCase}
      />

      <PromptBar
        model={model}
        disabled={status !== "open"}
        onModelChange={handleModelChange}
        onSubmit={handleSubmitPrompt}
        onTyping={handleTyping}
        onDraft={handleDraft}
      />

      {resolution && (
        <MergeOverlay
          resolution={resolution}
          onResolveConflict={(strategy) =>
            send({
              type: "resolve_conflict",
              resolutionId: resolution.id,
              strategy,
            })
          }
          onDismiss={() => setResolution(null)}
        />
      )}
    </div>
  );
}
