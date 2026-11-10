export const AUTHORED_LIST_REVIEW = 'authored-list-review';
export const AUTHORED_LIST_PROJECTION = 'authored-list-projection';
export const isAuthoredListComparison = (code: unknown) => code === AUTHORED_LIST_REVIEW || code === AUTHORED_LIST_PROJECTION;

export function isAuthoredStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Removing the same opening item can make two otherwise distinct insertions competing replacements. */
export function competingStringListEdits(base: unknown, mine: unknown, theirs: unknown): boolean {
  if (!isAuthoredStringList(base) || !isAuthoredStringList(mine) || !isAuthoredStringList(theirs)) return false;
  const seen = new Set(base), local = new Set(mine), stored = new Set(theirs);
  if (!base.some(item => !local.has(item) && !stored.has(item))) return false;
  return mine.some(item => !seen.has(item) && !stored.has(item))
    || theirs.some(item => !seen.has(item) && !local.has(item));
}

/** A single slot edit has at most one removed and inserted value, with the other values in place. */
export function singleStringListEdit(before: unknown, after: unknown): { removed?: string; added?: string } | undefined {
  if (!isAuthoredStringList(before) || !isAuthoredStringList(after)) return;
  const old = new Set(before), next = new Set(after);
  if (old.size !== before.length || next.size !== after.length) return;
  const removed = before.filter(item => !next.has(item)), added = after.filter(item => !old.has(item));
  if (removed.length > 1 || added.length > 1 || removed.length + added.length === 0) return;
  const retained = before.filter(item => next.has(item));
  if (after.filter(item => old.has(item)).some((item, index) => item !== retained[index])) return;
  return { removed: removed[0], added: added[0] };
}
