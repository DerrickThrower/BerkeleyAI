import { useState } from "react";
import type { FileNode } from "../workspace-types";

interface FileTreeProps {
  root: FileNode | null;
  activePath: string | null;
  modifiedPaths: Set<string>;
  onSelect: (path: string) => void;
}

export function FileTree({ root, activePath, modifiedPaths, onSelect }: FileTreeProps) {
  if (!root) return null;
  const children = root.children ?? [];
  return (
    <div className="ws-tree">
      {children.length === 0 ? (
        <div className="ws-tree-empty">empty directory</div>
      ) : (
        children.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            modifiedPaths={modifiedPaths}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  modifiedPaths,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  modifiedPaths: Set<string>;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: 8 + depth * 14 };

  if (node.type === "dir") {
    return (
      <div>
        <button
          className="ws-tree-row ws-tree-dir"
          style={pad}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="ws-tree-caret">{open ? "▾" : "▸"}</span>
          <span className="ws-tree-name">{node.name}</span>
        </button>
        {open &&
          (node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              modifiedPaths={modifiedPaths}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const isActive = node.path === activePath;
  const isModified = modifiedPaths.has(node.path);
  return (
    <button
      className={`ws-tree-row ws-tree-file${isActive ? " ws-tree-active" : ""}`}
      style={pad}
      onClick={() => onSelect(node.path)}
      title={node.path}
    >
      <span className="ws-tree-name">{node.name}</span>
      {isModified && <span className="ws-tree-mod" title="modified">●</span>}
    </button>
  );
}
