// Workspace filesystem layer — real files on disk, scoped to a session root.
// Every path is validated to stay inside the root (no `..` escapes).

import { promises as fs } from "node:fs";
import { resolve, relative, sep, join, basename } from "node:path";
import type { FileNode } from "./types.js";

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".DS_Store",
  "coverage",
  ".vibedocs",
]);

// Resolve a relative path against root, refusing anything that escapes root.
export function safeResolve(root: string, rel: string): string {
  const abs = resolve(root, "." + sep + rel.replace(/^[/\\]+/, ""));
  const within = relative(root, abs);
  if (within.startsWith("..") || resolve(root, within) !== abs) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return abs;
}

export async function readTree(root: string, maxEntries = 4000): Promise<FileNode> {
  let count = 0;
  async function walk(dir: string, relDir: string): Promise<FileNode[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
    });
    const nodes: FileNode[] = [];
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      if (count++ > maxEntries) break;
      const relPath = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          path: relPath,
          type: "dir",
          children: await walk(join(dir, e.name), relPath),
        });
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: relPath, type: "file" });
      }
    }
    return nodes;
  }
  return { name: basename(root), path: "", type: "dir", children: await walk(root, "") };
}

const MAX_FILE = 2 * 1024 * 1024;

export async function readFileSafe(root: string, rel: string): Promise<string> {
  const abs = safeResolve(root, rel);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE) return `// file too large to open (${stat.size} bytes)`;
  return await fs.readFile(abs, "utf8");
}

export async function writeFileSafe(root: string, rel: string, content: string): Promise<void> {
  const abs = safeResolve(root, rel);
  await fs.mkdir(resolve(abs, ".."), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

export async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(safeResolve(root, rel));
    return true;
  } catch {
    return false;
  }
}
