import { createHash } from 'node:crypto';

import { commandFingerprint, equalValues, object } from './fieldValues';
import { proofRevision } from './rowFieldAction';
import { thoughtOutlineDestinations } from './thoughtPlacementAction';

import type { ThoughtLocation, ThoughtOutlineDestination } from './thoughtPlacementAction';
import type { ResourceSnapshot } from './types';

type Destinations = ReturnType<typeof thoughtOutlineDestinations>;
type Prior = { location: string; section: ThoughtOutlineDestination['section'] };
type Transition = { node: string; revision: number; prior: Prior | null };
type Tracking = { floor: number; head: string; transitions: Transition[] };
const limit = 64;
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
const digest = (value: unknown) => createHash('sha256').update(commandFingerprint(value)).digest('base64url');

function fingerprint(destinations: Destinations): string {
  const ordered = [...destinations].sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
  return digest(ordered);
}

function validPrior(value: unknown): value is Transition['prior'] {
  return value === null || (object(value) && isDigest(value.location)
    && (value.section === 'introduction' || value.section === 'main' || value.section === 'conclusion'));
}

function readTracking(raw: unknown, destinations: Destinations, revision: number): Tracking | undefined {
  const tracking = object(raw) ? raw.outlineMoveProof : undefined;
  const head = fingerprint(destinations);
  if (!object(tracking) || tracking.head !== head || !proofRevision(tracking.floor)
    || tracking.floor > revision || !Array.isArray(tracking.transitions) || tracking.transitions.length > limit) return;
  const floor = tracking.floor;
  const transitions: Transition[] = [];
  let precedingRevision = floor;
  for (const item of tracking.transitions) {
    if (!object(item) || !isDigest(item.node) || !proofRevision(item.revision) || item.revision <= floor
      || item.revision < precedingRevision || item.revision > revision || !validPrior(item.prior)) return;
    transitions.push({ node: item.node, revision: item.revision, prior: item.prior });
    precedingRevision = item.revision;
  }
  return { floor, head, transitions };
}

/** Record only accepted changes to node identities, in the same transaction as the outline. */
export function metadataAfterOutlineMoves(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined) {
  const metadata = snapshot.metadata;
  if (!metadata || !snapshot.value || snapshot.resource.collection !== 'sermons') return metadata;
  const current = thoughtOutlineDestinations(snapshot.value.outline);
  const head = fingerprint(current);
  const previous = thoughtOutlineDestinations(raw?.outline);
  const old = raw?._dataEngine;
  const sameGeneration = object(old) && old.generation === metadata.generation
    && proofRevision(old.revision) && old.revision + 1 === metadata.revision;
  const tracked = sameGeneration ? readTracking(old, previous, metadata.revision - 1) : undefined;
  // If an external writer changed the topology without an engine revision, older observations are ambiguous.
  if (!sameGeneration || (object(old) && old.outlineMoveProof !== undefined && !tracked)) {
    return { ...metadata, outlineMoveProof: { floor: metadata.revision, head, transitions: [] } };
  }
  const transitions = [...(tracked?.transitions ?? [])];
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const prior = previous.get(id) ?? null;
    if (!equalValues(prior, current.get(id) ?? null)) transitions.push({
      node: digest(id), revision: metadata.revision,
      prior: prior ? { location: digest(prior.location), section: prior.section } : null,
    });
  }
  const floor = Math.max(tracked?.floor ?? metadata.revision - 1, transitions.at(-limit - 1)?.revision ?? 0);
  return { ...metadata, outlineMoveProof: { floor, head, transitions: transitions.filter(item => item.revision > floor) } };
}

export function outlineMoveProof(raw: unknown, destinations: Destinations, revision: number) {
  const tracking = readTracking(raw, destinations, revision);
  return (location: ThoughtLocation, observedRevision: number) => {
    const id = location.subPointId ?? location.outlinePointId;
    const destination = id ? destinations.get(id) : undefined;
    if (!id || !destination || !tracking || observedRevision < tracking.floor) return;
    const node = digest(id);
    const moves = tracking.transitions.filter(transition => transition.node === node && transition.revision > observedRevision);
    // An introduction, replacement or ambiguous interval breaks identity continuity.
    if (moves.some(transition => !transition.prior)) return;
    const original = moves[0]?.prior ?? { location: digest(destination.location), section: destination.section };
    return original.location === digest(location) ? { original, destination } : undefined;
  };
}
