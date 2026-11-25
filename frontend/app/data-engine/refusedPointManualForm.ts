import { hasTimedAncestor } from './commits';
import { equalValues, readField, writeField } from './fieldValues';
import { sameManualSelection } from './manualScope';

import type { CommitRequest } from './commits';
import type { ManualScopeRecord } from './manualScope';
import type { SessionCheckpoint } from './session';

const planPath = ['preparation', 'exegeticalPlan'] as const;

/** Only a readable point-only refusal leaves an independent manual opening safe to submit. */
export function canSaveSeparateFromRefusedPoint(form: ManualScopeRecord, checkpoint: SessionCheckpoint,
  requests: ReadonlyMap<string, CommitRequest>): boolean {
  const { owner, resource, baseline, selection } = form;
  const generation = baseline.metadata?.generation;
  const { confirmed, remoteCandidate, pending } = checkpoint;
  if (resource.collection !== 'sermons' || !form.active || form.predecessor || !selection.length || !baseline.value || !generation
    || baseline.metadata?.deleted || !confirmed.value || confirmed.metadata?.deleted || confirmed.metadata?.generation !== generation
    || (remoteCandidate && (remoteCandidate.metadata?.generation !== generation || remoteCandidate.metadata.deleted || !remoteCandidate.value))
    || checkpoint.conflicts.some(conflict => conflict.path[0] !== 'preparation')
    || !equalValues(confirmed.resource, resource)
    || selection.some(path => path[0] === 'preparation' || !sameManualSelection(baseline.value, confirmed.value, path))) return false;

  let refused = false;
  for (const [id, captured] of Object.entries(pending)) {
    const request = requests.get(id);
    if (!request?.baseline.value || !request.value || request.owner !== owner || !equalValues(request.baseline.resource, resource)
      || request.baseline.metadata?.generation !== generation || !equalValues(captured.value, request.value)
      || request.sequence !== 0 || request.atomic || request.retentionScope || request.sermonNoteText
      || hasTimedAncestor({ ...request, exegeticalPlanActions: undefined })) return false;
    if (request.state === 'refused') {
      if (request.result?.kind !== 'refused' || request.result.code !== 'decision-changed') return false;
      refused = true;
    } else if (request.state !== 'queued') return false;
    if (request.command && (request.command.kind !== 'update'
      || request.command.changes.some(change => change.path[0] !== 'preparation'))) return false;
    const plan = readField(request.value, planPath);
    if (equalValues(readField(request.baseline.value, planPath), plan)
      || !equalValues(writeField(request.baseline.value, planPath, plan), request.value)) return false;
  }
  return refused;
}
