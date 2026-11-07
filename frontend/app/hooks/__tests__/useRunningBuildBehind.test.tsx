import { act, renderHook, waitFor } from '@testing-library/react';

import { useRunningBuildBehind } from '@/hooks/useRunningBuildBehind';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

/**
 * BUG-20261107-outdated-tab-refusal-unexplained: whether a tab showing a refusal is older than the server.
 * Asked only while a refusal is shown; an unanswered check is asked again when the network returns; every
 * answer replaces the last; asks under way share one request.
 */
describe('useRunningBuildBehind', () => {
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const originalFetch = global.fetch;
  const serves = (version: string) => ({ ok: true, json: async () => ({ version }) });
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_VERSION = '391f890'; __resetConnectivityForTests(); });
  afterEach(() => { process.env.NEXT_PUBLIC_APP_VERSION = originalVersion; global.fetch = originalFetch; __resetConnectivityForTests(); });

  it('does not ask while no refusal is shown', async () => {
    global.fetch = jest.fn().mockResolvedValue(serves('9eac14b')) as unknown as typeof fetch;
    const { result } = renderHook(() => useRunningBuildBehind(false));
    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  // The app's connection answer can come back without a browser `online` event (Wi-Fi stayed up, the server returned).
  it('asks again when the app finds the server again after a check that could not be answered', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(serves('9eac14b')) as unknown as typeof fetch;
    const { result } = renderHook(() => useRunningBuildBehind(true));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
    await act(async () => { reportServerUnreachable(); reportServerReachable(); });
    await waitFor(() => expect(result.current).toBe(true));
  });

  // A reason to ask that arrives while a check is under way must not be answered by that check's failure.
  it('asks once more when the page returns while a check is still under way and that check then fails', async () => {
    let fail!: (reason: unknown) => void;
    global.fetch = jest.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue(serves('9eac14b')) as unknown as typeof fetch;
    const { result } = renderHook(() => useRunningBuildBehind(true));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { fail(new TypeError('Failed to fetch')); });
    await waitFor(() => expect(result.current).toBe(true));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('forgets the verdict when the refusal goes, and takes the next answer as it is', async () => {
    global.fetch = jest.fn().mockResolvedValue(serves('9eac14b')) as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ active }) => useRunningBuildBehind(active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ active: false });
    expect(result.current).toBe(false);
    // The server was rolled back to this tab's build: the next refusal is an ordinary one.
    global.fetch = jest.fn().mockResolvedValue(serves('391f890')) as unknown as typeof fetch;
    rerender({ active: true });
    expect(result.current).toBe(false);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
  });

  it('lets several refusals shown at once share one request', async () => {
    global.fetch = jest.fn().mockResolvedValue(serves('9eac14b')) as unknown as typeof fetch;
    const first = renderHook(() => useRunningBuildBehind(true));
    const second = renderHook(() => useRunningBuildBehind(true));
    await waitFor(() => expect(first.result.current && second.result.current).toBe(true));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
