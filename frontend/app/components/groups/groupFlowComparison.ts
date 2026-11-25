import { anchoredStepComparison } from '@/components/care/serviceOrderPlacementWords';
import { readGroupFlowFieldConflict, useOpenDocumentAnswerScopes } from '@/data-engine/react.client';
import { storedFieldValue } from '@/utils/storedFieldValue';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';

const fields = {
  block: 'groupFlow.editor.blockTitleLabel',
  step: 'groupFlow.editor.stepTitleLabel',
  status: 'groupFlow.editor.statusLabel',
  duration: 'groupFlow.editor.durationLabel',
  content: 'groupFlow.editor.contentLabel',
  notes: 'groupFlow.editor.notesLabel',
  description: 'workspaces.groups.form.description',
  title: 'workspaces.groups.form.title',
  groupStatus: 'workspaces.series.form.status',
  removedContent: 'groupFlow.editor.contentLabel',
  removedNotes: 'groupFlow.editor.notesLabel',
};

type Translate = (key: string, values?: Record<string, string>) => string;

export function groupFlowFieldText(t: Translate, field: keyof typeof fields, value: string | number | null): string {
  if (field === 'duration') return String(storedFieldValue(t, 'groups.flow', 'durationMin', value));
  if (field === 'groupStatus') return t('workspaces.series.form.statuses.' + value);
  if (field === 'status') return t('groupFlow.status.' + value);
  if (['content', 'notes', 'description', 'title', 'removedContent', 'removedNotes'].includes(field)) {
    return typeof value === 'string' && value ? value : t('dataSync.emptyField');
  }
  return typeof value === 'string' && value ? value : t(field === 'block' ? 'common.untitled' : 'groupFlow.editor.useBlockName');
}

export function useGroupFlowComparison(checkpoint: SessionCheckpoint | undefined, t: Translate): TextComparison | undefined {
  const answers = useOpenDocumentAnswerScopes();
  const placement = checkpoint?.confirmed.resource.collection === 'groups' && anchoredStepComparison(checkpoint, 'serviceOrders.stepPosition', t);
  if (placement) return placement;
  const comparison = checkpoint && readGroupFlowFieldConflict(checkpoint);
  if (!checkpoint || !comparison) return undefined;
  const { resource, value } = checkpoint.confirmed;
  const [operationId] = Object.keys(checkpoint.pending);
  const owned = answers.filter(answer => answer.owner === value?.userId && answer.resource.collection === resource.collection
    && answer.resource.id === resource.id && answer.operationIds.includes(operationId));
  // A common answer with queued descendants must use the document choice, which retains those saves.
  const privateFields = Boolean((checkpoint.unreadableRowProofs?.length || checkpoint.unreadableScalarProof?.length
    || checkpoint.privateFieldReview?.groupCopySources?.length) && !Object.keys(checkpoint.pending).length);
  if (!privateFields && (!owned.length || owned.some(answer => answer.operationIds.length !== 1 || answer.laterSaves?.length))) return undefined;
  const { field, mine, stored, identity } = comparison;
  if (field === 'copiedSteps') {
    const steps = comparison.steps.map(step => [
      t('dataSync.groupCopy.draftStep', { position: String(step.order) }), step.instanceTitle,
      typeof step.durationMin === 'number' ? groupFlowFieldText(t, 'duration', step.durationMin) : undefined, step.instanceNotes,
    ].filter(value => typeof value === 'string' && value.trim()).join(' · '));
    const title = t('dataSync.groupCopy.title', { count: String(steps.length) });
    return { identity, title: comparison.rowTitle + ' · ' + title, mine: [comparison.blockWords, ...steps].join('\n'),
      stored: t(comparison.sourcePresent ? 'dataSync.groupCopy.sourcePresent' : 'dataSync.groupCopy.sourceRemoved'),
      description: t('dataSync.groupCopy.description'), valueKind: 'field', scopedChoice: true,
      actions: { local: t('dataSync.groupCopy.keep'), stored: t('dataSync.groupCopy.skip'), confirmStored: 'dataSync.groupCopy.discard' } };
  }
  if (field === 'complete') return { identity, mine: '', stored: '', completeReview: true };
  const removedBy = 'removedBy' in comparison ? comparison.removedBy : undefined;
  const label = t(fields[field]);
  const row = 'rowTitle' in comparison && (comparison.rowTitle || comparison.rowId);
  const title = row ? (comparison.rowPosition ? comparison.rowPosition + '. ' : '') + row + ' · ' + label : label;
  return { identity, title,
    mine: removedBy === 'local' ? t('dataSync.groupRowRemovedLocally') : groupFlowFieldText(t, field, mine),
    stored: removedBy === 'remote' ? t('dataSync.groupRowRemoved') : groupFlowFieldText(t, field, stored),
    valueKind: 'field', scopedChoice: true, keepMineDisabled: removedBy === 'remote',
    ...(removedBy === 'remote' && { actions: { local: t('dataSync.useLocalVersion'), stored: t('dataSync.useStoredVersion'),
      confirmStored: 'dataSync.confirmStoredGroupRowRemoval' as const } }) };
}
