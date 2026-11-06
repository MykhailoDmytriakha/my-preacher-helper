import { act, cleanup } from '@testing-library/react';

/** Finish actual jsdom history tasks, including compensation queued by a popstate handler. */
export async function runHistoryAction(action: () => void): Promise<void> {
  await act(async () => { action(); });
  while (jest.getTimerCount() > 0) {
    await act(async () => { await jest.runAllTimersAsync(); });
  }
}

/** These suites own their virtual task queue; no elapsed wall-clock delay proves traversal finished. */
export function installHistoryTimers(resetHistory?: () => void): void {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'performance'] });
  });
  afterEach(async () => {
    try {
      cleanup();
      await runHistoryAction(() => undefined);
      resetHistory?.();
    } finally {
      jest.useRealTimers();
    }
  });
}
