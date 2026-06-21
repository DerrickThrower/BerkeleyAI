// Lightweight Python-source helpers. Not a real parser — just enough to locate
// top-level `def`/`class` blocks so the classifier can name a target symbol and
// the mock adapter can make believable localized edits. Used for conflict
// detection (do two prompts touch the same symbol?).

export interface SymbolSpan {
  name: string;
  kind: "def" | "class";
  startLine: number; // 0-based, the `def`/`class` line
  endLine: number; // 0-based inclusive, last line of the block
  indent: number;
}

const DEF_RE = /^(\s*)(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;

export function listSymbols(src: string): SymbolSpan[] {
  const lines = src.split("\n");
  const spans: SymbolSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DEF_RE);
    if (!m) continue;
    const indent = m[1].length;
    // Find end: next line with indent <= this def's indent that is non-blank.
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      const lead = lines[j].match(/^(\s*)/)![1].length;
      if (lead <= indent) {
        end = j - 1;
        break;
      }
    }
    spans.push({ name: m[3], kind: m[2] as "def" | "class", startLine: i, endLine: end, indent });
  }
  return spans;
}

export function findSymbol(src: string, name: string): SymbolSpan | null {
  return listSymbols(src).find((s) => s.name === name) ?? null;
}

// Insert a line at the top of a def's body (right after the `def` line and any
// docstring), preserving indentation. Returns new source.
export function insertIntoBody(src: string, symbol: string, line: string): string {
  const span = findSymbol(src, symbol);
  if (!span) return src;
  const lines = src.split("\n");
  const bodyIndent = " ".repeat(span.indent + 4);
  let insertAt = span.startLine + 1;
  // skip a docstring if present
  const first = lines[insertAt]?.trim() ?? "";
  if (first.startsWith('"""') || first.startsWith("'''")) {
    const q = first.slice(0, 3);
    if (first.length > 3 && first.endsWith(q)) {
      insertAt += 1; // single-line docstring
    } else {
      for (let j = insertAt + 1; j < lines.length; j++) {
        if (lines[j].includes(q)) {
          insertAt = j + 1;
          break;
        }
      }
    }
  }
  lines.splice(insertAt, 0, bodyIndent + line);
  return lines.join("\n");
}

// Replace the `return ...` lines inside a def with a new return expression.
export function replaceReturnInBody(src: string, symbol: string, newReturn: string): string {
  const span = findSymbol(src, symbol);
  if (!span) return src;
  const lines = src.split("\n");
  const bodyIndent = " ".repeat(span.indent + 4);
  let replaced = false;
  for (let i = span.startLine + 1; i <= span.endLine; i++) {
    if (/^\s*return\b/.test(lines[i])) {
      lines[i] = bodyIndent + "return " + newReturn;
      replaced = true;
    }
  }
  if (!replaced) lines.splice(span.endLine + 1, 0, bodyIndent + "return " + newReturn);
  return lines.join("\n");
}
