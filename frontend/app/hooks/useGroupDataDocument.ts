'use client';

import { useCallback, useMemo } from 'react';

import { useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { hydrateGroup, normalizeStoredGroupFlow } from '@/utils/groupDocument';

import type { DocumentData } from '@/data-engine/types';
import type { Group, GroupMeetingDate } from '@/models/models';

/** Domain shape only: ancestry, persistence, delivery, conflict and deletion live in DataEngine. */
export function useGroupDataDocument(groupId: string) {
  const document = useDataDocument({ collection: 'groups', id: groupId }, { slot: 'group' });
  const group = useMemo(() => document.data
    ? hydrateGroup({ ...document.data, id: groupId } as unknown as Group) : null, [document.data, groupId]);
  const update = useCallback(async (mutate: (current: Group) => Group) => {
    await document.update(current => {
      if (!current) throw new Error('The group is not available for editing');
      const before = hydrateGroup({ ...current, id: groupId } as unknown as Group);
      const next = mutate(before);
      // Routing and ownership cannot be changed by a field editor. Membership belongs to series.
      if (next.id !== groupId || next.userId !== before.userId || next.createdAt !== before.createdAt
        || next.seriesId !== before.seriesId || next.seriesPosition !== before.seriesPosition) {
        throw new Error('Group identity and membership are not editable fields');
      }
      const { id: _id, ...value } = next;
      return deepCleanUndefined({ ...value, flow: normalizeStoredGroupFlow(value.flow),
        updatedAt: new Date().toISOString() }) as unknown as DocumentData;
    });
  }, [document, groupId]);
  const updateGroupDetail = useCallback((patch: Partial<Group>) => update(current => ({ ...current, ...patch })), [update]);
  const addMeetingDate = useCallback(async (input: Omit<GroupMeetingDate, 'id' | 'createdAt'> & { id?: string }) => {
    const meeting: GroupMeetingDate = { ...input, id: input.id ?? newClientId(), createdAt: new Date().toISOString() };
    await update(current => {
      if (current.meetingDates?.some(item => item.id === meeting.id)) throw new Error('Meeting identity already exists');
      return { ...current, meetingDates: [...(current.meetingDates ?? []), meeting] };
    });
    return meeting;
  }, [update]);
  const updateMeetingDate = useCallback((id: string, patch: Partial<GroupMeetingDate>) => update(current => {
    if (!current.meetingDates?.some(item => item.id === id)) throw new Error('Meeting date not found');
    return { ...current, meetingDates: current.meetingDates.map(item => item.id === id
      ? { ...item, ...patch, id: item.id, createdAt: item.createdAt } : item) };
  }), [update]);
  const removeMeetingDate = useCallback((id: string) => update(current => ({ ...current,
    meetingDates: (current.meetingDates ?? []).filter(item => item.id !== id) })), [update]);
  const listRecoverable = useCallback(async () => (await document.listRecoverable()).map(({ id, record }) => {
    const draft = (record.checkpoint.draft ?? record.checkpoint.confirmed.value) as unknown as Group | null;
    return { id, title: draft?.title || groupId,
      preview: [draft?.description, ...(draft?.templates ?? []).map(item => item.content)].filter(Boolean).join('\n').slice(0, 500) };
  }), [document, groupId]);
  const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
    list: listRecoverable, recover: document.recover });
  return { group, document, update, updateGroupDetail, addMeetingDate, updateMeetingDate, removeMeetingDate,
    deleteGroupDetail: document.remove, loading: document.loading, error: document.error, status: document.status,
    recovery, refresh: document.retry, acceptRemote: document.acceptRemote, keepLocal: document.keepLocal };
}
