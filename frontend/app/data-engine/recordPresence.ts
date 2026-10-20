import { canReplaceSnapshot } from './snapshotFreshness';

import type { CollectionState } from './collections';
import type { Observation } from './observer';
import type { ResourceRef, ResourceSnapshot } from './types';

/** A query result about this exact snapshot, never an editor baseline or a write target. */
export type RecordPresence =
  | { kind: 'present'; source: 'server' | 'cache'; snapshot: ResourceSnapshot }
  | { kind: 'absent'; source: 'server'; snapshot: ResourceSnapshot }
  | { kind: 'creating' | 'deleting'; source: 'local'; snapshot: ResourceSnapshot }
  | { kind: 'unknown'; source: 'cache' | null; snapshot: ResourceSnapshot | null };

export const UNKNOWN_RECORD_PRESENCE: RecordPresence = { kind: 'unknown', source: null, snapshot: null };

const matches = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

/** The observation's own snapshot is authoritative; a separately persisted editor may still lag it. */
export function documentRecordPresence(resource: ResourceRef, observation: Observation,
  intent?: Extract<RecordPresence, { source: 'local' }>, accepted: readonly ResourceSnapshot[] = []): RecordPresence {
  if (intent && matches(intent.snapshot.resource, resource)) return intent;
  let snapshot = observation.snapshot;
  let server = observation.source === 'server' && observation.readiness === 'server' && !observation.error;
  for (const answer of accepted) {
    if (matches(answer.resource, resource) && canReplaceSnapshot(snapshot ?? undefined, answer)) {
      snapshot = answer; server = true;
    }
  }
  if (!snapshot || !matches(snapshot.resource, resource)) return UNKNOWN_RECORD_PRESENCE;
  if (snapshot.value !== null) return { kind: 'present', source: server ? 'server' : 'cache', snapshot };
  return server ? { kind: 'absent', source: 'server', snapshot } : { kind: 'unknown', source: 'cache', snapshot };
}

/** Confirmed rows prove existence; only a complete server answer proves an unlisted identity absent. */
export function collectionRecordPresence(resource: ResourceRef, state: CollectionState | null): RecordPresence {
  if (!state || state.snapshots.some(row => row.resource.collection !== resource.collection)) return UNKNOWN_RECORD_PRESENCE;
  const row = state.documents?.find(row => matches(row.resource, resource));
  const listed = state.snapshots.find(row => matches(row.resource, resource));
  const accepted = row?.acknowledged;
  const acknowledged = accepted && matches(accepted.resource, resource) && canReplaceSnapshot(listed, accepted);
  const snapshot = acknowledged ? accepted : listed;
  if (row?.pending && (row.creating || row.deleting)) return {
    kind: row.creating ? 'creating' : 'deleting', source: 'local',
    snapshot: snapshot ?? { resource, value: row.value, metadata: null },
  };
  const server = state.freshness === 'server' && !state.error;
  if (snapshot?.value) return { kind: 'present', source: server || acknowledged ? 'server' : 'cache', snapshot };
  if (acknowledged || server && state.complete) return {
    kind: 'absent', source: 'server', snapshot: snapshot ?? { resource, value: null, metadata: null },
  };
  return snapshot ? { kind: 'unknown', source: 'cache', snapshot } : UNKNOWN_RECORD_PRESENCE;
}
