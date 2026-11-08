import { equalValues } from './protocol';

import type { EditorRecord } from './controller';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

/** The saved work a mounted document editor can speak for on its screen. A derived local view only. */
export interface CoveredSavedAnswer {
  readonly id: string;
  readonly operationIds: readonly string[];
  readonly draft: Readonly<DocumentData> | null;
}

export interface CouncilRefusalCoverage {
  readonly confirmed: ResourceSnapshot;
  readonly remoteCandidate: ResourceSnapshot | null;
  readonly equivalent?: { readonly confirmed: ResourceSnapshot; readonly draft: DocumentData | null };
}

export interface OpenDocumentAnswer {
  readonly owner: string;
  readonly resource: ResourceRef;
  readonly operationIds: readonly string[];
  readonly draft: Readonly<DocumentData> | null;
  readonly laterSaves?: readonly CoveredSavedAnswer[];
  readonly councilRefusal?: CouncilRefusalCoverage;
}

/** A carry can refresh the council's update time while preserving the earlier authored fields. */
function sameCouncilWords(a: Readonly<DocumentData> | null, b: Readonly<DocumentData> | null): boolean {
  if (!a || !b) return false;
  const { updatedAt: _aUpdatedAt, ...aWords } = a;
  const { updatedAt: _bUpdatedAt, ...bWords } = b;
  return equalValues(aWords, bWords);
}

function holdsCouncilRefusal(record: EditorRecord, answer: OpenDocumentAnswer, proof: CouncilRefusalCoverage): boolean {
  const { confirmed, remoteCandidate, draft } = record.checkpoint;
  // The inline choice cannot speak for a different stored version observed only in the other editor.
  if (remoteCandidate && !equalValues(remoteCandidate, proof.remoteCandidate ?? proof.confirmed)) return false;
  return (equalValues(confirmed, proof.confirmed) && sameCouncilWords(draft, answer.draft))
    || Boolean(proof.equivalent && equalValues(confirmed, proof.equivalent.confirmed)
      && sameCouncilWords(draft, proof.equivalent.draft));
}

function sameDocument(record: EditorRecord, answer: OpenDocumentAnswer): boolean {
  const { resource } = record.checkpoint.confirmed;
  return answer.owner === record.owner && answer.resource.collection === resource.collection && answer.resource.id === resource.id;
}

/** The open council owns the shared refusal even when other saved copies contain different words. */
export function councilRefusalHeldOpen(records: readonly EditorRecord[], answers: readonly OpenDocumentAnswer[]): boolean {
  return records.length > 0 && answers.some(answer => {
    const proof = answer.councilRefusal;
    if (!proof || answer.operationIds.length !== 1) return false;
    return records.every(record => {
      const { confirmed, pending, remoteCandidate } = record.checkpoint;
      const [id, ...otherIds] = Object.keys(pending);
      return sameDocument(record, answer) && id === answer.operationIds[0] && !otherIds.length
        && !record.prepared && !record.unfinalized.length
        && (equalValues(confirmed, proof.confirmed) || equalValues(confirmed, proof.equivalent?.confirmed))
        && (!remoteCandidate || equalValues(remoteCandidate, proof.remoteCandidate ?? proof.confirmed));
    });
  });
}

/** An address or a shared request alone cannot stand for unseen words in another checkpoint. */
export function recoveryHeldOpen(records: readonly EditorRecord[], answers: readonly OpenDocumentAnswer[]): boolean {
  return records.length > 0 && records.every(record => {
    const ids = Object.keys(record.checkpoint.pending);
    return ids.length > 0 && answers.some(answer => {
      if (!sameDocument(record, answer)) return false;
      if (ids.every(id => answer.operationIds.includes(id))) {
        if (answer.councilRefusal && ids.length === 1 && answer.operationIds.length === 1) {
          return holdsCouncilRefusal(record, answer, answer.councilRefusal);
        }
        if (equalValues(answer.draft, record.checkpoint.draft)) return true;
      }
      return answer.laterSaves?.some(save => ids.includes(save.id) && ids.every(id => save.operationIds.includes(id))
        && equalValues(save.draft, record.checkpoint.draft)) ?? false;
    });
  });
}
