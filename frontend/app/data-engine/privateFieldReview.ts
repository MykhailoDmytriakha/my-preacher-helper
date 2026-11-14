import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { UNREADABLE_ROW_PROOF, UNREADABLE_SCALAR_PROOF } from './unreadableDraftProof';

import type { CouncilOutcome } from './councilOutcomeAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail } from './types';

type PrivateValue = string | number | CouncilOutcome | null;

export type PrivateFieldDecision = {
  path: string[];
  birth: string | null;
  mine: PrivateValue;
  stored: PrivateValue;
  side: 'local' | 'remote';
};
export type FieldSelection = Pick<PrivateFieldDecision, 'path' | 'side'>;
export type PrivateField = Omit<PrivateFieldDecision, 'side' | 'birth'> & { birth?: string };

export function isUnreadableField(conflict: ConflictDetail): boolean {
  return conflict.code === UNREADABLE_SCALAR_PROOF || conflict.code === UNREADABLE_ROW_PROOF;
}

export function privateFieldDecision(field: PrivateField, side: PrivateFieldDecision['side']): PrivateFieldDecision {
  return { path: field.path, birth: field.birth ?? null, mine: field.mine, stored: field.stored, side };
}

export function readPrivateFieldReview<Field extends PrivateField>(checkpoint: SessionCheckpoint,
  read: (checkpoint: SessionCheckpoint, path: string[]) => Field | undefined,
  normalizePath = (path: string[], _conflict?: ConflictDetail) => path) {
  const { confirmed, draft, remoteCandidate, conflicts, pending, privateFieldReview } = checkpoint;
  if (!confirmed.value || !draft || !remoteCandidate?.value || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate.metadata?.generation || Object.keys(pending).length
    || !conflicts.some(isUnreadableField) || conflicts.some(conflict => conflict.code && !isUnreadableField(conflict))) return undefined;
  const merged = mergeDocumentFields(confirmed.value, draft, remoteCandidate.value);
  const paths = new Map([...conflicts, ...merged.conflicts].map(conflict => {
    const normalized = normalizePath(conflict.path, conflict);
    return [JSON.stringify(normalized), normalized];
  }));
  const fields = [...paths.values()].map(path => read(checkpoint, path));
  if (fields.some(field => !field)) return undefined;
  const compared = fields.filter((field): field is Field => Boolean(field && !equalValues(field.mine, field.stored)));
  if (!compared.length) return undefined;
  const revision = remoteCandidate.metadata.revision;
  const decisions = privateFieldReview?.revision === revision ? privateFieldReview.decisions.filter(decision =>
    compared.some(field => equalValues(decision, privateFieldDecision(field, decision.side)))) : [];
  const remaining = compared.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { fields: compared, decisions, remaining, merged, stored: remoteCandidate.value, revision };
}
