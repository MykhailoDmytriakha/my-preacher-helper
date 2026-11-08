import { COUNCIL_TOPIC_ID } from './councilTopicTitleAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { captureSeenRowDetail } from './rowDetailCapture';
import { alignOptionalRowField, boundedRowId, matchesRowAction } from './rowFieldAction';

import type { CommitRequest } from './commits';
import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SeenRowDetail } from './rowDetailCapture';
import type { RowFieldTarget } from './rowFieldAction';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from './types';

export type CouncilAssemblyCapture = SeenRowDetail<boolean>;
export type CouncilAssemblyActions = { forAssembly: RowDetailObservation<boolean> };
export type CouncilAssemblyHistoryPage = {
  owner: string; councilId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'forAssembly', boolean>[] }>;
};

export const COUNCIL_ASSEMBLY: RowFieldTarget<boolean> = {
  field: 'topics', leaf: 'forAssembly', missing: false, accepts: (value): value is boolean => typeof value === 'boolean',
};
export const COUNCIL_ASSEMBLY_POLICY: RowDetailPolicy<'forAssembly', boolean> = {
  collection: 'councils', fields: ['forAssembly'], birth: COUNCIL_TOPIC_ID, target: () => COUNCIL_ASSEMBLY,
  proofs: 'councilAssemblyProofs', actions: 'councilAssemblyActions', history: '_assemblyHistory', allowUnclocked: true,
};

export function councilAssemblyRow(path: readonly string[] | undefined): string | undefined {
  if (path?.length !== 3 || path[0] !== 'topics' || !path[1].startsWith('id:') || path[2] !== 'forAssembly') return undefined;
  const id = path[1].slice(3);
  return boundedRowId(id) ? id : undefined;
}

export function captureCouncilAssembly(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: CouncilAssemblyCapture | undefined, records: readonly CommitRequest[]): CouncilAssemblyActions | undefined {
  const forAssembly = captureSeenRowDetail(baseline, predecessor, draft, capture, records, 'forAssembly', COUNCIL_ASSEMBLY_POLICY,
    request => request.councilAssemblyActions?.forAssembly);
  return forAssembly && { forAssembly };
}

export function matchingCouncilAssembly(changes: FieldChange[], actions: CouncilAssemblyActions | undefined) {
  const flag = actions?.forAssembly;
  return flag && matchesRowDetailBirth(changes, flag, COUNCIL_TOPIC_ID) && matchesRowAction(changes, flag, COUNCIL_ASSEMBLY) ? actions : undefined;
}

export function alignCouncilAssembly(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== COUNCIL_ASSEMBLY_POLICY.collection) return command;
  return alignOptionalRowField(command, current, COUNCIL_ASSEMBLY, command.councilAssemblyActions?.forAssembly?.rowId);
}
