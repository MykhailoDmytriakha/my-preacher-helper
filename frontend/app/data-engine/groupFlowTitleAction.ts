import type { RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';

export const GROUP_FLOW_TEXT_SETTLED = 'group-flow-text-settled';
export const GROUP_FLOW_TEXT_QUEUED = 'group-flow-text-queued';
export const isOrderedGroupFlowText = (code: string | undefined) => code === GROUP_FLOW_TEXT_SETTLED || code === GROUP_FLOW_TEXT_QUEUED;

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
  compareUnseenText: true,
  repeatedFields: ['title'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, rememberReaffirmations: true,
  rememberLegacyReaffirmations: true, seedOpeningFromStoredValue: true,
};

export const GROUP_STEP_TITLE_POLICY: RowDetailPolicy<'title', string | null> = {
  collection: 'groups', fields: ['title'],
  birth: { field: 'flow', leaf: 'templateId', accepts: isIdentity },
  target: () => GROUP_STEP_TITLE,
  proofs: 'groupStepTitleProofs', actions: 'groupStepTitleActions', history: '_stepTitleHistory',
  compareUnseenText: true,
  repeatedFields: ['title'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, rememberReaffirmations: true,
  rememberLegacyReaffirmations: true, seedOpeningFromStoredValue: true,
};

export const GROUP_BLOCK_CONTENT_POLICY: RowDetailPolicy<'content', string> = {
  collection: 'groups', fields: ['content'], birth: GROUP_BLOCK_TITLE_POLICY.birth,
  target: () => ({ field: 'templates', leaf: 'content', accepts: isText }),
  proofs: 'groupBlockContentProofs', actions: 'groupBlockContentActions', history: '_blockContentHistory',
  compareUnseenText: true,
  repeatedFields: ['content'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, seedOpeningFromStoredValue: true,
};

export const GROUP_STEP_NOTES_POLICY: RowDetailPolicy<'instanceNotes', string | null> = {
  collection: 'groups', fields: ['instanceNotes'], birth: GROUP_STEP_TITLE_POLICY.birth,
  target: () => ({ field: 'flow', leaf: 'instanceNotes', missing: null, accepts: (value): value is string | null => value === null || isText(value) }),
  proofs: 'groupStepNotesProofs', actions: 'groupStepNotesActions', history: '_stepNotesHistory',
  compareUnseenText: true,
  repeatedFields: ['instanceNotes'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, seedOpeningFromStoredValue: true,
};

export type GroupFlowHistoryPage = {
  owner: string;
  groupId: string;
  generation: string;
  nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'title' | 'status' | 'durationMin', string | number | null>[] }>;
};
