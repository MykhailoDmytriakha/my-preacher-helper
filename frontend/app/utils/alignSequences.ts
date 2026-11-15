/** Half-open differing ranges; indices refer to the original input sequences. */
export interface DifferenceRun {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** At most 1 MiB of LCS cells, irrespective of the input length. */
export const ALIGNMENT_CELL_BUDGET = 262144;

/** Equal edges, then a deterministic LCS (ties consume the old item first). */
export function alignSequences<T>(
  old: readonly T[], next: readonly T[], equal: (a: T, b: T) => boolean,
): DifferenceRun[] {
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && equal(old[prefix], next[prefix])) prefix++;
  let oldEnd = old.length, newEnd = next.length;
  while (oldEnd > prefix && newEnd > prefix && equal(old[oldEnd - 1], next[newEnd - 1])) {
    oldEnd--; newEnd--;
  }
  const m = oldEnd - prefix, n = newEnd - prefix;
  if (!m && !n) return [];
  if (!m || !n || (m + 1) * (n + 1) > ALIGNMENT_CELL_BUDGET) {
    return [{ oldFrom: prefix, oldTo: oldEnd, newFrom: prefix, newTo: newEnd }];
  }
  const width = n + 1;
  const table = new Uint32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    table[i * width + j] = equal(old[prefix + i], next[prefix + j])
      ? 1 + table[(i + 1) * width + j + 1]
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const runs: DifferenceRun[] = [];
  let oldCursor = prefix, newCursor = prefix;
  const match = (a: number, b: number) => {
    if (a !== oldCursor || b !== newCursor) {
      runs.push({ oldFrom: oldCursor, oldTo: a, newFrom: newCursor, newTo: b });
    }
    oldCursor = a + 1; newCursor = b + 1;
  };
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (equal(old[prefix + i], next[prefix + j])) { match(prefix + i, prefix + j); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  match(oldEnd, newEnd);
  return runs;
}
