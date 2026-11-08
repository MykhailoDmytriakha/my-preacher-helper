import { boundedRowId, existingRowField } from './rowFieldAction';

import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';

export type CouncilTopicTitleAction = RowDetailObservation<string>;
export type CouncilTopicTitleHistoryPage = {
  owner: string;
  councilId: string;
  generation: string;
  nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'title', string>[] }>;
};

export const COUNCIL_TOPIC_TITLE: RowFieldTarget<string> = {
  field: 'topics', leaf: 'title', accepts: (value): value is string => typeof value === 'string',
};
export const COUNCIL_TOPIC_ID: RowFieldTarget<string> = { field: 'topics', leaf: 'id', accepts: boundedRowId };

export const COUNCIL_TOPIC_TITLE_POLICY: RowDetailPolicy<'title', string> = {
  collection: 'councils', fields: ['title'], birth: COUNCIL_TOPIC_ID, target: () => COUNCIL_TOPIC_TITLE,
  proofs: 'councilTopicTitleProofs', actions: 'councilTopicTitleActions', history: '_topicTitleHistory',
  repeatedFields: ['title'], allowUnclocked: true,
};

export function councilTopicTitleRow(path: readonly string[] | undefined): string | undefined {
  if (path?.length !== 3 || path[0] !== 'topics' || !path[1].startsWith('id:') || path[2] !== 'title') return undefined;
  const id = path[1].slice(3);
  return boundedRowId(id) ? id : undefined;
}

export function hasCouncilTopic(rows: unknown, id: string): boolean {
  return existingRowField(rows, id, COUNCIL_TOPIC_ID) === id;
}
