import { createHash } from 'node:crypto';

const PART_CHARACTERS = 250_000;

export const conflictReceiptDigest = (json: string) => createHash('sha256').update(json).digest('base64url');

export function validConflictPartCount(count: unknown, limit: number): count is number {
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && count <= limit;
}

/** Keep every part below Firestore's byte limit without splitting a surrogate pair. */
export function splitConflictJson(json: string, limit: number): string[] | undefined {
  const parts: string[] = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + PART_CHARACTERS, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(json.slice(start, end));
    if (parts.length > limit) return undefined;
    start = end;
  }
  return parts;
}

export function readConflictJsonParts(parts: readonly unknown[], count: number, digest: string): unknown {
  if (parts.length !== count || !parts.every(part => typeof part === 'string' && part.length <= PART_CHARACTERS)) return;
  const json = parts.join('');
  if (conflictReceiptDigest(json) !== digest) return;
  try { return JSON.parse(json) as unknown; } catch { return undefined; }
}
