import { hasRecordedCouncilTopicOutcome } from '@/utils/councilTopicOutcome';

import { COUNCIL_TOPIC_ID } from './councilTopicTitleAction';
import { object } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { captureSeenRowDetail } from './rowDetailCapture';
import { alignOptionalRowField, boundedRowId, matchesRowAction } from './rowFieldAction';

import type { CommitRequest } from './commits';
import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SeenRowDetail } from './rowDetailCapture';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from './types';

export type CouncilTopicKind = 'decision' | 'info';
export type CouncilTopicKindCapture = SeenRowDetail<CouncilTopicKind>;
export type CouncilTopicKindActions = { kind: RowDetailObservation<CouncilTopicKind> };
export type CouncilTopicKindHistoryPage = {
  owner: string; councilId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'kind', CouncilTopicKind>[] }>;
};

export const COUNCIL_TOPIC_KIND: RowFieldTarget<CouncilTopicKind> = {
  field: 'topics', leaf: 'kind', missing: 'decision',
  accepts: (value): value is CouncilTopicKind => value === 'decision' || value === 'info',
};

function openTopicScopes(rows: unknown): ReadonlyMap<string, RowValue | undefined> {
  const scopes = new Map<string, RowValue | undefined>();
  if (!Array.isArray(rows)) return scopes;
  for (const row of rows) {
    if (object(row) && boundedRowId(row.id)) {
      scopes.set(row.id, scopes.has(row.id) || hasRecordedCouncilTopicOutcome(row) ? undefined : false);
    }
  }
  return scopes;
}

export const COUNCIL_TOPIC_KIND_POLICY: RowDetailPolicy<'kind', CouncilTopicKind> = {
  collection: 'councils', fields: ['kind'], birth: COUNCIL_TOPIC_ID, target: () => COUNCIL_TOPIC_KIND,
  proofs: 'councilTopicKindProofs', actions: 'councilTopicKindActions', history: '_topicKindHistory',
  allowUnclocked: true, causalScopeEntry: true, scopes: openTopicScopes,
};

export function councilTopicKindRow(path: readonly string[] | undefined): string | undefined {
  if (path?.length !== 3 || path[0] !== 'topics' || !path[1].startsWith('id:') || path[2] !== 'kind') return undefined;
  const id = path[1].slice(3);
  return boundedRowId(id) ? id : undefined;
}

export function captureCouncilTopicKind(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: CouncilTopicKindCapture | undefined, records: readonly CommitRequest[]): CouncilTopicKindActions | undefined {
  if (!capture || openTopicScopes(draft?.topics).get(capture.rowId) !== false) return undefined;
  const kind = captureSeenRowDetail(baseline, predecessor, draft, capture, records, 'kind', COUNCIL_TOPIC_KIND_POLICY,
    request => request.councilTopicKindActions?.kind);
  return kind && { kind };
}

export function matchingCouncilTopicKind(changes: FieldChange[], actions: CouncilTopicKindActions | undefined) {
  const kind = actions?.kind;
  return kind && matchesRowDetailBirth(changes, kind, COUNCIL_TOPIC_ID) && matchesRowAction(changes, kind, COUNCIL_TOPIC_KIND) ? actions : undefined;
}

export function alignCouncilTopicKind(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== COUNCIL_TOPIC_KIND_POLICY.collection) return command;
  return alignOptionalRowField(command, current, COUNCIL_TOPIC_KIND, command.councilTopicKindActions?.kind?.rowId);
}
