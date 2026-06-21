import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg } from "./types";

const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  "ws://localhost:8787/ws";

export type WsStatus = "connecting" | "open" | "closed";

interface UseWsOptions {
  /** Called for every parsed server message. */
  onMessage: (msg: ServerMsg) => void;
  /** Called once whenever a fresh connection opens (e.g. to re-join). */
  onOpen?: () => void;
  /** When false, the hook will not attempt to connect. */
  enabled?: boolean;
}

interface UseWsResult {
  status: WsStatus;
  send: (msg: ClientMsg) => void;
}

/**
 * A small reconnecting WebSocket hook tailored to the VibeDocs contract.
 * - Auto-reconnects with capped exponential backoff (hackathon wifi).
 * - Exposes a typed `send`.
 * - Re-runs `onOpen` on every (re)connect so the caller can re-join.
 */
export function useWs({
  onMessage,
  onOpen,
  enabled = true,
}: UseWsOptions): UseWsResult {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const retryTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);

  // Keep latest callbacks without forcing reconnects.
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  onMessageRef.current = onMessage;
  onOpenRef.current = onOpen;

  const connect = useCallback(() => {
    if (closedByUserRef.current) return;
    setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleRetry();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 500;
      setStatus("open");
      onOpenRef.current?.();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        onMessageRef.current(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setStatus("closed");
      scheduleRetry();
    };

    ws.onerror = () => {
      // onclose will follow and drive the retry.
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };

    function scheduleRetry() {
      if (closedByUserRef.current) return;
      if (retryTimerRef.current != null) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, 8000);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, delay);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    closedByUserRef.current = false;
    connect();

    return () => {
      closedByUserRef.current = true;
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
  }, [enabled, connect]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { status, send };
}
