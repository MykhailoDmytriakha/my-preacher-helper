import { sameManualSelection } from './manualScope';
import { canReplaceSnapshot } from './snapshotFreshness';

import type { CommitRequest } from './commits';
import type { ManualScope } from './manualScope';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

export interface ManualComparison { identity: string; requestId: string; mine: DocumentData; stored: ResourceSnapshot }

/** Only an actual answered ancestor of this selected field may explain its two versions. */
export function manualComparison(form: ReturnType<ManualScope['getState']>, parent: SessionCheckpoint,
  requests: ReadonlyMap<string, CommitRequest>): ManualComparison | undefined {
  let id = form.record.predecessor?.id;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = requests.get(id);
    if (!request || request.owner !== form.record.owner || request.baseline.resource.collection !== form.record.resource.collection
      || request.baseline.resource.id !== form.record.resource.id) return undefined;
    if (request.result?.kind === 'conflict' && (request.state === 'conflict' || form.choiceRequired)) {
      let stored = request.result.snapshot;
      const observed = parent.remoteCandidate ?? parent.confirmed;
      if (canReplaceSnapshot(stored, observed)) stored = observed;
      if (!stored.value || stored.metadata?.deleted) return undefined;
      const changed = form.record.selection.some(path => !sameManualSelection(request.baseline.value, request.value, path)
        && !sameManualSelection(request.baseline.value, stored.value, path) && !sameManualSelection(request.value, stored.value, path));
      if (changed) return { identity: JSON.stringify([form.record.scopeId, request.id, form.record.stage, stored]), requestId: request.id, mine: form.value, stored: JSON.parse(JSON.stringify(stored)) as ResourceSnapshot };
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}


export function assertManualComparison(expected: string | undefined, current: ManualComparison | undefined): void {
  if (expected !== undefined && current?.identity !== expected) throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
}
export function assertDurableManualChoice(staged: ReturnType<ManualScope['getState']> | undefined): void {
  if (staged && !staged.durable) throw Object.assign(new Error('Persist the manual form before resolving delivery'), { code: 'not-on-device-yet' });
}
export function assertManualChoiceInput(staged: ReturnType<ManualScope['getState']> | undefined, choice: 'local' | 'remote', failed: boolean, discardStage: boolean): void {
  if (staged?.dirty && !staged.choiceRequired && (choice !== 'local' || !failed) && !discardStage) throw Object.assign(new Error('Save or cancel the unsent form before resolving delivery'), { code: 'unsent-form-first' });
}
