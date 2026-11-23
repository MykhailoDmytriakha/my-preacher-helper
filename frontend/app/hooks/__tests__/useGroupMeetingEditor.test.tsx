import { act, renderHook } from '@testing-library/react';

import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useGroupMeetingEditor } from '@/hooks/useGroupMeetingEditor';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/groupMeetingAutosave'),
  useDataForm: jest.fn(), useRecoveryDiscovery: jest.fn(),
}));

const meeting = { id: 'meeting', date: '2026-11-21', location: 'Hall', audience: 'Youth', createdAt: 'created' };

it('hands clear-date and location input to the engine with the original action evidence', () => {
  let stage = { meetingDates: [{ ...meeting }] };
  const time = { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 };
  const captureMeetingDateInput = jest.fn(() => ({ meetingDate: { time } }));
  const locationTime = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_030 };
  const captureMeetingField = jest.fn((field: string, rowId: string) => ({ field, rowId, time: locationTime }));
  const update = jest.fn(async (updater: (value: typeof stage) => typeof stage, _action: unknown, _automatic: true) => { stage = updater(stage); });
  const save = jest.fn();
  jest.mocked(useDataForm).mockReturnValue({
    active: true, loading: false, dirty: false, data: stage, captureMeetingDateInput, captureMeetingField,
    begin: jest.fn(), cancel: jest.fn(), save, update,
    listRecoverable: jest.fn(async () => []), recover: jest.fn(), discardRecovery: jest.fn(async () => undefined), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>);
  jest.mocked(useRecoveryDiscovery).mockReturnValue({
    choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn(), discard: jest.fn(async (action: () => Promise<void>) => action()),
  });
  const hook = renderHook(() => useGroupMeetingEditor('group', [meeting], false));
  act(() => hook.result.current.field('date')(''));
  expect(captureMeetingDateInput).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenLastCalledWith(expect.any(Function), { meetingDate: { time } }, true);
  act(() => hook.result.current.field('location')('Side room'));
  expect(captureMeetingField).toHaveBeenCalledWith('location', meeting.id);
  expect(update).toHaveBeenLastCalledWith(expect.any(Function), { field: 'location', rowId: meeting.id, time: locationTime }, true);
  expect(save).not.toHaveBeenCalled();
  expect(stage.meetingDates).toEqual([{ ...meeting, date: '', location: 'Side room' }]);
});

it('captures a history restore in the Save itself and preserves sibling meeting fields', async () => {
  const stage = { meetingDates: [{ ...meeting }] };
  const time = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_015 };
  const action = { rowId: meeting.id, field: 'location', time };
  const save = jest.fn(async (_update: (value: typeof stage) => typeof stage, _action?: unknown) => undefined);
  const update = jest.fn();
  jest.mocked(useDataForm).mockReturnValue({
    active: true, loading: false, dirty: false, data: stage, initialData: stage,
    begin: jest.fn(), cancel: jest.fn(), update, save, captureMeetingField: jest.fn(() => action),
    listRecoverable: jest.fn(async () => []), recover: jest.fn(), discardRecovery: jest.fn(), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>);
  const hook = renderHook(() => useGroupMeetingEditor('group', [meeting], false));
  await act(async () => { await hook.result.current.restoreField(meeting.id, meeting.createdAt, 'location', null); });
  expect(update).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledWith(expect.any(Function), action);
  const restore = save.mock.calls[0][0];
  expect(restore(stage).meetingDates).toEqual([{ id: meeting.id, date: meeting.date, createdAt: meeting.createdAt, audience: meeting.audience }]);
  expect(() => restore({ meetingDates: [{ ...meeting, createdAt: 'replacement' }] })).toThrow('The meeting changed');
});

it('waits for an in-flight save to finish closing the old form before reopening it', () => {
  const begin = jest.fn(async () => undefined);
  const form = {
    active: false, loading: false, dirty: false, busy: true, capturing: false, data: { meetingDates: [{ ...meeting }] },
    begin, cancel: jest.fn(), save: jest.fn(), update: jest.fn(), listRecoverable: jest.fn(async () => []),
    recover: jest.fn(), discardRecovery: jest.fn(async () => undefined), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>;
  jest.mocked(useDataForm).mockReturnValue(form);
  jest.mocked(useRecoveryDiscovery).mockReturnValue({ choices: [], loading: false, error: null, refresh: jest.fn(),
    recover: jest.fn(), discard: jest.fn(async (action: () => Promise<void>) => action()) });
  const { rerender } = renderHook(() => useGroupMeetingEditor('group', [meeting], false));
  expect(begin).not.toHaveBeenCalled();
  jest.mocked(useDataForm).mockReturnValue({ ...form, busy: false });
  rerender();
  expect(begin).toHaveBeenCalledTimes(1);
});
