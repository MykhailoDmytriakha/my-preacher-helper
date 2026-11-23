import { boundedActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { serviceOrderStepField } from './serviceOrderStepAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { ServiceOrderStepVersion } from './serviceOrderStepAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData, EditorCommitAction, ResourceSnapshot } from './types';

export type ServiceOrderInput = (
  | { field: 'orderTitle'; before: string; value: string; raw?: string }
  | { field: 'title' | 'body'; stepId: string; before: string; value: string }
  | { field: 'scriptureRefs'; stepId: string; before: string[]; value: string[]; raw: string }
) & { time: ActionTime | null; version?: ServiceOrderStepVersion & { requestId?: string }; retainedOnly?: true; followsCaptured?: true; waitingForStep?: true };

export type ServiceOrderInputComparison = {
  generation: string | null;
  revision: number | null;
  createdAt?: string;
  value: string | string[];
};

export class ServiceOrderInputDecisionError extends Error {
  constructor(message: string, readonly code: 'decision-changed' | 'invalid-argument' | 'resolve-version-first' = 'decision-changed') {
    super(message);
  }
}

export const serviceOrderInputKey = (input: ServiceOrderInput) => JSON.stringify(['stepId' in input ? input.stepId : null, input.field]);

export function readServiceOrderInputValue(document: DocumentData | null, input: ServiceOrderInput) {
  if (input.field === 'orderTitle') return document?.title;
  if (!Array.isArray(document?.steps)) return;
  const row = document.steps.find(step => object(step) && step.id === input.stepId);
  if (object(row)) return row[input.field] ?? (input.field === 'scriptureRefs' ? [] : '');
}

export function projectServiceOrderInput(document: DocumentData | null, input: ServiceOrderInput,
  value = input.value): DocumentData | null {
  if (!document || readServiceOrderInputValue(document, input) === undefined) return null;
  if (input.field === 'orderTitle') return { ...document, title: value };
  const steps = document.steps as DocumentData[];
  return { ...document, steps: steps.map(step => object(step) && step.id === input.stepId ? { ...step, [input.field]: value } : step) };
}

/** A field keeps the opening and action time beside its draft, even before delivery has an ID. */
export function stageServiceOrderInput(checkpoint: SessionCheckpoint, draft: DocumentData | null, input: ServiceOrderInput): void {
  const { confirmed } = checkpoint;
  if (confirmed.resource.collection !== 'serviceOrders') return;
  const value = readServiceOrderInputValue(draft, input);
  if (value !== undefined && !equalValues(value, input.value)) return;
  const key = serviceOrderInputKey(input);
  const prior = checkpoint.serviceOrderInputs?.[key];
  const sameOpening = !input.followsCaptured && prior && (!prior.version || !input.version || prior.version.generation === input.version.generation)
    && (equalValues(readServiceOrderInputValue(checkpoint.draft, input), prior.value)
      || (input.waitingForStep && prior.waitingForStep && prior.retainedOnly))
    && (equalValues(input.before, prior.before) || equalValues(input.before, prior.value));
  const opening = sameOpening ? prior : input;
  // Both openings address the same field part, so its before and value have the same type.
  const time = sameOpening && equalValues(prior.value, input.value) ? prior.time : boundedActionTime(input.time) ?? null;
  const next = { ...input, before: opening.before, version: opening.version, time,
    ...(opening.followsCaptured && { followsCaptured: true }),
    ...(value === undefined && { retainedOnly: true }) } as ServiceOrderInput;
  checkpoint.serviceOrderInputs = { ...checkpoint.serviceOrderInputs, [key]: next };
}

export function retainRemovedServiceOrderInputs(checkpoint: SessionCheckpoint, snapshot: ResourceSnapshot): void {
  const inputs = checkpoint.serviceOrderInputs;
  if (checkpoint.confirmed.resource.collection !== 'serviceOrders' || !inputs || (!snapshot.value && !snapshot.metadata?.deleted)) return;
  for (const [key, input] of Object.entries(inputs)) {
    if (!input.retainedOnly && (snapshot.metadata?.deleted || readServiceOrderInputValue(snapshot.value, input) === undefined)) {
      if (!snapshot.metadata?.deleted && input.waitingForStep && readServiceOrderInputValue(checkpoint.confirmed.value, input) === undefined) continue;
      const { waitingForStep: _waiting, ...retained } = input;
      inputs[key] = { ...retained, retainedOnly: true };
    }
  }
}

export function retainServiceOrderInputs(checkpoint: SessionCheckpoint, draft: DocumentData | null): void {
  if (!checkpoint.serviceOrderInputs) return;
  const retained = Object.entries(checkpoint.serviceOrderInputs).filter(([key, input]) =>
    key === serviceOrderInputKey(input) && (input.retainedOnly || (equalValues(readServiceOrderInputValue(draft, input), input.value)
      && (input.followsCaptured || !equalValues(readServiceOrderInputValue(checkpoint.confirmed.value, input), input.value)))));
  if (retained.length) checkpoint.serviceOrderInputs = Object.fromEntries(retained);
  else delete checkpoint.serviceOrderInputs;
}

export function acknowledgeServiceOrderInput(checkpoint: SessionCheckpoint, request?: CommitRequest): void {
  if (!request || !checkpoint.serviceOrderInputs) return;
  for (const [key, input] of Object.entries(checkpoint.serviceOrderInputs)) {
    if (!input.followsCaptured || input.retainedOnly) continue;
    const action = input.field === 'orderTitle' ? request.serviceOrderTitleAction
      : input.field === 'title' ? request.serviceOrderStepTitleActions?.title
        : input.field === 'body' ? request.serviceOrderStepBodyActions?.body : request.serviceOrderStepScriptureActions?.scriptureRefs;
    if (action && (!('stepId' in input) || ('rowId' in action && action.rowId === input.stepId))
      && equalValues(action.after, input.value) && equalValues(action.time, input.time)) delete checkpoint.serviceOrderInputs[key];
  }
}

export function readServiceOrderInputComparison(snapshot: ResourceSnapshot | null, input: ServiceOrderInput): ServiceOrderInputComparison | undefined {
  if (input.retainedOnly || !snapshot?.value || snapshot.metadata?.deleted) return;
  if (input.version && snapshot.metadata?.generation !== input.version.generation) return;
  const value = readServiceOrderInputValue(snapshot.value, input);
  if (input.field === 'scriptureRefs' ? !Array.isArray(value) || !value.every(part => typeof part === 'string') : typeof value !== 'string') return;
  const { metadata } = snapshot;
  const createdAt = typeof snapshot.value.createdAt === 'string' ? snapshot.value.createdAt : undefined;
  if (!metadata && !createdAt) return;
  return { generation: metadata?.generation ?? null, revision: metadata?.revision ?? null, createdAt, value: value as string | string[] };
}

export function isReturnedServiceOrderInput(checkpoint: SessionCheckpoint, input: ServiceOrderInput): boolean {
  const { pending, conflicts, remoteCandidate } = checkpoint;
  if (Object.keys(pending).length !== 1 || conflicts.length !== 1 || !remoteCandidate?.value
    || remoteCandidate.metadata?.deleted || remoteCandidate.metadata?.generation !== checkpoint.confirmed.metadata?.generation) return false;
  const { path } = conflicts[0];
  if (input.field === 'orderTitle') return path.length === 1 && path[0] === 'title';
  const row = serviceOrderStepField(path);
  return row?.id === input.stepId && row.field === input.field;
}

/** A selection belongs to these exact two field versions on this opening. */
export function requireServiceOrderInputComparison(checkpoint: SessionCheckpoint, input: ServiceOrderInput, compared: ServiceOrderInputComparison) {
  const { confirmed, remoteCandidate, pending } = checkpoint;
  const latest = remoteCandidate ?? confirmed;
  if (confirmed.resource.collection !== 'serviceOrders' || Object.keys(pending).length
    || latest.metadata?.generation !== confirmed.metadata?.generation
    || !equalValues(checkpoint.serviceOrderInputs?.[serviceOrderInputKey(input)], input)
    || !equalValues(readServiceOrderInputValue(checkpoint.draft, input), input.value)
    || !equalValues(readServiceOrderInputComparison(latest, input), compared)) {
    throw new ServiceOrderInputDecisionError('The compared service field changed');
  }
  return latest;
}

/** A field can have opened on a newer stored value while an unrelated request was still in flight. */
export function hasNewerServiceOrderInputOpening(checkpoint: SessionCheckpoint, input: ServiceOrderInput, prior?: CommitRequest): boolean {
  if (prior?.state !== 'acknowledged' || prior.result?.kind !== 'acknowledged' || Object.keys(checkpoint.pending).length
    || !input.version || input.followsCaptured || input.waitingForStep) return false;
  const { generation, observedRevision } = input.version;
  const { confirmed } = checkpoint;
  const baseline = prior.baseline.metadata, accepted = prior.result.snapshot.metadata;
  return Boolean(baseline?.generation === generation && accepted?.generation === generation
    && confirmed.metadata?.generation === generation && !confirmed.metadata.deleted
    && baseline.revision < observedRevision && observedRevision <= confirmed.metadata.revision
    && accepted.revision <= confirmed.metadata.revision
    && equalValues(readServiceOrderInputValue(confirmed.value, input), input.before)
    && !equalValues(readServiceOrderInputValue(prior.value, input), input.before));
}

/** Project one exact input on the previous submitted document, leaving private siblings in the editor. */
export function selectServiceOrderInputSave(checkpoint: SessionCheckpoint, input: ServiceOrderInput, basis: DocumentData | null,
  compared?: ServiceOrderInputComparison):
  { intent: SessionCheckpoint; action?: EditorCommitAction } | null {
  const { confirmed, remoteCandidate } = checkpoint;
  if (input.retainedOnly) throw new ServiceOrderInputDecisionError('The edited service field has been removed');
  if (compared) {
    const latest = requireServiceOrderInputComparison(checkpoint, input, compared);
    const draft = projectServiceOrderInput(latest.value, input);
    if (!draft || (input.field === 'orderTitle' && !input.value.trim())) {
      throw new ServiceOrderInputDecisionError('This service field cannot be applied');
    }
    if (equalValues(draft, latest.value)) return null;
    // Compare-and-set against the version the person reviewed. A newer unseen value still conflicts.
    return { intent: { ...checkpoint, confirmed: latest, remoteCandidate: null, draft, dirty: true, conflicts: [] } };
  }
  const latest = remoteCandidate ?? confirmed;
  const changed = () => new ServiceOrderInputDecisionError('The saved service input changed');
  if (confirmed.resource.collection !== 'serviceOrders'
    || !equalValues(checkpoint.serviceOrderInputs?.[serviceOrderInputKey(input)], input)
    || !equalValues(readServiceOrderInputValue(checkpoint.draft, input), input.value)
    || !basis || !latest.value || latest.metadata?.deleted
    || latest.metadata?.generation !== confirmed.metadata?.generation) throw changed();

  const stored = readServiceOrderInputValue(latest.value, input);
  const previous = readServiceOrderInputValue(basis, input);
  // The selected predecessor may be the durable Add Step, still waiting offline.
  const followsAdd = stored === undefined && input.waitingForStep && input.version && equalValues(previous, input.before);
  if ((!followsAdd && stored === undefined) || previous === undefined) throw changed();
  if (input.field === 'orderTitle' && !input.value.trim()) {
    throw new ServiceOrderInputDecisionError('The service needs a name', 'invalid-argument');
  }
  if (!input.followsCaptured && equalValues(previous, input.value) && equalValues(stored, input.value)) return null;

  const version = input.version;
  if (version && (version.generation !== confirmed.metadata?.generation
    || !Number.isSafeInteger(version.observedRevision) || version.observedRevision < 1
    || version.observedRevision > confirmed.metadata.revision)) throw changed();
  if (!version && (!equalValues(stored, input.before) || !equalValues(previous, input.before))) {
    throw new ServiceOrderInputDecisionError('Compare the saved service field before using this draft', 'resolve-version-first');
  }
  const draft = projectServiceOrderInput(basis, input);
  let action: EditorCommitAction | undefined;
  if (version) {
    if (input.field === 'orderTitle') {
      const { generation, observedRevision: revision, requestId } = version;
      action = { kind: 'service-order-title', title: { time: input.time, seen: {
        title: input.before, generation, revision, requestId,
      } } };
    } else {
      const scope = { generation: version.generation, observedRevision: version.observedRevision, rowId: input.stepId, time: input.time };
      action = input.field === 'scriptureRefs'
        ? { kind: 'service-order-step-scripture', scripture: { ...scope, before: input.before, after: input.value } }
        : input.field === 'title'
          ? { kind: 'service-order-step-title', title: { ...scope, before: input.before, after: input.value } }
          : { kind: 'service-order-step-body', body: { ...scope, before: input.before, after: input.value } };
    }
  }
  return { intent: { ...checkpoint, draft, dirty: !equalValues(draft, basis), conflicts: [] }, action };
}
