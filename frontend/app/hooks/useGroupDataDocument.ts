'use client';

import { useCallback, useMemo } from 'react';

import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { captureGroupStepPlacement, projectCapturedGroupStep, useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { hydrateGroup, normalizeStoredGroupFlow } from '@/utils/groupDocument';

import type { DocumentUpdateOptions } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';
import type { Group, GroupMeetingDate } from '@/models/models';

/** Domain shape only: ancestry, persistence, delivery, conflict and deletion live in DataEngine. */
export function useGroupDataDocument(groupId: string) {
  const document = useDataDocument({ collection: 'groups', id: groupId }, { slot: 'group' });
  const group = useMemo(() => document.data
    ? hydrateGroup({ ...document.data, id: groupId } as unknown as Group) : null, [document.data, groupId]);
  usePublishShellTitle('groups', groupId, group);
  const changeGroup = useCallback((mutate: (current: Group) => Group) => (current: DocumentData | null) => {
    if (!current) throw new Error('The group is not available for editing');
    const before = hydrateGroup({ ...current, id: groupId } as unknown as Group);
    const next = mutate(before);
    if (next === before) return current;
    // Routing and ownership cannot be changed by a field editor. Membership belongs to series.
    if (next.id !== groupId || next.userId !== before.userId || next.createdAt !== before.createdAt
      || next.seriesId !== before.seriesId || next.seriesPosition !== before.seriesPosition) {
      throw new Error('Group identity and membership are not editable fields');
    }
    const { id: _id, ...value } = next;
    return deepCleanUndefined({ ...value, flow: normalizeStoredGroupFlow(value.flow),
      updatedAt: new Date().toISOString() }) as unknown as DocumentData;
  }, [groupId]);
  const update = useCallback(async (mutate: (current: Group) => Group, options?: DocumentUpdateOptions) => {
    const change = changeGroup(mutate);
    await (options ? document.update(change, options) : document.update(change));
  }, [document, changeGroup]);
  const saveFlowPlan = (mutate: (current: Group) => Group) => document.commit(changeGroup(mutate));
  const moveStep = (stepId: string, transform: (shown: Group['flow']) => Group['flow']) => {
    const opening = document.state?.checkpoint;
    if (!group || !opening?.draft) return Promise.resolve();
    const move = captureGroupStepPlacement(group.flow, transform(group.flow), stepId,
      opening.confirmed.metadata?.generation ?? null, opening.confirmed.metadata?.revision ?? 0, null);
    if (!move) return Promise.resolve();
    return document.commit(current => {
      const flow = projectCapturedGroupStep(current?.flow, move);
      if (!current || !flow) throw Object.assign(new Error('The shown group flow changed'), { code: 'decision-changed' });
      return { ...current, flow };
    }, { kind: 'group-flow-step-placement', move });
  };
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
  const listRecoverable = useCallback(async () => (await document.listRecoverable()).map(source => {
    const { id, record } = source;
    const draft = (record.checkpoint.draft ?? record.checkpoint.confirmed.value) as unknown as Group | null;
    return { id, title: draft?.title || groupId,
      preview: [draft?.description, ...(draft?.templates ?? []).map(item => item.content)].filter(Boolean).join('\n').slice(0, 500),
      discard: () => document.discardRecovery(source) };
  }), [document, groupId]);
  const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
    list: listRecoverable, recover: document.recover });
  return { group, document, update, saveFlowPlan, moveStep, updateGroupDetail, addMeetingDate, updateMeetingDate, removeMeetingDate,
    deleteGroupDetail: document.remove, loading: document.loading, error: document.error, errorWords: document.errorWords, status: document.status,
    recovery, refresh: document.retry, acceptRemote: document.acceptRemote, keepLocal: document.keepLocal };
}
