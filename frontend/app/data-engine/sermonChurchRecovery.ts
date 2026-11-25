import { churchFieldWords, isSermonChurch } from './churchFieldValue';
import { captureSermonRecoveryChurch, type SermonChurchObservation } from './documentFieldAction';
import { equalValues, readField, writeField } from './fieldValues';
import { fillExistingSermonDate, type SermonChurchFill } from './sermonChurchFill';
import { hasUnreadableSermonChurch } from './unreadableDraftProof';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue, ResourceSnapshot } from './types';

export type SermonChurchRecovery = { generation: string; observation?: SermonChurchObservation; fill?: SermonChurchFill };

const churchPath = ['church'];
const datesPath = ['preachDates'];

function projectedChurch(opening: DocumentData, church: FieldValue, fill?: SermonChurchFill): DocumentData | undefined {
  if (!isSermonChurch(church)) return;
  const next = writeField(opening, churchPath, church);
  if (!fill) return next;
  if (!equalValues(church, { exists: true, value: fill.church })) return;
  const dates = fillExistingSermonDate(opening.preachDates, fill);
  return dates === undefined ? undefined : { ...next, preachDates: dates };
}

export function validSermonChurchRecovery({ confirmed, draft }: Pick<SessionCheckpoint, 'confirmed' | 'draft'>,
  recovery: SermonChurchRecovery): boolean {
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || !draft
    || confirmed.metadata?.generation !== recovery.generation || confirmed.metadata.deleted
    || equalValues(confirmed.value, draft)) return false;
  const church = readField(draft, churchPath);
  if (!equalValues(projectedChurch(confirmed.value, church, recovery.fill), draft)) return false;
  if (!recovery.observation) return true;
  const { reviewed: _reviewed, ...stamp } = recovery.observation;
  return equalValues(captureSermonRecoveryChurch(confirmed, draft, stamp.time), stamp);
}

export function recoverableSermonChurchAfterRefusal(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const generation = confirmed.metadata?.generation;
  const opening = confirmed.value;
  const first = source.pending[chain[0]?.id]?.value;
  const saved = projected.confirmed.value;
  const last = chain.at(-1)?.value;
  if (!generation || !opening || !draft || !first || !last || !saved) return;
  const base = readField(opening, churchPath), mine = readField(draft, churchPath), stored = readField(saved, churchPath);
  if (![base, mine, stored].every(isSermonChurch) || equalValues(base, mine)
    || !equalValues(base, readField(first, churchPath)) || !equalValues(mine, readField(last, churchPath))) return;

  const save = chain.findLast((request, index) => {
    const previous = index && chain[index - 1].value;
    return previous && request.value && !equalValues(readField(previous, churchPath), readField(request.value, churchPath));
  });
  if (!save || save.baseline.metadata?.generation !== generation) return;
  const fill = save.sermonChurchFill;
  const value = projectedChurch(opening, mine, fill);
  // The witness covers an inferred value on an existing date. A scheduled or rescheduled day owns its own Save.
  if (!value || (fill && (![draft, last, save.value].every(copy => copy && equalValues(readField(copy, datesPath), readField(value, datesPath)))
    || !equalValues(readField(opening, datesPath), readField(first, datesPath))))) return;

  const continuation: SessionCheckpoint = {
    confirmed, draft: value, editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
  };
  const witnessed = save.baseline.value && save.baseline.metadata.revision === confirmed.metadata?.revision
    && equalValues(readField(save.baseline.value, churchPath), base) ? save.sermonChurchAction : undefined;
  const recovery = { generation, fill, observation: witnessed };
  if (!witnessed || !validSermonChurchRecovery(continuation, recovery)) {
    delete recovery.observation;
    continuation.unreadableScalarProof = ['church'];
  }
  continuation.sermonChurchRecovery = recovery;
  return {
    continuation, fill,
    restoreStored: (document: DocumentData) => {
      const neutral = writeField(document, churchPath, stored);
      return fill ? writeField(neutral, datesPath, readField(saved, datesPath)) : neutral;
    },
  };
}

export function sermonChurchDraft(checkpoint: SessionCheckpoint) {
  if ((!checkpoint.sermonChurchRecovery && !hasUnreadableSermonChurch(checkpoint)) || !checkpoint.draft) return;
  return { field: 'church' as const, preview: churchFieldWords(checkpoint.draft.church) ?? '' };
}

export function readRecoveredSermonChurch(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  const generation = confirmed.metadata?.generation;
  if (!hasUnreadableSermonChurch(checkpoint) || !draft || !remoteCandidate?.value || !generation
    || remoteCandidate.metadata?.generation !== generation || conflicts.length !== 1) return;
  const { path, mine, theirs } = conflicts[0];
  if (!equalValues(path, churchPath) || !isSermonChurch(theirs) || !equalValues(theirs, readField(remoteCandidate.value, churchPath))
    || !equalValues(mine, readField(draft, churchPath))) return;
  const recovery = checkpoint.sermonChurchRecovery ?? { generation };
  if (!validSermonChurchRecovery(checkpoint, recovery)) return;
  const fill = recovery.fill;
  const fillsPlannedEntry = Boolean(fill && fillExistingSermonDate(remoteCandidate.value.preachDates, fill) !== undefined);
  return { mine, stored: theirs, fill, fillsPlannedEntry,
    identity: JSON.stringify([mine, theirs, fill, remoteCandidate.metadata, checkpoint.editGeneration]) };
}

export function chooseRecoveredSermonChurch(confirmed: ResourceSnapshot, comparison: NonNullable<ReturnType<typeof readRecoveredSermonChurch>>,
  side: 'local' | 'remote', time: ActionTime | null): { draft: DocumentData; recovery?: SermonChurchRecovery } {
  const { value, metadata } = confirmed;
  if (!value || !metadata || metadata.deleted) throw Object.assign(new Error('The sermon changed'), { code: 'decision-changed' });
  if (side === 'remote') return { draft: value };
  const fill = comparison.fill && fillExistingSermonDate(value.preachDates, comparison.fill) !== undefined ? comparison.fill : undefined;
  const draft = projectedChurch(value, comparison.mine, fill);
  if (!draft) throw Object.assign(new Error('The compared church changed'), { code: 'decision-changed' });
  if (equalValues(value, draft)) return { draft };
  const observation = captureSermonRecoveryChurch(confirmed, draft, time);
  if (!observation && !equalValues(comparison.mine, comparison.stored)) {
    throw Object.assign(new Error('The church choice could not be captured'), { code: 'decision-changed' });
  }
  return { draft, recovery: { generation: metadata.generation, fill, ...(observation && { observation: { ...observation, reviewed: true } }) } };
}
