'use client';

import { useGroupFlowComparison } from '@/components/groups/groupFlowComparison';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import { useGroupMeetingEditor } from '@/hooks/useGroupMeetingEditor';
import { hydrateGroup, isGroupStatus } from '@/utils/groupDocument';
import { useTranslation } from '@locales/useTranslation';

import type { GroupPageEditor } from './groupPageEditor';
import type { DocumentData } from '@/data-engine/types';
import type { Group, GroupBlockTemplate, GroupFlowItem } from '@/models/models';
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
  const editStep = (step: Pick<GroupFlowItem, 'id' | 'templateId'>, kind: 'group-step-title' | 'group-step-duration' | 'group-step-notes',
    mutate: (row: GroupFlowItem) => GroupFlowItem) => data.update(current => {
    if (!current.flow.some(row => row.id === step.id && row.templateId === step.templateId)) {
      throw Object.assign(new Error('The step that was shown changed'), { code: 'decision-changed' });
    }
    return { ...current, flow: current.flow.map(row => row.id === step.id ? mutate(row) : row) };
  }, { action: { kind, rowId: step.id } });
  const renameStep: GroupPageEditor['renameStep'] = (step, title) =>
    editStep(step, 'group-step-title', row => ({ ...row, instanceTitle: title || undefined }));
  const setStepDuration: GroupPageEditor['setStepDuration'] = (step, durationMin) =>
    editStep(step, 'group-step-duration', row => ({ ...row, durationMin }));
  const setStepNotes: GroupPageEditor['setStepNotes'] = (step, instanceNotes) =>
    editStep(step, 'group-step-notes', row => ({ ...row, instanceNotes }));
  const checkpoint = data.document.state?.checkpoint;
  const flowComparison = useGroupFlowComparison(manual ? undefined : checkpoint, t);
  const reviewedMeeting = manual && meeting.form.comparison?.kind === 'first-group-meeting' ? meeting.form.comparison : undefined;
  const meetingWords = (value: DocumentData | null) => {
    const row = (value?.meetingDates as unknown as Group['meetingDates'])?.[0];
    const date = row?.date || t('workspaces.groups.meetings.datePlaceholder');
    const unset = t('workspaces.groups.meetings.historyUnset');
    return [date, t('workspaces.groups.meetings.location') + ' · ' + (row?.location || unset),
      t('workspaces.groups.meetings.audience') + ' · ' + (row?.audience || unset)].join('\n');
  };
  const comparison = reviewedMeeting ? {
    identity: reviewedMeeting.identity, title: t('workspaces.groups.meetings.title'), valueKind: 'field' as const, scopedChoice: true as const,
    mine: meetingWords(reviewedMeeting.mine), stored: meetingWords(reviewedMeeting.remotePreview ?? reviewedMeeting.stored.value),
    keepMineDisabled: reviewedMeeting.canKeepLocal === false,
  } : flowComparison;
  const feedbackSubject = manual ? meeting.form.recoveryIdentity : data.document.recoveryIdentity;
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
    description: group?.description ?? '', setDescription: next => { void data.update(current => ({ ...current, description: nextValue(next, current.description ?? '') }),
      { action: 'group-description' }).catch(() => undefined); },
    status: group?.status ?? 'draft', setStatus: next => { void editStatus(next).catch(() => undefined); }, statusHistory, templates: group?.templates ?? [], setTemplates: field('templates'),
    renameBlock, renameStep, setBlockStatus, setStepDuration, setStepNotes, flowTitleScope: historyScope,
    setBlockContent: data.setBlockContent, holdBlockContent: data.holdBlockContent,
    flow: group?.flow ?? [], setFlow: field('flow'),
    updateFlowPlan: mutate => {
      void data.saveFlowPlan(current => {
        const plan = mutate(current);
        return plan === current ? current : { ...current, ...plan };
      }).catch(() => undefined);
    }, moveStep: data.moveStep, meetingDate: first?.date ?? '', setMeetingDate: meeting.field('date'),
    meetingLocation: first?.location ?? '', setMeetingLocation: meeting.field('location'),
    meetingAudience: first?.audience ?? '', setMeetingAudience: meeting.field('audience'),
    meetingFieldsEnabled: meeting.enabled, meetingHistory,
    meetingFieldHistory: meetingHistory && first ? {
      ...meetingHistory, rowCreatedAt: first.createdAt, current: { location: first.location ?? null, audience: first.audience ?? null },
      restore: meeting.restoreField,
    } : undefined,
    deleteGroupDetail: data.deleteGroupDetail,
    feedbackSubject,
    feedback: <DataSyncStatus comparison={comparison || undefined} subject={feedbackSubject} status={status} error={error} errorWords={meeting.form.error ? meeting.form.errorWords : data.document.errorWords}
      onKeepLocal={manual ? () => meeting.form.keepLocal(undefined, reviewedMeeting ? meeting.form.captureDocumentMetadataAction() : undefined)
        : () => data.keepLocal(comparison ? checkpoint : undefined)}
      onAcceptRemote={manual ? meeting.form.acceptRemote : () => data.acceptRemote(comparison ? checkpoint : undefined)} onRetry={manual ? meeting.form.retry : data.refresh}
      recoveryChoices={choices} onRecover={id => id.startsWith('meeting:') ? meeting.recovery.recover(id.slice(8)) : recovery.recover(id.slice(9))}
      recoveryLoading={recovery.loading || meeting.recovery.loading} recoveryError={recovery.error || meeting.recovery.error}
      onDiscardRecovery={action => {
        const selected = choices.find(choice => choice.discard === action);
        return selected?.id.startsWith('meeting:') ? meeting.recovery.discard(action) : recovery.discard(action);
      }} />,
  };
}
