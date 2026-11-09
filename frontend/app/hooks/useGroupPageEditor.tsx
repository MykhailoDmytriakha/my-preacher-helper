'use client';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { readGroupFlowFieldConflict } from '@/data-engine/react.client';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import { useGroupMeetingEditor } from '@/hooks/useGroupMeetingEditor';
import { hydrateGroup, isGroupStatus } from '@/utils/groupDocument';
import { useTranslation } from '@locales/useTranslation';

import type { GroupPageEditor } from './groupPageEditor';
import type { Group, GroupBlockTemplate } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

const nextValue = <T,>(next: SetStateAction<T>, previous: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(previous) : next;

/** Domain fields use the shared document; the meeting keeps incomplete dates in a durable form. */
export function useGroupPageEditor(groupId: string): GroupPageEditor {
  const data = useGroupDataDocument(groupId);
  const { t } = useTranslation();
  const group = data.group;
  // The public facade records failures for DataSyncStatus; a React event cannot await them.
  const change = (mutate: (current: Group) => Group) => { void data.update(mutate).catch(() => undefined); };
  const field = <K extends 'templates' | 'flow'>(key: K): Dispatch<SetStateAction<Group[K]>> =>
    next => change(current => ({ ...current, [key]: nextValue(next, current[key]) }));
  const meeting = useGroupMeetingEditor(groupId, group?.meetingDates ?? [], Boolean(data.document.state?.manualWork),
    (Boolean(data.document.confirmed?.value) || data.document.presence.kind === 'creating') && data.document.presence.kind !== 'absent' && data.document.presence.kind !== 'deleting');
  const first = meeting.first;
  const recovery = data.recovery;
  const manual = meeting.form.dirty || data.document.state?.manualWork;
  const heldMeeting = manual && meeting.form.data;
  const retainedGroup = heldMeeting ? hydrateGroup({ ...(group ?? heldMeeting), id: groupId,
    meetingDates: heldMeeting.meetingDates ?? [] } as unknown as Group) : undefined;
  const status = manual ? meeting.form.status : data.status;
  const error = meeting.form.error || data.error;
  const choices = [...recovery.choices.map(choice => ({ ...choice, id: `document:${choice.id}` })),
    ...meeting.recovery.choices.map(choice => ({ ...choice, id: `meeting:${choice.id}` }))];
  const confirmed = data.document.confirmed;
  const owner = confirmed?.value?.userId;
  const generation = confirmed?.metadata?.generation;
  const editTitle = (next: SetStateAction<string>) =>
    data.update(current => ({ ...current, title: nextValue(next, current.title) }), { action: 'group-title' });
  const editStatus = (next: SetStateAction<Group['status']>) =>
    data.update(current => ({ ...current, status: nextValue(next, current.status) }), { action: 'group-status' });
  const historyScope = typeof owner === 'string' && generation ? {
    owner, generation, groupId,
    disabled: Boolean(data.document.readOnly || data.status?.phase === 'conflict' || data.status?.phase === 'refused'),
  } : undefined;
  const editBlock = (block: Pick<GroupBlockTemplate, 'id' | 'createdAt'>,
    kind: 'group-block-title' | 'group-block-status', mutate: (row: GroupBlockTemplate) => GroupBlockTemplate) =>
    data.update(current => {
      if (!current.templates.some(row => row.id === block.id && row.createdAt === block.createdAt)) {
        throw Object.assign(new Error('The block that was shown changed'), { code: 'decision-changed' });
      }
      return { ...current, templates: current.templates.map(row => row.id === block.id
        ? { ...mutate(row), updatedAt: new Date().toISOString() } : row) };
    }, { action: { kind, rowId: block.id } });
  const renameBlock: GroupPageEditor['renameBlock'] = (block, title) => editBlock(block, 'group-block-title', row => ({ ...row, title }));
  const setBlockStatus: GroupPageEditor['setBlockStatus'] = (block, status) =>
    editBlock(block, 'group-block-status', row => ({ ...row, status }));
  const renameStep: GroupPageEditor['renameStep'] = (step, title) => data.update(current => {
    if (!current.flow.some(row => row.id === step.id && row.templateId === step.templateId)) {
      throw Object.assign(new Error('The step that was shown changed'), { code: 'decision-changed' });
    }
    return { ...current, flow: current.flow.map(row => row.id === step.id ? { ...row, instanceTitle: title || undefined } : row) };
  }, { action: { kind: 'group-step-title', rowId: step.id } });
  const checkpoint = data.document.state?.checkpoint;
  const comparison = checkpoint && readGroupFlowFieldConflict(checkpoint);
  const comparisonLabel = { block: 'groupFlow.editor.blockTitleLabel', step: 'groupFlow.editor.stepTitleLabel', status: 'groupFlow.editor.statusLabel' };
  const comparisonText = (field: keyof typeof comparisonLabel, value: string | null) => field === 'status' ? t('groupFlow.status.' + value)
    : value || t(field === 'block' ? 'common.untitled' : 'groupFlow.editor.useBlockName');
  const titleHistory = historyScope && { ...historyScope, restore: editTitle };
  const statusHistory = historyScope && { ...historyScope, field: 'status' as const, restore: async (next: string) => {
    if (!isGroupStatus(next)) throw new Error('Invalid group status');
    await editStatus(next);
  } };
  const meetingHistory = first && typeof owner === 'string' && generation ? {
    owner, generation, rowId: first.id, date: first.date,
    disabled: manual || !meeting.enabled || Boolean(meeting.form.choiceRequired) || Boolean(meeting.form.documentChoiceRequired),
    restore: meeting.restoreDate,
  } : undefined;
  return {
    readOnly: data.document.readOnly,
    presence: data.document.presence,
    readNotice: { subject: data.document.recoveryIdentity, relatedSubjects: [meeting.form.recoveryIdentity], words: data.document.errorWords },
    refresh: data.refresh,
    group, retainedGroup, loading: data.loading || Boolean(group && meeting.loading), title: group?.title ?? '', setTitle: next => { void editTitle(next).catch(() => undefined); }, titleHistory,
    description: group?.description ?? '', setDescription: next => change(current => ({ ...current, description: nextValue(next, current.description ?? '') })),
    status: group?.status ?? 'draft', setStatus: next => { void editStatus(next).catch(() => undefined); }, statusHistory, templates: group?.templates ?? [], setTemplates: field('templates'),
    renameBlock, renameStep, setBlockStatus, flowTitleScope: historyScope,
    flow: group?.flow ?? [], setFlow: field('flow'), meetingDate: first?.date ?? '', setMeetingDate: meeting.field('date'),
    meetingLocation: first?.location ?? '', setMeetingLocation: meeting.field('location'),
    meetingAudience: first?.audience ?? '', setMeetingAudience: meeting.field('audience'),
    meetingFieldsEnabled: meeting.enabled, meetingHistory,
    meetingFieldHistory: meetingHistory && first ? {
      ...meetingHistory, rowCreatedAt: first.createdAt, current: { location: first.location ?? null, audience: first.audience ?? null },
      restore: meeting.restoreField,
    } : undefined,
    deleteGroupDetail: data.deleteGroupDetail,
    feedback: <DataSyncStatus comparison={!manual && comparison ? {
      identity: comparison.identity,
      title: t(comparisonLabel[comparison.field]),
      mine: comparisonText(comparison.field, comparison.mine),
      stored: comparisonText(comparison.field, comparison.stored),
      valueKind: 'field', scopedChoice: true,
    } : undefined} subject={manual ? meeting.form.recoveryIdentity : data.document.recoveryIdentity} status={status} error={error} errorWords={meeting.form.error ? meeting.form.errorWords : data.document.errorWords}
      onKeepLocal={manual ? meeting.form.keepLocal : () => data.keepLocal(comparison ? checkpoint : undefined)}
      onAcceptRemote={manual ? meeting.form.acceptRemote : () => data.acceptRemote(comparison ? checkpoint : undefined)} onRetry={manual ? meeting.form.retry : data.refresh}
      recoveryChoices={choices} onRecover={id => id.startsWith('meeting:') ? meeting.recovery.recover(id.slice(8)) : recovery.recover(id.slice(9))}
      recoveryLoading={recovery.loading || meeting.recovery.loading} recoveryError={recovery.error || meeting.recovery.error}
      onDiscardRecovery={action => {
        const selected = choices.find(choice => choice.discard === action);
        return selected?.id.startsWith('meeting:') ? meeting.recovery.discard(action) : recovery.discard(action);
      }} />,
  };
}
