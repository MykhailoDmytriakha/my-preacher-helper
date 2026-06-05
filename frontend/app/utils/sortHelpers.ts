/**
 * Parse a date-ish string to epoch milliseconds, treating missing or invalid
 * values as 0 (epoch). Keeps list comparators total and transitive — a NaN time
 * would otherwise make Array.prototype.sort non-deterministic and defeat React
 * Query structural sharing (re-introducing the list "reorder flash").
 */
export function timeOrZero(value: string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Deterministic id comparator — used as the final tiebreaker so array order is
 * stable across fetches (cache and server return the same order).
 */
export function compareById(a: { id: string }, b: { id: string }): number {
  return String(a.id).localeCompare(String(b.id));
}
