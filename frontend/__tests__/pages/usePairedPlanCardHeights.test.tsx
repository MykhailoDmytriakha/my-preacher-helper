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
});

