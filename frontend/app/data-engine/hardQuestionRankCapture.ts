import { ACTION_SLOT, editorIdentity } from './editorIdentity';
import { hardQuestionEffectiveRankScope, hardQuestionRankOpening, type CapturedHardQuestionRankWitness, type HardQuestionRankChange,
  type HardQuestionRankScope, type HardQuestionRankWitness } from './hardQuestionRankOrder';
import { equalValues } from './protocol';
import { pinSavedDocument } from './savedDocumentPin';
import { DataSession } from './session';

import type { AtomicCapture, CommitRequest } from './commits';
import type { ResourceSnapshot } from './types';

const changedOrder = () => Object.assign(new Error('The order or placement changed before the move could be saved'),
  { code: 'hard-question-order-changed' });

function latestCapture(pending: ReturnType<DataSession['checkpoint']>['pending']): string | null {
  return Object.entries(pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
}

export function captureHardQuestionRankWitness(owner: string, anchor: HardQuestionRankWitness, snapshot: ResourceSnapshot,
  requests: readonly CommitRequest[]): CapturedHardQuestionRankWitness {
  const matches = (value: ResourceSnapshot['value']) => Boolean(value && value.userId === owner
    && equalValues(hardQuestionRankOpening(value), anchor.opening));
  const generation = snapshot.metadata?.generation ?? null;
  if (!snapshot.metadata?.deleted && matches(snapshot.value)) return { ...anchor, generation };
  const pinned = pinSavedDocument(owner, snapshot, requests);
  const requestId = latestCapture(pinned.pending);
  const previous = requestId && requests.find(request => request.id === requestId);
  if (!previous || pinned.confirmed.metadata?.deleted || pinned.conflicts.length || !matches(pinned.draft)) throw changedOrder();
  return { ...anchor, generation: pinned.confirmed.metadata?.generation ?? null,
    predecessor: previous.id };
}

/** One exact list opening, including rows already captured locally but awaiting their receipts. */
export function captureHardQuestionRanks(owner: string, actionId: string, changes: readonly HardQuestionRankChange[],
  snapshots: readonly ResourceSnapshot[], requests: readonly CommitRequest[]): AtomicCapture[] {
  return changes.map(({ id, rank, opening }, index) => {
    const snapshot = snapshots[index];
    const pinned = pinSavedDocument(owner, snapshot, requests);
    if (snapshot.resource.id !== id || !pinned.draft || pinned.draft.userId !== owner
      || pinned.confirmed.metadata?.deleted || pinned.conflicts.length || !equalValues(hardQuestionRankOpening(pinned.draft), opening)) {
      throw changedOrder();
    }
    const predecessorId = latestCapture(pinned.pending);
    const session = new DataSession(pinned.confirmed);
    session.edit({ ...pinned.draft, rank });
    return { editorId: editorIdentity(actionId, snapshot.resource, ACTION_SLOT, actionId), captured: session.checkpoint(),
      predecessorId, hardQuestionRankOpening: opening };
  });
}

/** If a queued theme Save already moved this list on screen, wait for that exact Save. */
export function pendingRankScopeRequests(owner: string, openings: readonly HardQuestionRankWitness[], scope: HardQuestionRankScope | null,
  requests: readonly CommitRequest[]): string[] {
  if (!scope) return [];
  const latest = new Map<string, CommitRequest>();
  for (const request of requests) {
    if (request.owner === owner && request.baseline.resource.collection === 'hardQuestionThemes'
      && ['queued', 'prepared'].includes(request.state)) latest.set(request.baseline.resource.id, request);
  }
  const needed = new Set<string>();
  for (const { opening } of openings) {
    const previous = opening.themeId && latest.get(opening.themeId);
    if (previous && equalValues(hardQuestionEffectiveRankScope(opening, previous.value), scope)
      && !equalValues(hardQuestionEffectiveRankScope(opening, previous.working.value), scope)) needed.add(previous.id);
  }
  return [...needed];
}
