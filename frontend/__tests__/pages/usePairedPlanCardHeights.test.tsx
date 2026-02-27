import { act, renderHook } from "@testing-library/react";

import usePairedPlanCardHeights from "@/(pages)/(private)/sermons/[id]/plan/usePairedPlanCardHeights";

const setMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
};

const createSizedDiv = (height: number) => {
  const element = document.createElement("div");
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get: () => height,
  });
  return element;
};

describe("usePairedPlanCardHeights", () => {
  const originalRaf = window.requestAnimationFrame;

  beforeEach(() => {
    jest.clearAllMocks();
    setMatchMedia(true);
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    jest.useRealTimers();
    window.requestAnimationFrame = originalRaf;
  });

  it("attaches and detaches resize listener", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: () => null,
      })
    );

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("keeps auto heights on small viewport when syncing all", () => {
    setMatchMedia(false);

    const { result } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: () => null,
      })
    );

    const left = createSizedDiv(120);
    const right = createSizedDiv(80);
    left.style.height = "50px";
    right.style.height = "60px";

    act(() => {
      result.current.registerPairRef("introduction", "p1", "left", left);
      result.current.registerPairRef("introduction", "p1", "right", right);
      result.current.syncAllHeights();
    });

    expect(left.style.height).toBe("auto");
    expect(right.style.height).toBe("auto");
  });

  it("syncs a pair to max height on desktop viewport", () => {
    setMatchMedia(true);

    const { result } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: (pointId) => (pointId === "p1" ? "introduction" : null),
      })
    );

    const left = createSizedDiv(140);
    const right = createSizedDiv(90);

    act(() => {
      result.current.registerPairRef("introduction", "p1", "left", left);
      result.current.registerPairRef("introduction", "p1", "right", right);
      result.current.syncPairHeights("introduction", "p1");
    });

    expect(left.style.height).toBe("140px");
    expect(right.style.height).toBe("140px");
  });

  it("syncs all section pairs on desktop viewport", () => {
    setMatchMedia(true);

    const { result } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: () => null,
      })
    );

    const introLeft = createSizedDiv(100);
    const introRight = createSizedDiv(130);
    const mainLeft = createSizedDiv(170);
    const mainRight = createSizedDiv(90);
    const conclusionLeft = createSizedDiv(55);
    const conclusionRight = createSizedDiv(75);

    act(() => {
      result.current.registerPairRef("introduction", "i1", "left", introLeft);
      result.current.registerPairRef("introduction", "i1", "right", introRight);
      result.current.registerPairRef("main", "m1", "left", mainLeft);
      result.current.registerPairRef("main", "m1", "right", mainRight);
      result.current.registerPairRef("conclusion", "c1", "left", conclusionLeft);
      result.current.registerPairRef("conclusion", "c1", "right", conclusionRight);
      result.current.syncAllHeights();
    });

    expect(introLeft.style.height).toBe("130px");
    expect(introRight.style.height).toBe("130px");
    expect(mainLeft.style.height).toBe("170px");
    expect(mainRight.style.height).toBe("170px");
    expect(conclusionLeft.style.height).toBe("75px");
    expect(conclusionRight.style.height).toBe("75px");
  });

  it("syncs by point id and resets pair heights before applying max height", () => {
    setMatchMedia(true);

    const { result } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: (pointId) => (pointId === "p-reset" ? "main" : null),
      })
    );

    const left = createSizedDiv(200);
    const right = createSizedDiv(120);
    left.style.height = "1px";
    right.style.height = "2px";

    act(() => {
      result.current.registerPairRef("main", "p-reset", "left", left);
      result.current.registerPairRef("main", "p-reset", "right", right);
      result.current.syncPairHeightsByPointId("p-reset");
    });

    expect(left.style.height).toBe("200px");
    expect(right.style.height).toBe("200px");
  });

  it("debounces resize events and clears pending timer on unmount", () => {
    jest.useFakeTimers();
    setMatchMedia(true);

    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const { result, unmount } = renderHook(() =>
      usePairedPlanCardHeights({
        outline: undefined,
        getSectionByPointId: () => null,
      })
    );

    const left = createSizedDiv(90);
    const right = createSizedDiv(140);
    act(() => {
      result.current.registerPairRef("introduction", "resize", "left", left);
      result.current.registerPairRef("introduction", "resize", "right", right);
      jest.advanceTimersByTime(150); // let initial sync settle
      left.style.height = "";
      right.style.height = "";
    });

    expect(left.style.height).toBe("");
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
      jest.advanceTimersByTime(199);
    });
    expect(left.style.height).toBe("");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(left.style.height).toBe("140px");
    expect(right.style.height).toBe("140px");

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
