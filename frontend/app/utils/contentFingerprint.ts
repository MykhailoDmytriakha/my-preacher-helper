/**
 * A stable string that changes whenever the CONTENT changes.
 *
 * WHY. The freshness detector compares what the screen holds with what the
 * server holds. Comparing lengths and a few scalar fields is cheap and wrong:
 * editing a thought's text, reordering the items of a series, or rewriting a
 * group's block all leave every count identical, so the stale screen declared
 * itself fresh and the person was never warned. Adversarial review flagged it,
 * and it is the same defect class already fixed on prayers.
 *
 * The listener already receives the whole document, so fingerprinting costs no
 * extra reads — only a little CPU on a snapshot the app was handed anyway.
 *
 * Key order is normalized, because Firestore and our own object literals do not
 * guarantee it: without sorting, an identical document could fingerprint
 * differently and raise a phantom "changed elsewhere".
 */
export function contentFingerprint(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` is absent in Firestore, so treat it as absent here too —
      // otherwise a local object with an explicit undefined never matches remote.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return String(value);
}
