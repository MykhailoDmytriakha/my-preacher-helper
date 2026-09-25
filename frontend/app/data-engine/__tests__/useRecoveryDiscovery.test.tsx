import { act, renderHook, waitFor } from '@testing-library/react';

import { useRecoveryDiscovery } from '../useRecoveryDiscovery';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

it('discovers on opening and after delivery changes without restoring anything automatically', async () => {
  const list = jest.fn().mockResolvedValue(['unfinished']);
  const recover = jest.fn().mockResolvedValue(undefined);
  const identity = {};
  const hook = renderHook(({ version }) => useRecoveryDiscovery({ identity, enabled: true, version, list, recover }), { initialProps: { version: '1' } });
  await waitFor(() => expect(hook.result.current.choices).toEqual(['unfinished']));
  expect(recover).not.toHaveBeenCalled();
  list.mockResolvedValue([]);
  hook.rerender({ version: '2' });
  await waitFor(() => expect(hook.result.current.choices).toEqual([]));
  expect(list).toHaveBeenCalledTimes(2);
});

it('does not show a previous owner response or use a stale recovery action', async () => {
  const pending = deferred<string[]>();
  const first = {}, second = {};
  const list = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(['other owner']);
  const recover = jest.fn();
  const hook = renderHook(({ identity }) => useRecoveryDiscovery({ identity, enabled: true, version: '1', list, recover }), { initialProps: { identity: first } });
  const stale = hook.result.current.recover;
  hook.rerender({ identity: second });
  await waitFor(() => expect(hook.result.current.choices).toEqual(['other owner']));
  await act(async () => pending.resolve(['private previous draft']));
  expect(hook.result.current.choices).toEqual(['other owner']);
  await expect(stale('old')).rejects.toThrow('changed');
  expect(recover).not.toHaveBeenCalled();
});

it('keeps the newest discovery result and surfaces a storage failure', async () => {
  const pending = deferred<string[]>();
  const identity = {};
  const list = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(['latest']);
  const hook = renderHook(() => useRecoveryDiscovery({ identity, enabled: true, version: '1', list, recover: jest.fn() }));
  await act(async () => { await hook.result.current.refresh(); });
  await act(async () => pending.resolve(['obsolete']));
  expect(hook.result.current.choices).toEqual(['latest']);
  list.mockRejectedValue(new Error('Storage unavailable'));
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.error).toBe('Storage unavailable');
  expect(hook.result.current.choices).toEqual(['latest']);
});

it('waits for the document and rescans after an explicit recovery', async () => {
  const identity = {};
  const list = jest.fn().mockResolvedValue(['draft']);
  const recover = jest.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ enabled }) => useRecoveryDiscovery({ identity, enabled, version: '1', list, recover }), { initialProps: { enabled: false } });
  expect(list).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.choices).toEqual(['draft']));
  list.mockResolvedValue([]);
  await act(async () => { await hook.result.current.recover('draft'); });
  expect(recover).toHaveBeenCalledWith('draft');
  expect(hook.result.current.choices).toEqual([]);
  hook.unmount();
  await expect(hook.result.current.recover('draft')).rejects.toThrow('changed');
});
