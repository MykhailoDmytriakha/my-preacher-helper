/** One authored heading can have several spellings, but a spelling cannot pick two identities. */
export function uniqueHeadingLookup(
  entries: ReadonlyArray<{ id: string; labels: readonly string[] }>,
  normalize: (label: string) => string = label => label.trim(),
): Map<string, string> {
  const matches = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of entries) {
    for (const label of entry.labels) {
      const key = normalize(label);
      if (!key || ambiguous.has(key)) continue;
      const previous = matches.get(key);
      if (previous !== undefined && previous !== entry.id) {
        matches.delete(key);
        ambiguous.add(key);
      } else matches.set(key, entry.id);
    }
  }
  return matches;
}
