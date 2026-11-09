import type { RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';

const isText = (value: unknown): value is string => typeof value === 'string';
const isIdentity = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const GROUP_BLOCK_TITLE: RowFieldTarget<string> = { field: 'templates', leaf: 'title', accepts: isText };
const GROUP_STEP_TITLE: RowFieldTarget<string | null> = {
  field: 'flow', leaf: 'instanceTitle', missing: null, accepts: (value): value is string | null => value === null || isText(value),
};

export const GROUP_BLOCK_TITLE_POLICY: RowDetailPolicy<'title', string> = {
  collection: 'groups', fields: ['title'],
  birth: { field: 'templates', leaf: 'createdAt', accepts: isText },
  target: () => GROUP_BLOCK_TITLE,
  proofs: 'groupBlockTitleProofs', actions: 'groupBlockTitleActions', history: '_blockTitleHistory',
  repeatedFields: ['title'], allowUnclocked: true,
};

export const GROUP_STEP_TITLE_POLICY: RowDetailPolicy<'title', string | null> = {
  collection: 'groups', fields: ['title'],
  birth: { field: 'flow', leaf: 'templateId', accepts: isIdentity },
  target: () => GROUP_STEP_TITLE,
  proofs: 'groupStepTitleProofs', actions: 'groupStepTitleActions', history: '_stepTitleHistory',
  repeatedFields: ['title'], allowUnclocked: true,
};

export type GroupFlowHistoryPage = {
  owner: string;
  groupId: string;
  generation: string;
  nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'title' | 'status', string | null>[] }>;
};
