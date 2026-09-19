'use client';

import { isCollectionOnEngine } from './clientPolicy';

import type { ResourceRef } from './types';

export interface LegacyRecoverySource {
  /** Exact localStorage identity; discovery never removes or rewrites this key. */
  id: string;
  kind: 'outbox' | 'draft';
  owner: string;
  resource: ResourceRef | null;
  documentId: string;
  aggregate: string;
  savedAt: number | null;
  status: string | null;
  /** Complete original JSON, including baselines and unknown legacy fields. */
  raw: string;
  payload: unknown;
  importable: false;
  reason: 'incomplete-original-document';
}

interface DiscoveryOptions {
  resource?: ResourceRef;
  /** Draft v1 omits collection; only its owning feature can supply that mapping. */
  draftAggregates?: readonly string[];
  storage?: Pick<Storage, 'length' | 'key' | 'getItem'>;
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * No v1 format proves a complete original document. expectedBaseline contains
 * written fields; merge.base contains an outline, scratch, arrangement, or two
 * aggregates; draft.value has no baseline. Passing a resource schema cannot prove
 * that omitted optional fields were absent. Publishing any of these as a normal
 * confirmed snapshot would replace a complete cache with partial data.
 *
 * Discovery is read-only. Callers may preview/export or explicitly create a new
 * document, but must not bind old intent to a fresh server baseline automatically.
 */
export function discoverLegacyRecovery(owner: string, options: DiscoveryOptions = {}): LegacyRecoverySource[] {
  if (!owner || owner.includes(':')) throw new Error('Ambiguous legacy owner identity');
  const storage = options.storage ?? window.localStorage;
  const sources: LegacyRecoverySource[] = [];
  const draftPrefix = `draft:v1:${owner}:`;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || (!key.startsWith('outbox:v1:') && !key.startsWith('membershipOutbox:v2:') && !key.startsWith(draftPrefix))) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { continue; }
    if (!object(payload)) continue;
    const source = identifySource(key, payload, owner, draftPrefix, options);
    if (!source) continue;
    sources.push({ ...source, id: key, owner, raw, payload, savedAt: typeof payload.savedAt === 'number' && Number.isFinite(payload.savedAt) ? payload.savedAt : null,
      importable: false, reason: 'incomplete-original-document' });
  }
  return sources.sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0) || a.id.localeCompare(b.id));
}

/** The exported bytes are the stored bytes, not a reconstructed partial patch. */
export function exportLegacyRecovery(source: LegacyRecoverySource, owner: string): string {
  if (source.owner !== owner) throw new Error('Legacy recovery ownership mismatch');
  return source.raw;
}

type SourceIdentity = Pick<LegacyRecoverySource, 'kind' | 'resource' | 'documentId' | 'aggregate' | 'status'>;

function identifySource(key: string, payload: Record<string, unknown>, owner: string, draftPrefix: string, options: DiscoveryOptions): SourceIdentity | null {
  if (key.startsWith('outbox:v1:')) return outboxSource(key, payload, owner, options.resource);
  if (key.startsWith('membershipOutbox:v2:')) return membershipSource(key, payload, owner, options.resource);
  return draftSource(key.slice(draftPrefix.length), payload, options);
}

function outboxSource(key: string, payload: Record<string, unknown>, owner: string, requested?: ResourceRef): SourceIdentity | null {
  if (payload.uid !== owner || typeof payload.id !== 'string' || key !== `outbox:v1:${payload.id}`
    || typeof payload.collection !== 'string' || typeof payload.docId !== 'string' || typeof payload.aggregate !== 'string') return null;
  const resource = { collection: payload.collection, id: payload.docId };
  if (requested && (resource.collection !== requested.collection || resource.id !== requested.id)) return null;
  return { kind: 'outbox', resource, documentId: resource.id, aggregate: payload.aggregate, status: typeof payload.status === 'string' ? payload.status : null };
}

function draftSource(remainder: string, payload: Record<string, unknown>, options: DiscoveryOptions): SourceIdentity | null {
  if (!Object.prototype.hasOwnProperty.call(payload, 'value')) return null;
  const separator = remainder.indexOf(':');
  if (separator <= 0 || separator === remainder.length - 1) return null;
  const documentId = remainder.slice(0, separator);
  const aggregate = remainder.slice(separator + 1);
  if (options.resource && (options.resource.id !== documentId || !options.draftAggregates?.includes(aggregate))) return null;
  return { kind: 'draft', resource: options.resource ?? null, documentId, aggregate, status: null };
}


/** v2 retained individual transforms, not original action boundaries or baselines. */
function membershipSource(key: string, payload: Record<string, unknown>, owner: string, requested?: ResourceRef): SourceIdentity | null {
  if (payload.uid !== owner || typeof payload.id !== 'string' || key !== `membershipOutbox:v2:${payload.id}`
    || !object(payload.transform) || typeof payload.transform.seriesId !== 'string' || !payload.transform.seriesId) return null;
  const resource = { collection: 'series', id: payload.transform.seriesId };
  if (requested && (requested.collection !== resource.collection || requested.id !== resource.id)) return null;
  return { kind: 'outbox', resource, documentId: resource.id, aggregate: 'membership', status: isCollectionOnEngine('series') ? 'migration-required' : null };
}
