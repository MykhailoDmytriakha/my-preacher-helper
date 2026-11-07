import { liveNodeIds, readPlanText } from '@/utils/planTextStorage';

import { equalValues, object, own } from './fieldValues';

import type { ConflictDetail, DataCommand, DocumentData, FieldChange } from './types';
import type { Sermon } from '@/models/models';

type CapturedPlan = { before: DocumentData | null; after: DocumentData | null };
type PlanTextUpdate = Extract<DataCommand, { kind: 'update' }>;
export type PlanTextEvidence = Pick<PlanTextUpdate, 'observedPlanTextRemoval' | 'observedPlanTextDiscard'>;

const asSermon = (value: DocumentData | null) => value as unknown as Sermon | null;

/** Attach only the words that the removal actually knew about at capture. */
function observedPlanTextRemoval({ before, after }: CapturedPlan): Record<string, string> | undefined {
  const remaining = liveNodeIds(asSermon(after)?.outline);
  const removed = [...liveNodeIds(asSermon(before)?.outline)].filter(id => !remaining.has(id));
  if (!removed.length) return undefined;
  const text = readPlanText(asSermon(before));
  return Object.fromEntries(removed.map(id => [id, own(text, id) ? text[id] : '']));
}

/** An explicit discard owns a single shown copy while its point remains absent. */
function observedPlanTextDiscard({ before, after }: CapturedPlan): Record<string, string> | undefined {
  if (!before || !after || !object(after.planText)) return undefined;
  const planText = after.planText;
  const live = liveNodeIds(asSermon(before)?.outline);
  const text = readPlanText(asSermon(before));
  const evidence = Object.fromEntries(Object.entries(text)
    .filter(([id, body]) => body !== '' && !live.has(id) && own(planText, id) && planText[id] === ''));
  return Object.keys(evidence).length ? evidence : undefined;
}

export function stalePlanTextDiscards(
  previous: DocumentData, candidate: DocumentData, evidence: Record<string, string>,
): ConflictDetail[] {
  const wasLive = liveNodeIds(asSermon(previous)?.outline);
  const nowLive = liveNodeIds(asSermon(candidate)?.outline);
  const stored = readPlanText(asSermon(previous));
  return Object.entries(evidence).flatMap(([id, text]) => {
    const body = own(stored, id) ? stored[id] : undefined;
    if (!wasLive.has(id) && !nowLive.has(id) && (body === undefined || body === '' || body === text)) return [];
    return [{ path: ['planText', id], base: { exists: true, value: text }, mine: { exists: true, value: '' },
      theirs: body === undefined ? { exists: false } : { exists: true, value: body } }];
  });
}

/** The merged outline and exact observed words must both match before a retirement can land. */
export function retireObservedPlanText(previous: DocumentData, candidate: DocumentData, evidence: Record<string, string>): void {
  const wasLive = liveNodeIds(asSermon(previous)?.outline);
  const nowLive = liveNodeIds(asSermon(candidate)?.outline);
  const wasText = readPlanText(asSermon(previous));
  const nowText = readPlanText(asSermon(candidate));
  const retired = Object.entries(evidence).filter(([id, text]) => text !== '' && wasLive.has(id) && !nowLive.has(id)
    && own(wasText, id) && wasText[id] === text && own(nowText, id) && nowText[id] === text);
  if (!retired.length) return;
  // A blank overlays the same node in legacy plan/draft cells as well.
  candidate.planText = {
    ...(object(candidate.planText) ? candidate.planText : {}),
    ...Object.fromEntries(retired.map(([id]) => [id, ''])),
  };
}

/** Order is unknown for an unseen edit delivered after retirement. Keep it under the missing ID. */
export function preserveUnorderedPlanText(change: FieldChange, previous: DocumentData, candidate: DocumentData,
  removal?: PlanTextEvidence['observedPlanTextRemoval']): FieldChange {
  if ((change.before.exists && !object(change.before.value)) || !object(change.after.value)) return change;
  const wasLive = liveNodeIds(asSermon(previous)?.outline);
  const nowLive = liveNodeIds(asSermon(candidate)?.outline);
  const before = object(change.before.value) ? { ...change.before.value } : {};
  const after = { ...change.after.value };
  let adjusted = false;
  const stored = object(previous.planText) ? previous.planText : {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (nowLive.has(id)) continue;
    if (removal && own(removal, id) && wasLive.has(id)) {
      // One editor can submit its earlier local text and its later removal in the same update.
      // Leave this cell to the observed removal, preserving any different server text.
      if (own(before, id)) after[id] = before[id];
      else delete after[id];
      adjusted = true;
    } else if (own(stored, id) && own(before, id) && !own(after, id)) {
      // An older manual-plan client may send a follow-up cleanup with no text decision.
      after[id] = before[id];
      adjusted = true;
    } else if (!wasLive.has(id) && typeof after[id] === 'string' && after[id] !== ''
      && after[id] !== before[id] && own(stored, id) && stored[id] === '') {
      before[id] = '';
      adjusted = true;
    }
  }
  if (!adjusted) return change;
  return { ...change,
    before: change.before.exists || Object.keys(before).length ? { exists: true, value: before } : { exists: false },
    after: change.before.exists || Object.keys(after).length ? { exists: true, value: after } : { exists: false },
  };
}

/** Freeze the evidence with the action, before an earlier queued write can be collected. */
export function capturePlanTextEvidence(captured: CapturedPlan): PlanTextEvidence {
  const { before, after } = captured;
  const removal = !equalValues(before?.outline, after?.outline) ? observedPlanTextRemoval(captured) : undefined;
  const discard = !equalValues(before?.planText, after?.planText) ? observedPlanTextDiscard(captured) : undefined;
  return {
    ...(removal ? { observedPlanTextRemoval: removal } : {}),
    ...(discard ? { observedPlanTextDiscard: discard } : {}),
  };
}

/** Enrich the current command without changing the frozen draft used for ACK projection. */
export function withPlanTextEvidence(command: DataCommand, evidence: PlanTextEvidence): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons') return command;
  const removal = command.changes.some(change => change.path[0] === 'outline') ? evidence.observedPlanTextRemoval : undefined;
  const next = command.changes.find(change => change.path[0] === 'planText')?.after.value;
  const discard = evidence.observedPlanTextDiscard && object(next)
    ? Object.entries(evidence.observedPlanTextDiscard).filter(([id]) => own(next, id) && next[id] === '') : [];
  return {
    ...command,
    ...(removal ? { observedPlanTextRemoval: removal } : {}),
    ...(discard.length ? { observedPlanTextDiscard: Object.fromEntries(discard) } : {}),
  };
}
