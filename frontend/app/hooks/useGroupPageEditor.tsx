'use client';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import { useGroupMeetingEditor } from '@/hooks/useGroupMeetingEditor';
import { hydrateGroup } from '@/utils/groupDocument';

import type { GroupPageEditor } from './groupPageEditor';
import type { Group } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

const nextValue = <T,>(next: SetStateAction<T>, previous: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(previous) : next;

/** Domain fields use the shared document; the meeting keeps incomplete dates in a durable form. */
export function useGroupPageEditor(groupId: string): GroupPageEditor {
  const data = useGroupDataDocument(groupId);
  const group = data.group;
  // The public facade records failures for DataSyncStatus; a React event cannot await them.
  const change = (mutate: (current: Group) => Group) => { void data.update(mutate).catch(() => undefined); };
  const field = <K extends 'title' | 'status' | 'templates' | 'flow'>(key: K): Dispatch<SetStateAction<Group[K]>> =>
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
  return {
    readOnly: data.document.readOnly,
    presence: data.document.presence,
    refresh: data.refresh,
    group, retainedGroup, loading: data.loading || Boolean(group && meeting.loading), title: group?.title ?? '', setTitle: field('title'),
    description: group?.description ?? '', setDescription: next => change(current => ({ ...current, description: nextValue(next, current.description ?? '') })),
    status: group?.status ?? 'draft', setStatus: field('status'), templates: group?.templates ?? [], setTemplates: field('templates'),
    flow: group?.flow ?? [], setFlow: field('flow'), meetingDate: first?.date ?? '', setMeetingDate: meeting.field('date'),
    meetingLocation: first?.location ?? '', setMeetingLocation: meeting.field('location'),
    meetingAudience: first?.audience ?? '', setMeetingAudience: meeting.field('audience'),
    meetingFieldsEnabled: meeting.enabled,
    deleteGroupDetail: data.deleteGroupDetail,
    feedback: <DataSyncStatus subject={manual ? meeting.form.recoveryIdentity : data.document.recoveryIdentity} status={status} error={error} errorWords={meeting.form.error ? meeting.form.errorWords : data.document.errorWords}
      onKeepLocal={manual ? meeting.form.keepLocal : data.keepLocal} onAcceptRemote={manual ? meeting.form.acceptRemote : data.acceptRemote} onRetry={manual ? meeting.form.retry : data.refresh}
      recoveryChoices={choices} onRecover={id => id.startsWith('meeting:') ? meeting.recovery.recover(id.slice(8)) : recovery.recover(id.slice(9))}
      recoveryLoading={recovery.loading || meeting.recovery.loading} recoveryError={recovery.error || meeting.recovery.error}
      onDiscardRecovery={action => {
        const selected = choices.find(choice => choice.discard === action);
        return selected?.id.startsWith('meeting:') ? meeting.recovery.discard(action) : recovery.discard(action);
      }} />,
  };
}
