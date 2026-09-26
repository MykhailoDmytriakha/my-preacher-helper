'use client';

import { get } from 'idb-keyval';

import { extractIsoString } from '@/utils/dateFormatter';
import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';
import { hydrateSermon } from '@/utils/sermonDocument';

import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

import type { Sermon, SeriesItem } from '@/models/models';

export interface LegacyQueryCopy {
  id: string;
  owner: string;
  collection: string;
  documentId: string;
  title: string;
  raw: string;
  savedAt: number | null;
}
/** The engine storage range this archive lives in. */
const ARCHIVE_KIND = 'legacy-query';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type Candidate = Omit<LegacyQueryCopy, 'id'>;
const OWNER_DETAIL = 'owner-detail';
const QUERY_SOURCES: Record<string, { collection: string; length: number; kind: 'list' | 'detail' | 'owner-detail' | 'series-detail' }> = {
  councils: { collection: 'councils', length: 2, kind: 'list' },
  groups: { collection: 'groups', length: 2, kind: 'list' },
  'group-detail': { collection: 'groups', length: 2, kind: 'detail' },
  calendarGroups: { collection: 'groups', length: 4, kind: 'list' },
  series: { collection: 'series', length: 2, kind: 'list' },
  'series-detail': { collection: 'series', length: 2, kind: 'series-detail' },
  sermons: { collection: 'sermons', length: 2, kind: 'list' },
  sermon: { collection: 'sermons', length: 3, kind: OWNER_DETAIL },
  calendarSermons: { collection: 'sermons', length: 4, kind: 'list' },
};
/**
 * A legacy query whose collection the engine now owns. Its rows are a session-only view, so the
 * persisted cache must not keep them: the next start would archive a fresh read as if it were an
 * unsaved copy from the previous version, and the count of "local copies" would grow on every visit.
 */
export function isEngineOwnedLegacyQuery(queryKey: readonly unknown[], enabled: (collection: string) => boolean): boolean {
  const source = QUERY_SOURCES[String(queryKey[0])];
  return Boolean(source && enabled(source.collection));
}

function querySource(query: unknown, enabled: (collection: string) => boolean) {
  if (!object(query) || !Array.isArray(query.queryKey) || !object(query.state)) return null;
  const key = query.queryKey, source = QUERY_SOURCES[String(key[0])];
  if (!source || !enabled(source.collection) || key.length !== source.length) return null;
  const { collection, kind } = source, detail = kind !== 'list';
  const rows = kind === 'series-detail' ? [object(query.state.data) ? query.state.data.series : null]
    : detail ? [query.state.data] : query.state.data;
  if (!Array.isArray(rows)) return null;
  return { collection, detail, identity: kind === OWNER_DETAIL ? key[2] : key[1], rows, owner: kind === OWNER_DETAIL ? key[1] : null,
    savedAt: typeof query.state.dataUpdatedAt === 'number' && Number.isFinite(query.state.dataUpdatedAt) ? query.state.dataUpdatedAt : null };
}

function queryCopies(query: unknown, enabled: (collection: string) => boolean): Candidate[] {
  const source = querySource(query, enabled);
  if (!source) return [];
  return source.rows.flatMap((document: unknown) => {
    if (!object(document) || typeof document.id !== 'string' || !document.id
      || typeof document.userId !== 'string' || !document.userId) return [];
    // Old detail keys omit owner; the complete document still names its owner.
    // Never assign a cached document to whoever happens to be signed in now.
    if ((source.owner !== null && document.userId !== source.owner) || (source.detail ? document.id !== source.identity : document.userId !== source.identity)) return [];
    return [{ owner: document.userId, collection: source.collection, documentId: document.id,
      title: typeof document.title === 'string' ? document.title : document.id,
      raw: JSON.stringify(document, null, 2), savedAt: source.savedAt }];
  });
}

const MUTATION_OPERATIONS: Record<string, readonly string[]> = {
  groups: ['create', 'update', 'delete'], series: ['create', 'update', 'delete'],
  dashboardSermons: ['create', 'update', 'delete', 'markPreached', 'unmarkPreached', 'savePreachDate'],
};
const textField = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
function mutationIdentity(collection: string, operation: string, variables: unknown) {
  const fields = object(variables) ? variables : {};
  const documentId = (operation === 'delete' ? textField(variables) : null)
    ?? textField(fields.sermonId) ?? textField(fields.id) ?? textField(fields.seriesId) ?? 'unassigned-create';
  const explicitOwner = textField(collection === 'sermons' ? fields.uid : fields.userId);
  const payload = object(fields.input) ? fields.input : object(fields.updates) ? fields.updates : fields;
  return { documentId, explicitOwner, title: textField(payload.title) ?? `${operation}: ${documentId}` };
}

/** Paused/error variables can outlive the optimistic row, or have no row at all. */
function mutationCopies(mutations: unknown[], queries: Candidate[], enabled: (collection: string) => boolean): Candidate[] {
  return mutations.flatMap((mutation): Candidate[] => {
    if (!object(mutation) || !Array.isArray(mutation.mutationKey) || !object(mutation.state)) return [];
    const [prefix, operation] = mutation.mutationKey;
    const collection = prefix === 'dashboardSermons' ? 'sermons' : String(prefix);
    if (mutation.mutationKey.length !== 2 || !MUTATION_OPERATIONS[String(prefix)]?.includes(String(operation)) || !enabled(collection)) return [];
    const { documentId, explicitOwner, title } = mutationIdentity(collection, String(operation), mutation.state.variables);
    const cachedOwners = new Set(queries.filter(copy => copy.collection === collection && copy.documentId === documentId).map(copy => copy.owner));
    // Old deletes have only an ID. An ambiguous owner remains quarantined (owner='').
    const owner = explicitOwner ?? (cachedOwners.size === 1 ? [...cachedOwners][0] : '');
    return [{ owner, collection, documentId, title, raw: JSON.stringify(mutation, null, 2),
      savedAt: typeof mutation.state.submittedAt === 'number' ? mutation.state.submittedAt : null }];
  });
}

/** Cache state has no provable opening ancestor or delivery status. Archive, never import. */
export async function preserveLegacyQueryCache(enabled: (collection: string) => boolean): Promise<void> {
  if (!['councils', 'groups', 'series', 'sermons'].some(enabled)) return;
  const persisted: unknown = await get('react-query-cache');
  if (!object(persisted) || !object(persisted.clientState)) return;
  const queries = (Array.isArray(persisted.clientState.queries) ? persisted.clientState.queries : []).flatMap(query => queryCopies(query, enabled));
  const mutations = mutationCopies(Array.isArray(persisted.clientState.mutations) ? persisted.clientState.mutations : [], queries, enabled);
  const copies = new Map<string, Omit<LegacyQueryCopy, 'id'>[]>();
  for (const candidate of [...queries, ...mutations]) {
      const identity = JSON.stringify([ARCHIVE_KIND, candidate.owner, candidate.collection, candidate.documentId]);
      const group = copies.get(identity) ?? [];
      group.push(candidate);
      copies.set(identity, group);
  }
  if (!copies.size) return;
  await createEngineStorageTransaction()<void>('readwrite', (store, read, done) => {
    let remaining = copies.size;
    for (const [identity, candidates] of copies) {
      const key = JSON.parse(identity) as IDBValidKey;
      read(store.get(key), (stored: LegacyQueryCopy[] | undefined) => {
        const archive = stored ?? [];
        for (const candidate of candidates) {
          // Timestamp changes alone are not new content. A stale tab cannot replace a newer copy.
          if (archive.some(copy => copy.raw === candidate.raw)) continue;
          archive.push({ ...candidate, id: nextCopyId(identity, archive) });
        }
        store.put(archive, key);
        if (--remaining === 0) done(undefined);
      });
    }
  });
}

/** Retired echoes leave gaps in the numbering, so the position alone could repeat a kept copy's id. */
function nextCopyId(identity: string, archive: readonly LegacyQueryCopy[]): string {
  const used = new Set(archive.map(copy => copy.id));
  for (let index = archive.length; ; index += 1) {
    const id = JSON.stringify([...JSON.parse(identity), index]);
    if (!used.has(id)) return id;
  }
}

export function listLegacyQueryCopies(owner: string): Promise<LegacyQueryCopy[]> {
  if (!owner) return Promise.resolve([]);
  return createEngineStorageTransaction()('readonly', (store, read, done) => {
    read(store.getAll(engineOwnerRange(ARCHIVE_KIND, owner)), (groups: unknown[]) => {
      done(groups.filter(Array.isArray).flat().filter((copy: LegacyQueryCopy) => copy.owner === owner));
    });
  });
}

/**
 * The server copy the engine holds on this device, as stored: `undefined` when the engine has not
 * read the document here yet, `null` when the server says it was deleted.
 */
export type ServerCopyReader = (collection: string, documentId: string) => Promise<Record<string, unknown> | null | undefined>;

/** Fields that record when and how a copy was written, never what the person wrote. */
const BOOKKEEPING = new Set(['updatedAt', 'createdAt', 'rev', '_dataEngine', '_dataEngineOwner']);

const canonical = (value: unknown, top = true): unknown => {
  if (Array.isArray(value)) return value.map(item => canonical(item, false));
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !BOOKKEEPING.has(key) && !(top && key === 'id'))
    .map(key => [key, canonical(value[key], false)]));
};

/**
 * The previous version's read transform, so a cached row and the server copy are compared through
 * the same lens: it kept a sermon's legacy aliases in step (`thoughtsBySection`/`structure`,
 * `draft`/`plan`) and rebuilt a series' `items`, `sermonIds` and `seriesKind` on every read.
 */
function asPreviouslyRead(collection: string, value: Record<string, unknown>): Record<string, unknown> {
  if (collection === 'sermons') return hydrateSermon(value as unknown as Sermon) as unknown as Record<string, unknown>;
  if (collection === 'series') {
    // A malformed `items` or `sermonIds` counts as absent instead of failing the whole archive.
    const stored = Array.isArray(value.items) ? value.items as SeriesItem[] : undefined;
    const sermonIds = Array.isArray(value.sermonIds) ? value.sermonIds.filter((id): id is string => typeof id === 'string') : [];
    const items = normalizeSeriesItems(stored?.filter(item => item && typeof item === 'object'), sermonIds);
    return { ...value, items, sermonIds: deriveSermonIdsFromItems(items), seriesKind: value.seriesKind || inferSeriesKind(items) };
  }
  return value;
}

/** A cached row, or null for an operation or a copy that cannot be read — those are never retired. */
function cachedRow(copy: LegacyQueryCopy): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(copy.raw);
    return object(parsed) && !('mutationKey' in parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * RETIRES ONLY WHAT IS PROVEN TO BE AN ECHO OF THE SERVER.
 *
 * A cached row can hold text the server never received: a council's refused or unsent edit lived
 * only there, and the previous version showed it again and sent it with the next edit. So a row
 * leaves the archive only when it says exactly what the server copy says, read through the same
 * transform; a missing, deleted or unreadable server copy, an operation and an unreadable copy all
 * stay. It runs in its own transaction after listing, so a failure here never hides the archive.
 * Equality with the engine's copy proves the server held this content, not that it still does.
 */
export async function retireLegacyEchoes(owner: string, readServer: ServerCopyReader): Promise<{ retired: number; undecided: number }> {
  if (!owner) return { retired: 0, undecided: 0 };
  // Decided by id AND content: an id freed by another tab can be given to a new copy meanwhile.
  const echoes = new Map<string, string>();
  const servers = new Map<string, ReturnType<ServerCopyReader>>();
  let undecided = 0;
  for (const copy of await listLegacyQueryCopies(owner)) {
    const row = cachedRow(copy);
    if (!row) continue;
    const document = `${copy.collection}/${copy.documentId}`;
    if (!servers.has(document)) servers.set(document, readServer(copy.collection, copy.documentId));
    let server: Awaited<ReturnType<ServerCopyReader>>;
    try { server = await servers.get(document)!; } catch { undecided += 1; continue; }
    if (server === undefined) { undecided += 1; continue; }
    if (server === null) continue;
    let same = false;
    try {
      same = JSON.stringify(canonical(asPreviouslyRead(copy.collection, row)))
        === JSON.stringify(canonical(asPreviouslyRead(copy.collection, server)));
    } catch { undecided += 1; continue; }
    if (same) echoes.set(copy.id, copy.raw);
  }
  if (!echoes.size) return { retired: 0, undecided };
  return { retired: await removeLegacyCopies(owner, [...echoes].map(([id, raw]) => ({ id, raw }))), undecided };
}

/**
 * Removes the named copies — the person chose the server's version, or the copy is a proven echo.
 * A copy leaves only while its stored id AND content are still the ones decided on: an id freed
 * by another tab can meanwhile belong to a new copy. Returns how many were removed.
 */
export function removeLegacyCopies(owner: string, copies: readonly { id: string; raw: string }[]): Promise<number> {
  if (!owner || !copies.length) return Promise.resolve(0);
  const decided = new Map(copies.map(copy => [copy.id, copy.raw]));
  return createEngineStorageTransaction()<number>('readwrite', (store, read, done) => {
    read(store.getAll(engineOwnerRange(ARCHIVE_KIND, owner)), (groups: unknown[]) => {
      let count = 0;
      for (const group of groups.filter(Array.isArray) as LegacyQueryCopy[][]) {
        const kept = group.filter(copy => decided.get(copy.id) !== copy.raw);
        if (kept.length === group.length) continue;
        const key = archiveKey(group[0], owner);
        // A group whose own key cannot be proven stays whole: nothing is removed on a guess.
        if (!key) continue;
        count += group.length - kept.length;
        if (kept.length) store.put(kept, key); else store.delete(key);
      }
      done(count);
    });
  });
}

/** Which side changed last, by the document's own `updatedAt` on each side. */
export type CopyFreshness = 'server-newer' | 'device-newer' | 'same-version' | 'unknown';

export interface LegacyCopyComparison {
  /** A cached document, an operation that never reached the server, or a copy that cannot be read. */
  kind: 'row' | 'operation' | 'unreadable';
  /** `unknown` when the comparison itself failed: nothing is claimed about the server then. */
  server: 'present' | 'missing' | 'deleted' | 'unknown';
  freshness: CopyFreshness;
  /** The version the copy holds (its `updatedAt`), else when this device saved it. */
  deviceVersionAt: string | null;
  serverVersionAt: string | null;
  /** Only the fields that differ, read through the previous version's transform, bookkeeping aside. */
  differences: { field: string; device: unknown; server: unknown }[];
}

const isoOrNull = (value: unknown): string | null => {
  const iso = extractIsoString(value);
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
};

function copyKind(copy: LegacyQueryCopy, row: Record<string, unknown> | null): LegacyCopyComparison['kind'] {
  if (row) return 'row';
  try { JSON.parse(copy.raw); return 'operation'; } catch { return 'unreadable'; }
}

/**
 * When the device date is only when the previous version saved its cache, it proves the server
 * changed after this device last read it — never that the device changed anything later.
 */
function freshnessOf(deviceVersionAt: string | null, serverVersionAt: string | null, savedOnly: boolean): CopyFreshness {
  if (!deviceVersionAt || !serverVersionAt) return 'unknown';
  const device = Date.parse(deviceVersionAt), stored = Date.parse(serverVersionAt);
  if (stored > device) return 'server-newer';
  if (savedOnly) return 'unknown';
  return device > stored ? 'device-newer' : 'same-version';
}

const SERMON_ALIASES = { thoughtsBySection: 'structure', draft: 'plan' } as const;

/** Only the fields that differ, read through the previous version's transform, bookkeeping aside. */
function differencesOf(collection: string, row: Record<string, unknown>, server: Record<string, unknown>): LegacyCopyComparison['differences'] {
  const mine = asPreviouslyRead(collection, row), theirs = asPreviouslyRead(collection, server);
  const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left, false)) === JSON.stringify(canonical(right, false));
  // An alias that repeats its field on both sides is one line, not two. One that drifted apart
  // stays: the previous version read it first on some screens, and any difference the echo check
  // keeps a copy for must be on screen.
  const aliases = collection === 'sermons'
    ? new Set(Object.entries(SERMON_ALIASES).filter(([alias, field]) => same(mine[alias], mine[field]) && same(theirs[alias], theirs[field])).map(([alias]) => alias))
    : new Set<string>();
  return [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort()
    .filter(field => !BOOKKEEPING.has(field) && field !== 'id' && !aliases.has(field) && !same(mine[field], theirs[field]))
    .map(field => ({ field, device: mine[field], server: theirs[field] }));
}

/** What the person needs to decide about one copy: which side is newer and what exactly differs. */
export function compareLegacyCopy(copy: LegacyQueryCopy, server: Record<string, unknown> | null | undefined): LegacyCopyComparison {
  const savedAt = typeof copy.savedAt === 'number' && Number.isFinite(copy.savedAt) ? new Date(copy.savedAt).toISOString() : null;
  const row = cachedRow(copy);
  const ownVersionAt = row ? isoOrNull(row.updatedAt) : null;
  const deviceVersionAt = ownVersionAt ?? savedAt;
  const serverVersionAt = server ? isoOrNull(server.updatedAt) : null;
  let serverState: LegacyCopyComparison['server'] = 'present';
  if (server === undefined) serverState = 'missing';
  else if (server === null) serverState = 'deleted';
  return {
    kind: copyKind(copy, row), server: serverState, freshness: freshnessOf(deviceVersionAt, serverVersionAt, !ownVersionAt), deviceVersionAt, serverVersionAt,
    differences: row && server ? differencesOf(copy.collection, row, server) : [],
  };
}

/** The storage key a copy was filed under, derived from its id and accepted only for this owner. */
function archiveKey(copy: LegacyQueryCopy, owner: string): IDBValidKey | null {
  try {
    const key = (JSON.parse(copy.id) as unknown[]).slice(0, 4);
    return key.length === 4 && key[0] === ARCHIVE_KIND && key[1] === owner
      && key[2] === copy.collection && key[3] === copy.documentId ? key as IDBValidKey : null;
  } catch { return null; }
}
