import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isClosedToLegacyWriters, isCollectionServed } from './activation';
import { assertLegacyWritable, isDataEngineRequired, listOwnedDocuments, mutateLegacyResource, updateLegacyResource } from './legacyBoundary.server';
import { diffFields } from './protocol';

import type { DocumentData, ResourceRef } from './types';

/**
 * A TRUSTED SERVER WRITER ON A DOCUMENT THE ENGINE OWNS.
 *
 * Transcription, AI results and audio are computed on the server and land in the person's
 * document. On a legacy document they keep their legacy write. On a document the engine owns,
 * that write is refused (legacyBoundary.server.ts), and the feature used to disappear with it.
 * Here the server becomes one more client of the same door: it sends an ordinary update command
 * through processCommand, so the revision, the change feed and the receipt move exactly as they
 * do for a browser save, and an open editor merges the result like any remote edit.
 *
 * The change is a function of the CURRENT document, not a value computed from an earlier read:
 * appending a thought or storing insights is re-applied to a fresh copy when a competing edit
 * of the same field wins the race. A full replacement of what the person wrote (a sorted
 * structure, a generated plan over a manual one) does not belong here — that is a reviewed
 * proposal through the editor's form.
 */
const ATTEMPTS = 3;
const ENGINE_MARKER = '_dataEngine';

export class ServerEditError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

const marked = (raw: DocumentData | Record<string, unknown> | undefined): boolean =>
  Boolean(raw && Object.prototype.hasOwnProperty.call(raw, ENGINE_MARKER));

/** Whether this deployment routes a server write to this document through the engine. */
export function writesThroughEngine(raw: Record<string, unknown> | undefined, collection: string): boolean {
  return isCollectionServed(collection) && (marked(raw) || isClosedToLegacyWriters(collection));
}

/**
 * The early check a route makes before paying for AI work. A document the engine owns is
 * writable here when this deployment serves its collection; everything else keeps the legacy rule.
 */
export function assertServerWritable(raw: Record<string, unknown> | undefined, collection: string): void {
  if (writesThroughEngine(raw, collection)) return;
  assertLegacyWritable(raw as DocumentData | undefined, collection);
}

/** Applies `mutate` to the current document through the engine and returns the accepted value. */
export async function editOwnedDocument(owner: string, resource: ResourceRef,
  mutate: (current: DocumentData) => DocumentData): Promise<DocumentData> {
  // Loaded on use, like the legacy bridge: a route that never meets an engine document keeps
  // its light module graph.
  const { processCommand, readDocument } = await import('./server');
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const current = await readDocument(owner, resource);
    if (!current.value) throw new ServerEditError('not-found', 404);
    const next = mutate(JSON.parse(JSON.stringify(current.value)) as DocumentData);
    const changes = diffFields(current.value, next);
    if (!changes.length) return current.value;
    const result = await processCommand(owner, {
      protocol: 1, operationId: randomUUID(), owner, resource,
      generation: current.metadata?.generation ?? null, dependsOn: [], kind: 'update', changes,
    });
    if (result.kind === 'acknowledged') return result.snapshot.value ?? next;
    if (result.kind === 'deleted') throw new ServerEditError('not-found', 404);
    if (result.kind === 'refused') throw new ServerEditError(result.code, 409);
    // A competing edit of the same field won: read again and re-apply to the newer copy.
  }
  throw new ServerEditError('conflict', 409);
}

/**
 * One server write, either road. The legacy write runs first because it re-reads the document
 * inside its own transaction; a document that turned engine-owned after the route's early read
 * refuses there, and the same change then goes through the engine instead of failing.
 * Resolves to the accepted engine document, or null when the legacy road took the write.
 */
export async function writeOwnedDocument(options: {
  owner: string;
  resource: ResourceRef;
  legacy: () => Promise<void>;
  engine: (current: DocumentData) => DocumentData;
}): Promise<DocumentData | null> {
  const { owner, resource, legacy, engine } = options;
  if (!isClosedToLegacyWriters(resource.collection)) {
    try {
      await legacy();
      return null;
    } catch (error) {
      if (!isDataEngineRequired(error) || !isCollectionServed(resource.collection)) throw error;
    }
  }
  return editOwnedDocument(owner, resource, engine);
}

/**
 * The same flat patch a legacy writer sends (`field` or `parent.child` keys, plain values), laid
 * over the current document. `rev` counters are left out: the engine advances them itself
 * (protocol.ts, advanceResourceSnapshot). A Firestore sentinel has no plain meaning here and is refused.
 */
export function applyLegacyPatch(current: DocumentData, patch: Record<string, unknown>): DocumentData {
  const next = JSON.parse(JSON.stringify(current)) as DocumentData;
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split('.');
    if (path[0] === 'rev') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new ServerEditError('unsupported-server-patch', 500);
    }
    let parent: Record<string, unknown> = next;
    for (const segment of path.slice(0, -1)) {
      const child = parent[segment];
      parent[segment] = child !== null && typeof child === 'object' && !Array.isArray(child) ? { ...child as object } : {};
      parent = parent[segment] as Record<string, unknown>;
    }
    const leaf = path[path.length - 1];
    if (value === undefined) delete parent[leaf];
    else parent[leaf] = JSON.parse(JSON.stringify(value));
  }
  return next;
}

/** A legacy writer's flat patch, taken by whichever road owns the document now. */
export async function updateOwnedDocument(owner: string, resource: ResourceRef, patch: Record<string, unknown>): Promise<DocumentData | null> {
  return writeOwnedDocument({
    owner, resource,
    legacy: () => updateLegacyResource(resource, patch as DocumentData),
    engine: current => applyLegacyPatch(current, patch),
  });
}

/** The route answer for a server write the engine did not accept; null for any other error. */
export function serverEditResponse(error: unknown): NextResponse | null {
  return error instanceof ServerEditError ? NextResponse.json({ code: error.code, error: error.code }, { status: error.status }) : null;
}

const carriesTag = (thoughts: unknown, name: string): boolean =>
  Array.isArray(thoughts) && thoughts.some(thought => Boolean(thought) && Array.isArray((thought as { tags?: unknown }).tags)
    && ((thought as { tags: unknown[] }).tags).includes(name));
const withoutTag = (thoughts: DocumentData[], name: string): DocumentData[] => thoughts.map(thought => Array.isArray(thought.tags) && thought.tags.includes(name)
  ? { ...thought, tags: thought.tags.filter(tag => tag !== name) } : thought);

/**
 * A DELETED TAG LEAVES EVERY THOUGHT, ONE SERMON AT A TIME.
 *
 * Removing a name is idempotent, so the cascade needs no single transaction: it lists the
 * owner's sermons once and rewrites only those that carry the tag, each on its own road — a
 * legacy sermon by a legacy transaction that recomputes from the document as read, an engine
 * sermon by an ordinary update command. The engine used to fold this into the tag's own
 * relation transaction, bounded at 100 documents, and so refused to delete a tag for anyone
 * with a hundred sermons; production never had that ceiling. Resolves to the sermons changed.
 */
export async function removeTagFromSermons(owner: string, name: string): Promise<number> {
  let changed = 0;
  for (const { id, data } of await listOwnedDocuments(owner, 'sermons')) {
    if (!carriesTag(data.thoughts, name)) continue;
    await writeOwnedDocument({
      owner, resource: { collection: 'sermons', id },
      legacy: () => mutateLegacyResource({ collection: 'sermons', id }, raw => raw?.userId === owner && carriesTag(raw.thoughts, name)
        ? { thoughts: withoutTag(raw.thoughts as DocumentData[], name) } : null, 'thoughts'),
      engine: current => carriesTag(current.thoughts, name) ? { ...current, thoughts: withoutTag(current.thoughts as DocumentData[], name) } : current,
    });
    changed += 1;
  }
  return changed;
}
