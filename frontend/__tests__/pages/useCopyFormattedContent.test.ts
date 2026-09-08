import { act, renderHook } from "@testing-library/react";

import { COPY_STATUS } from "@/(pages)/(private)/sermons/[id]/plan/constants";
import useCopyFormattedContent from "@/(pages)/(private)/sermons/[id]/plan/useCopyFormattedContent";
import { toast } from "sonner";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const translate = (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key;

describe("useCopyFormattedContent", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("sets success state and resets to idle after timeout", async () => {
    const { result } = renderHook(() => useCopyFormattedContent({ t: translate }));

    await act(async () => {
      await result.current.runCopy(async () => true);
    });

    expect(result.current.status).toBe(COPY_STATUS.SUCCESS);
    expect(toast.success).toHaveBeenCalledWith("plan.copySuccess");
    expect(toast.error).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(result.current.status).toBe(COPY_STATUS.SUCCESS);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe(COPY_STATUS.IDLE);
  });

  it("sets error state and resets to idle after timeout", async () => {
    const { result } = renderHook(() => useCopyFormattedContent({ t: translate }));

    await act(async () => {
      await result.current.runCopy(async () => false);
    });

    expect(result.current.status).toBe(COPY_STATUS.ERROR);
    expect(toast.error).toHaveBeenCalledWith("plan.copyError");
    expect(toast.success).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2499);
    });
    expect(result.current.status).toBe(COPY_STATUS.ERROR);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe(COPY_STATUS.IDLE);
  });

  it("cleans pending timeout on unmount", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const { result, unmount } = renderHook(() => useCopyFormattedContent({ t: translate }));

    await act(async () => {
      await result.current.runCopy(async () => true);
    });

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("ignores a second copy request while copying is already in progress", async () => {
    let resolveCopy: ((value: boolean) => void) | null = null;
    const deferredPromise = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const copyOperation = jest.fn(() => deferredPromise);
    const { result } = renderHook(() => useCopyFormattedContent({ t: translate }));

    let firstRunPromise: Promise<void> | undefined;
    act(() => {
      firstRunPromise = result.current.runCopy(copyOperation);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe(COPY_STATUS.COPYING);

    act(() => {
      void result.current.runCopy(copyOperation);
    });

    expect(copyOperation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCopy?.(true);
      await firstRunPromise!;
    });

    expect(result.current.status).toBe(COPY_STATUS.SUCCESS);
  });

  it("handles copy operation exceptions as an error result", async () => {
    const { result } = renderHook(() => useCopyFormattedContent({ t: translate }));

    await act(async () => {
      await result.current.runCopy(async () => {
        throw new Error("clipboard failed");
      });
    });

    expect(result.current.status).toBe(COPY_STATUS.ERROR);
    expect(toast.error).toHaveBeenCalledWith("plan.copyError");
  });
});


it.each(['reset', 'unmount'] as const)('does not publish pending copy feedback after %s', async action => {
  let finish!: (value: boolean) => void;
  const operation = new Promise<boolean>(resolve => { finish = resolve; });
  const { result, unmount } = renderHook(() => useCopyFormattedContent({ t: translate }));
  jest.clearAllMocks();
  let pending!: Promise<void>;
  act(() => { pending = result.current.runCopy(() => operation); });
  act(() => { if (action === 'reset') result.current.resetToIdle(); else unmount(); });
  await act(async () => { finish(true); await pending; });
  expect(toast.success).not.toHaveBeenCalled();
  if (action === 'reset') expect(result.current.status).toBe(COPY_STATUS.IDLE);
});

it('ignores a duplicate request in the same event before React renders', async () => {
  let finish!: (value: boolean) => void;
  const operation = jest.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useCopyFormattedContent({ t: translate }));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.runCopy(operation);
    void result.current.runCopy(operation);
  });
  const calls = operation.mock.calls.length;
  await act(async () => { finish(true); });
  expect(calls).toBe(1);
  await pending;
});
