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
    listRecoverable: jest.fn(async () => []), recover: jest.fn(), recoveryIdentity: {}, status: null,
  } as unknown as ReturnType<typeof useDataForm>);
  jest.mocked(useRecoveryDiscovery).mockReturnValue({ choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn() });
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
