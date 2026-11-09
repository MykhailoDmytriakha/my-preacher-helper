import { readGroupFlowFieldConflict, useOpenDocumentAnswerScopes } from '@/data-engine/react.client';
import { storedFieldValue } from '@/utils/storedFieldValue';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';

const fields = {
  block: 'groupFlow.editor.blockTitleLabel',
  step: 'groupFlow.editor.stepTitleLabel',
  status: 'groupFlow.editor.statusLabel',
  duration: 'groupFlow.editor.durationLabel',
};

type Translate = (key: string) => string;

export function groupFlowFieldText(t: Translate, field: keyof typeof fields, value: string | number | null): string {
  if (field === 'duration') return String(storedFieldValue(t, 'groups.flow', 'durationMin', value));
  if (field === 'status') return t('groupFlow.status.' + value);
  return typeof value === 'string' && value ? value : t(field === 'block' ? 'common.untitled' : 'groupFlow.editor.useBlockName');
}

export function useGroupFlowComparison(checkpoint: SessionCheckpoint | undefined, t: Translate): TextComparison | undefined {
  const answers = useOpenDocumentAnswerScopes();
  const comparison = checkpoint && readGroupFlowFieldConflict(checkpoint);
  if (!checkpoint || !comparison) return undefined;
  const { resource, value } = checkpoint.confirmed;
  const [operationId] = Object.keys(checkpoint.pending);
  const owned = answers.filter(answer => answer.owner === value?.userId && answer.resource.collection === resource.collection
    && answer.resource.id === resource.id && answer.operationIds.includes(operationId));
  // A common answer with queued descendants must use the document choice, which retains those saves.
  if (!owned.length || owned.some(answer => answer.operationIds.length !== 1 || answer.laterSaves?.length)) return undefined;
  const { field, mine, stored, identity } = comparison;
  return { identity, title: t(fields[field]), mine: groupFlowFieldText(t, field, mine), stored: groupFlowFieldText(t, field, stored),
    valueKind: 'field', scopedChoice: true };
}
