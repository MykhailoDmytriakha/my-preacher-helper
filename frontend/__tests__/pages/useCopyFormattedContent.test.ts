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
    jest.useFakeTimers();
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
});
