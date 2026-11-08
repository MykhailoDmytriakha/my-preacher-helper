import { act, renderHook } from '@testing-library/react';

import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useGroupMeetingEditor } from '@/hooks/useGroupMeetingEditor';

jest.mock('@/data-engine/react.client', () => ({ useDataForm: jest.fn(), useRecoveryDiscovery: jest.fn() }));

const meeting = { id: 'meeting', date: '2026-11-21', location: 'Hall', audience: 'Youth', createdAt: 'created' };

it('flushes the engine-owned stage even before React publishes its dirty state', async () => {
  let stage = { meetingDates: [{ ...meeting }] };
  const save = jest.fn(async (updater: (value: typeof stage) => typeof stage) => { stage = updater(stage); });
  jest.mocked(useDataForm).mockReturnValue({
    active: true, loading: false, dirty: false, data: { meetingDates: [{ ...meeting }] },
    begin: jest.fn(), cancel: jest.fn(), save,
    update: jest.fn(async updater => { stage = updater(stage) as typeof stage; }),
    listRecoverable: jest.fn(async () => []), recover: jest.fn(), discardRecovery: jest.fn(async () => undefined), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>);
  jest.mocked(useRecoveryDiscovery).mockReturnValue({ choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn(), discard: jest.fn(async (action: () => Promise<void>) => action()) });
  const hook = renderHook(() => useGroupMeetingEditor('group', [meeting], false));
  act(() => {
    hook.result.current.field('location')('Hall from the last browser event');
    window.dispatchEvent(new Event('pagehide'));
  });
  await act(async () => { await Promise.resolve(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(stage.meetingDates[0].location).toBe('Hall from the last browser event');
  hook.unmount();
});

it('captures the cleared date before autosave and leaves that action intact when the location changes', async () => {
  let stage = { meetingDates: [{ ...meeting }] };
  const time = { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 };
  const captureDateAction = jest.fn((rowId: string, after: string) => ({ rowId, after, time }));
  const save = jest.fn(async (updater: (value: typeof stage) => typeof stage) => { stage = updater(stage); });
  jest.mocked(useDataForm).mockReturnValue({
    active: true, loading: false, dirty: false, data: { meetingDates: [{ ...meeting }] }, captureDateAction,
    begin: jest.fn(), cancel: jest.fn(), save,
    update: jest.fn(async updater => { stage = updater(stage) as typeof stage; }),
    listRecoverable: jest.fn(async () => []), recover: jest.fn(), discardRecovery: jest.fn(async () => undefined), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>);
  const hook = renderHook(() => useGroupMeetingEditor('group', [meeting], false));
  act(() => hook.result.current.field('date')(''));
  expect(captureDateAction).toHaveBeenCalledWith(meeting.id, '');
  expect(save).not.toHaveBeenCalled();
  act(() => {
    hook.result.current.field('location')('Side room');
    window.dispatchEvent(new Event('pagehide'));
  });
  await act(async () => { await Promise.resolve(); });
  expect(save).toHaveBeenCalledWith(expect.any(Function), { rowId: meeting.id, after: '', time });
  expect(stage.meetingDates).toEqual([{ ...meeting, date: '', location: 'Side room' }]);
  hook.unmount();
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
