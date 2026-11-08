import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useAutoSave } from '@/hooks/useAutoSave';
import { fillRequiredFieldError } from '@/utils/actionFailureMessage';
import { newClientId } from '@/utils/clientId';
import { editFirstGroupMeeting, groupMeetingDay, isOrderedMeetingFieldValue, isReadyGroupMeetingDate } from '@/utils/groupMeeting';

import type { DatedRowActionCapture } from '@/data-engine/datedRowAction';
import type { GroupMeetingField } from '@/data-engine/groupMeetingFieldAction';
import type { DocumentData } from '@/data-engine/types';
import type { GroupMeetingDate } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

const meetings = (value: DocumentData | null | undefined) => (value?.meetingDates ?? []) as unknown as GroupMeetingDate[];
const keepsInitialDate = (first: GroupMeetingDate, initial: DocumentData | null | undefined) =>
  meetings(initial).some(previous => previous.id === first.id && previous.date === first.date);
const canSave = (value: DocumentData, initial: DocumentData | null | undefined) => {
  const first = meetings(value)[0];
  return !first || isReadyGroupMeetingDate(first.date) || keepsInitialDate(first, initial);
};

/** The meeting's fields share one durable stage; only a finished date (or no date) may submit it. */
export function useGroupMeetingEditor(groupId: string, stored: GroupMeetingDate[], pending: boolean, available = true) {
  const form = useDataForm({ collection: 'groups', id: groupId }, 'group-meeting', [['meetingDates']]);
  const [opened, setOpened] = useState(false);
  const latest = useRef(form); latest.current = form;
  const dateAction = useRef<{ scope: object; action: DatedRowActionCapture | undefined }>(undefined);
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
  const normalize = (current: DocumentData) => {
    if (!canSave(current, latest.current.initialData)) throw fillRequiredFieldError('workspaces.groups.meetings.title');
    return { ...current, meetingDates: meetings(current).map((meeting, index) => index || keepsInitialDate(meeting, latest.current.initialData) ? meeting : { ...meeting, date: meeting.date.trim() }) } as unknown as DocumentData;
  };
  const { debouncedSave } = useAutoSave(async () => {
    const current = latest.current;
    // A browser pagehide may precede React's next render. Save reads the engine-owned stage,
    // never the render's possibly older active/dirty flags. Partial input cancels this schedule.
    const capture = dateAction.current;
    const action = capture?.scope === current.recoveryIdentity ? capture.action : undefined;
    void (action ? current.save(normalize, action) : current.save(normalize)).catch(() => undefined);
  }, { delay: 750 });
  useLayoutEffect(() => () => { debouncedSave.flush(); }, [debouncedSave]);
  useEffect(() => {
    const flush = () => { debouncedSave.flush(); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
  }, [debouncedSave]);
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
    const identity = { id: newClientId(), createdAt: new Date().toISOString() };
    if (!form.active || needsRefresh) return;
    const input = key !== 'date' && first ? form.captureMeetingField(key, first.id) : undefined;
    let ready = false;
    void form.update(current => {
      const previous = meetings(current), value = previous[0]?.[key] ?? '';
      const edited = editFirstGroupMeeting(previous, { [key]: typeof next === 'function' ? next(value) : next }, identity);
      ready = canSave({ meetingDates: edited } as unknown as DocumentData, form.initialData);
      if (key === 'date' && edited[0]?.date !== previous[0]?.date) {
        const action = ready && previous[0] && edited[0] ? form.captureDateAction(previous[0].id, edited[0].date.trim()) : undefined;
        dateAction.current = { scope: form.recoveryIdentity, action };
      }
      return { ...current, meetingDates: edited } as unknown as DocumentData;
    }, input).catch(() => undefined);
    if (ready) debouncedSave();
    else debouncedSave.cancel();
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
      const normalized = normalize(current);
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
