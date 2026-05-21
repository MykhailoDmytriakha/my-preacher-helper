/**
 * Mints a short unique id. Prefers `crypto.randomUUID()` and falls back to a
 * `Date.now() + Math.random()` combo on browsers / runtimes where it isn't
 * available (older Safari, Jest's jsdom in some configs).
 *
 * Optional `prefix` lets callers tag the id source for debugging when ids
 * land in mixed buckets (`node-…`, `media-…`).
 */
export function makeId(prefix?: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const fallback = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${fallback}` : fallback;
}
