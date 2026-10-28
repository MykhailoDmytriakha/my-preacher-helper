/** A backup address is distinct from its document and from canonical request identity. */
export interface DraftAddress {
  owner: string;
  documentId: string;
  aggregate: string;
  writerId?: string;
}

const LEGACY_PREFIX = 'draft:v1:';
const SCOPED_PREFIX = 'draft:v2:';

/** Legacy addresses stay byte-compatible; each scoped writer replaces only its own copy. */
export function draftAddressKey({ owner, documentId, aggregate, writerId }: DraftAddress): string {
  if (writerId === undefined) return `${LEGACY_PREFIX}${owner}:${documentId}:${aggregate}`;
  const parts = [owner, documentId, aggregate, writerId];
  if (parts.some(part => !part)) throw new Error('Scoped draft address requires every identity');
  return SCOPED_PREFIX + parts.map(encodeURIComponent).join(':');
}

/** A versioned tuple avoids confusing a document ID with a writer or an aggregate. */
export function readDraftAddress(key: string): DraftAddress | null {
  if (key.startsWith(SCOPED_PREFIX)) {
    const parts = key.slice(SCOPED_PREFIX.length).split(':');
    if (parts.length !== 4 || parts.some(part => !part)) return null;
    try {
      const values = parts.map(decodeURIComponent);
      if (values.some((part, index) => !part || encodeURIComponent(part) !== parts[index])) return null;
      const [owner, documentId, aggregate, writerId] = values;
      return { owner, documentId, aggregate, writerId };
    } catch { return null; }
  }
  if (!key.startsWith(LEGACY_PREFIX)) return null;
  const remainder = key.slice(LEGACY_PREFIX.length);
  const ownerEnd = remainder.indexOf(':');
  const documentEnd = remainder.indexOf(':', ownerEnd + 1);
  if (ownerEnd <= 0 || documentEnd <= ownerEnd + 1 || documentEnd === remainder.length - 1) return null;
  return { owner: remainder.slice(0, ownerEnd), documentId: remainder.slice(ownerEnd + 1, documentEnd),
    aggregate: remainder.slice(documentEnd + 1) };
}

export function isDraftAddress(key: string): boolean {
  return key.startsWith(LEGACY_PREFIX) || key.startsWith(SCOPED_PREFIX);
}

export function draftBelongsToOwner(key: string, owner: string): boolean {
  return readDraftAddress(key)?.owner === owner;
}
