import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { UNREADABLE_ROW_PROOF, UNREADABLE_SCALAR_PROOF } from './unreadableDraftProof';

import type { CouncilOutcome } from './councilOutcomeAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData } from './types';

type PrivateValue = string | number | CouncilOutcome | null;

export type PrivateFieldDecision = {
  path: string[];
  birth: string | null;
  mine: PrivateValue;
  stored: PrivateValue;
  side: 'local' | 'remote';
  removedBy?: 'local' | 'remote';
};
export type FieldSelection = Pick<PrivateFieldDecision, 'path' | 'side'>;
export type PrivateField = Omit<PrivateFieldDecision, 'side' | 'birth'> & { birth?: string };

export function isUnreadableField(conflict: ConflictDetail): boolean {
  return conflict.code === UNREADABLE_SCALAR_PROOF || conflict.code === UNREADABLE_ROW_PROOF;
}

export function privateFieldDecision(field: PrivateField, side: PrivateFieldDecision['side']): PrivateFieldDecision {
  return { path: field.path, birth: field.birth ?? null, mine: field.mine, stored: field.stored, side,
    ...(field.removedBy && { removedBy: field.removedBy }) };
}

export function privateFieldsForPaths<Field extends PrivateField>(
  conflicts: readonly ConflictDetail[], read: (path: string[]) => Field | undefined,
  normalizePath = (path: string[], _conflict: ConflictDetail) => path,
) {
  const paths = new Map(conflicts.map(conflict => {
    const normalized = normalizePath(conflict.path, conflict);
    return [JSON.stringify(normalized), normalized];
  }));
  return [...paths.values()].map(read);
}

export function readPrivateFieldReview<Field extends PrivateField>(
  checkpoint: SessionCheckpoint,
  readFields: (conflicts: readonly ConflictDetail[], merged: DocumentData) => (Field | undefined)[],
  merge = mergeDocumentFields,
) {
  const { confirmed, draft, remoteCandidate, conflicts, pending, privateFieldReview } = checkpoint;
  if (!confirmed.value || !draft || !remoteCandidate?.value || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate.metadata?.generation || Object.keys(pending).length
    || !conflicts.some(isUnreadableField) || conflicts.some(conflict => conflict.code && !isUnreadableField(conflict))) return undefined;
  const merged = merge(confirmed.value, draft, remoteCandidate.value);
  if (!merged.value.exists) return undefined;
  const fields = readFields([...conflicts, ...merged.conflicts], merged.value.value as DocumentData);
  if (fields.some(field => !field)) return undefined;
  const compared = fields.filter((field): field is Field => Boolean(field && (field.removedBy || !equalValues(field.mine, field.stored))));
  if (!compared.length) return undefined;
  const revision = remoteCandidate.metadata.revision;
  const decisions = privateFieldReview?.revision === revision ? privateFieldReview.decisions.filter(decision =>
    compared.some(field => equalValues(decision, privateFieldDecision(field, decision.side)))) : [];
  const remaining = compared.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { fields: compared, decisions, remaining, merged, stored: remoteCandidate.value, revision };
}
