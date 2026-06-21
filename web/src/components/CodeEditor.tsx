import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const extensions = [python()];

export function CodeEditor({
  value,
  onChange,
  onFocus,
  onBlur,
}: CodeEditorProps) {
  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
        }}
      />
    </div>
  );
}
