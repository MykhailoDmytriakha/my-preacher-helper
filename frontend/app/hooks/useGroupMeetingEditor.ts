import { useEffect, useState } from 'react';

import { GROUP_MEETING_SLOT, groupMeetingRows as meetings, normalizeGroupMeetingDraft, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { editFirstGroupMeeting, firstGroupMeetingIdentity, groupMeetingDay, isOrderedMeetingFieldValue } from '@/utils/groupMeeting';

import type { GroupMeetingField } from '@/data-engine/groupMeetingFieldAction';
import type { DocumentData } from '@/data-engine/types';
import type { GroupMeetingDate } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

/** The meeting's fields share one durable stage; only a finished date (or no date) may submit it. */
export function useGroupMeetingEditor(groupId: string, stored: GroupMeetingDate[], pending: boolean, available = true) {
  const form = useDataForm({ collection: 'groups', id: groupId }, GROUP_MEETING_SLOT, [['meetingDates']]);
  const [opened, setOpened] = useState(false);
  const { active, loading, begin, cancel } = form;
  // Save closes its stage before local cleanup settles. Reopening during that gap
  // retires the same form whose promise is still reporting the saved action.
  const settling = form.busy || form.capturing;
  const needsRefresh = available && active && !settling && !form.dirty && !pending && JSON.stringify(meetings(form.data)) !== JSON.stringify(stored);
  useEffect(() => { if (available && !loading && !active && !settling) void begin().catch(() => undefined); }, [available, loading, active, settling, begin]);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  useEffect(() => {
    if (needsRefresh) void cancel().then(begin).catch(() => undefined);
  }, [needsRefresh, cancel, begin]);
  const first = meetings(form.data)[0];
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !form.loading && form.recoveryReady,
    version: JSON.stringify([form.recoveryVersion, form.status?.phase]),
    list: async () => (await form.listRecoverable()).map(source => {
      const { scopeId, record } = source;
      const first = (record.stage[0].value as unknown as GroupMeetingDate[] | undefined)?.[0];
      return { id: scopeId, title: String(record.baseline.value?.title ?? groupId),
        preview: [first?.date, first?.location, first?.audience].filter(Boolean).join(' / '),
        discard: () => form.discardRecovery(source) };
    }), recover: form.recover });
  const field = (key: 'date' | 'location' | 'audience'): Dispatch<SetStateAction<string>> => next => {
    if (!form.active || needsRefresh) return;
    const identity = firstGroupMeetingIdentity(form.initialData) ?? { id: newClientId(), createdAt: new Date().toISOString() };
    const input = key === 'date' ? form.captureMeetingDateInput() : form.captureMeetingField(key, first?.id ?? identity.id);
    void form.update(current => {
      const previous = meetings(current), value = previous[0]?.[key] ?? '';
      const edited = editFirstGroupMeeting(previous, { [key]: typeof next === 'function' ? next(value) : next }, identity);
      return { ...current, meetingDates: edited } as unknown as DocumentData;
    }, input, true).catch(() => undefined);
  };
  const restoreDate = async (rowId: string, date: string) => {
    const chosen = date === '' ? date : groupMeetingDay(date);
    if (!form.active || form.dirty || pending || needsRefresh || chosen === null) throw new Error('The meeting date is not ready');
    const action = form.captureDateAction(rowId, chosen);
    await form.save(current => {
      const rows = meetings(current);
      if (rows[0]?.id !== rowId) throw new Error('The meeting changed');
      return { ...current, meetingDates: [{ ...rows[0], date: chosen }, ...rows.slice(1)] } as unknown as DocumentData;
    }, action);
  };
  const restoreField = async (rowId: string, rowCreatedAt: string, key: GroupMeetingField, value: string | null) => {
    if (!form.active || form.dirty || pending || needsRefresh || (key !== 'location' && key !== 'audience')
      || !isOrderedMeetingFieldValue(value)) throw new Error('The meeting field is not ready');
    const action = form.captureMeetingField(key, rowId);
    await form.save(current => {
      const normalized = normalizeGroupMeetingDraft(current, form.initialData);
      const rows = meetings(normalized);
      if (rows[0]?.id !== rowId || rows[0].createdAt !== rowCreatedAt) throw new Error('The meeting changed');
      const restored = { ...rows[0] };
      if (value === null) delete restored[key];
      else restored[key] = value;
      return { ...normalized, meetingDates: [restored, ...rows.slice(1)] } as unknown as DocumentData;
    }, action);
  };
  return { form, recovery, first, field, restoreDate, restoreField, loading: !opened || loading, enabled: active && !needsRefresh };
}
