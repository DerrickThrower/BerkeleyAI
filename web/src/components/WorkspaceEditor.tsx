import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";

interface WorkspaceEditorProps {
  value: string;
  path: string | null;
  onChange: (value: string) => void;
}

function langForPath(path: string | null): Extension[] {
  if (!path) return [];
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "py":
      return [python()];
    case "js":
    case "cjs":
    case "mjs":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "css":
    case "scss":
    case "less":
      return [css()];
    case "html":
    case "htm":
      return [html()];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    default:
      return [];
  }
}

export function WorkspaceEditor({ value, path, onChange }: WorkspaceEditorProps) {
  const extensions = useMemo(() => langForPath(path), [path]);
  return (
    <div className="editor-wrap ws-editor-wrap">
      <CodeMirror
        value={value}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
        }}
      />
    </div>
  );
}
