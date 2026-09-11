/**
 * Strips `undefined` anywhere inside a value, nested included.
 *
 * Firestore rejects a document containing `undefined` at any depth, so every writer needs this
 * before it hands anything over. It existed FOUR times, copied from neighbour to neighbour —
 * prayer requests, series membership, groups and now orders of service — which is exactly the
 * shape of mistake this repository pays most for: four versions of one rule look identical
 * until one of them is fixed.
 *
 * Arrays keep their holes-free shape; objects lose only the keys whose value is `undefined`.
 * `null` is left alone: Firestore stores it, and it means something different from absence.
 */
export function deepCleanUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => deepCleanUndefined(item)) as T;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, deepCleanUndefined(entry)])
    ) as T;
  }
  return value;
}
