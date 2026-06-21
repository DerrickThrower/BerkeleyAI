// Minimal line-level diff (LCS-based) for visualizing proposals.
// Produces a list of rows tagged as added / removed / unchanged so the
// UI can color green for added, red for removed.

export type DiffOp = "add" | "del" | "same";

export interface DiffRow {
  op: DiffOp;
  text: string;
}

/**
 * Compute a line diff between `before` and `after` using a classic
 * longest-common-subsequence table, then walk it back into rows.
 */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ op: "del", text: a[i] });
      i++;
    } else {
      rows.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ op: "del", text: a[i++] });
  while (j < m) rows.push({ op: "add", text: b[j++] });

  return rows;
}

/** Count of changed (added + removed) lines — handy for compact summaries. */
export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.op === "add") added++;
    else if (r.op === "del") removed++;
  }
  return { added, removed };
}
