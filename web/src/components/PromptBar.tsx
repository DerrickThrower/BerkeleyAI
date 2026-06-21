import { useEffect, useRef, useState } from "react";
import type { ModelChoice } from "../types";

interface PromptBarProps {
  model: ModelChoice;
  disabled: boolean;
  onModelChange: (model: ModelChoice) => void;
  onSubmit: (text: string) => void;
  onTyping: (typing: boolean) => void;
  // Live draft for the shared Intent Map — fires (debounced) as you type.
  onDraft: (text: string) => void;
}

const MODELS: { value: ModelChoice; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "gpt", label: "GPT" },
  { value: "mock", label: "Mock" },
];

export function PromptBar({
  model,
  disabled,
  onModelChange,
  onSubmit,
  onTyping,
  onDraft,
}: PromptBarProps) {
  const [text, setText] = useState("");
  const draftTimer = useRef<number | null>(null);

  // Debounce draft broadcasts so we classify on a pause, not every keystroke.
  const emitDraft = (value: string) => {
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => onDraft(value), 220);
  };
  useEffect(() => () => {
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setText("");
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    onDraft(""); // clear our composing chip immediately
  };

  return (
    <div className="prompt-bar">
      <textarea
        className="prompt-input"
        value={text}
        placeholder="Prompt the shared codebase…  (⌘/Ctrl+Enter to send)"
        rows={1}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onTyping(e.target.value.length > 0);
          emitDraft(e.target.value);
        }}
        onFocus={() => onTyping(text.length > 0)}
        onBlur={() => onTyping(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      <select
        className="prompt-model"
        value={model}
        disabled={disabled}
        onChange={(e) => onModelChange(e.target.value as ModelChoice)}
      >
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        className="btn-primary prompt-send"
        disabled={disabled || !text.trim()}
        onClick={send}
      >
        Send
      </button>
    </div>
  );
}
