import { createHash } from 'node:crypto';

import { commandFingerprint, object } from './fieldValues';
import { groupPlacementSteps } from './groupFlowTopology';
import { placementSteps } from './serviceOrderStepPlacement';

import type { DocumentData, EngineMetadata } from './types';

const PROOF = 'retiredGroupTemplates';
const MAX_PROOFS = 64;
const digest = (value: unknown) => createHash('sha256').update(commandFingerprint(value)).digest('base64url');
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{43}$/.test(value);

function readProofs(raw: unknown, generation: string | undefined) {
  const rows = object(raw) && raw.generation === generation && raw[PROOF];
  const proofs = new Map<string, string>();
  if (Array.isArray(rows)) {
    for (const row of rows.slice(-MAX_PROOFS)) {
      if (object(row) && isDigest(row.id) && isDigest(row.template)) proofs.set(row.id, row.template);
    }
  }
  return proofs;
}

export function verifyGroupCopySource(raw: unknown, generation: string | undefined) {
  const proofs = readProofs(raw, generation);
  return (source: DocumentData) => proofs.get(digest(source.id)) === digest(source);
}

/** A bounded digest proves the last actual retirement without retaining the deleted words. */
export function metadataAfterGroupFlowTopology<T extends EngineMetadata | null>(metadata: T, raw: unknown,
  before: Pick<DocumentData, 'flow' | 'templates'> | null, after: DocumentData | null) {
  if (!metadata || !after) return metadata;
  const proofs = readProofs(raw, metadata.generation);
  const oldRows = groupPlacementSteps(before?.flow), newRows = groupPlacementSteps(after.flow);
  const oldTemplates = placementSteps(before?.templates), newTemplates = placementSteps(after.templates);
  if (oldRows && newRows && oldTemplates && newTemplates) {
    const referenced = new Set(oldRows.map(row => row.templateId));
    const live = new Set([...newRows.map(row => row.templateId), ...newTemplates.map(template => template.id)]);
    for (const template of oldTemplates) {
      if (!referenced.has(template.id) || live.has(template.id)) continue;
      const id = digest(template.id);
      proofs.delete(id);
      proofs.set(id, digest(template));
    }
  }
  for (const template of newTemplates ?? []) proofs.delete(digest(template.id));
  return proofs.size ? { ...metadata, [PROOF]: [...proofs].slice(-MAX_PROOFS).map(([id, template]) => ({ id, template })) } : metadata;
}
