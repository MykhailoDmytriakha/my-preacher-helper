'use client';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';
import { newClientId } from '@/utils/clientId';

import type { GroupPageEditor } from './groupPageEditor';
import type { Group } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

const nextValue = <T,>(next: SetStateAction<T>, previous: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(previous) : next;

/** No second form buffer, baseline, save timer, observer or conflict policy. */
export function useGroupPageEditor(groupId: string): GroupPageEditor {
  const data = useGroupDataDocument(groupId);
  const group = data.group;
  // The public facade records failures for DataSyncStatus; a React event cannot await them.
  const change = (mutate: (current: Group) => Group) => { void data.update(mutate).catch(() => undefined); };
  const field = <K extends 'title' | 'status' | 'templates' | 'flow'>(key: K): Dispatch<SetStateAction<Group[K]>> =>
    next => change(current => ({ ...current, [key]: nextValue(next, current[key]) }));
  const first = group?.meetingDates?.[0];
  const meetingField = (key: 'location' | 'audience'): Dispatch<SetStateAction<string>> => next => change(current => {
    const meetings = current.meetingDates ?? [];
    if (!meetings[0]) throw new Error('Choose a meeting date before editing its details');
    return { ...current, meetingDates: meetings.map((meeting, index) => index ? meeting
      : { ...meeting, [key]: nextValue(next, meeting[key] ?? '') }) };
  });
  const setMeetingDate: Dispatch<SetStateAction<string>> = next => {
    // Mint once per user action; retries of this document keep the same embedded identity.
    const id = newClientId(), createdAt = new Date().toISOString();
    change(current => {
      const meetings = current.meetingDates ?? [], previous = meetings[0];
      const date = nextValue(next, previous?.date ?? '');
      if (!date) return { ...current, meetingDates: previous ? meetings.slice(1) : meetings };
      return { ...current, meetingDates: previous
        ? [{ ...previous, date }, ...meetings.slice(1)] : [{ id, createdAt, date }] };
    });
  };
  const recovery = data.recovery;
  return {
    group, loading: data.loading, title: group?.title ?? '', setTitle: field('title'),
    description: group?.description ?? '', setDescription: next => change(current => ({ ...current, description: nextValue(next, current.description ?? '') })),
    status: group?.status ?? 'draft', setStatus: field('status'), templates: group?.templates ?? [], setTemplates: field('templates'),
    flow: group?.flow ?? [], setFlow: field('flow'), meetingDate: first?.date ?? '', setMeetingDate,
    meetingLocation: first?.location ?? '', setMeetingLocation: meetingField('location'),
    meetingAudience: first?.audience ?? '', setMeetingAudience: meetingField('audience'),
    meetingFieldsEnabled: Boolean(first?.date),
    // Compatibility with the shared view; update() already persists and the engine schedules delivery.
    debouncedSave: () => undefined, saveStatus: '', deleteGroupDetail: data.deleteGroupDetail,
    feedback: <DataSyncStatus status={data.status} error={data.error}
      onKeepLocal={data.keepLocal} onAcceptRemote={data.acceptRemote} onRetry={data.refresh}
      recoveryChoices={recovery.choices} onListRecovery={recovery.refresh} onRecover={recovery.recover}
      recoveryLoading={recovery.loading} recoveryError={recovery.error} />,
  };
}
