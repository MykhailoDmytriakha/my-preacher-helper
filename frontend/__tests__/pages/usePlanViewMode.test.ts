import { renderHook, act } from "@testing-library/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import usePlanViewMode from "@/(pages)/(private)/sermons/[id]/plan/usePlanViewMode";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: jest.fn(),
}));

describe("usePlanViewMode", () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockPathname = "/sermons/test-id/plan";

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    });
    (usePathname as jest.Mock).mockReturnValue(mockPathname);
  });

  it("returns null when no planView param is present", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    const { result } = renderHook(() => usePlanViewMode());
    expect(result.current.mode).toBeNull();
    expect(result.current.isOverlay).toBe(false);
  });

  it("returns the mode when planView param is valid", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams("planView=overlay"));
    const { result } = renderHook(() => usePlanViewMode());
    expect(result.current.mode).toBe("overlay");
    expect(result.current.isOverlay).toBe(true);
  });

  it("returns null when planView param is invalid", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams("planView=invalid"));
    const { result } = renderHook(() => usePlanViewMode());
    expect(result.current.mode).toBeNull();
  });

  it("opens overlay with replace:true", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    const { result } = renderHook(() => usePlanViewMode());

    act(() => {
      result.current.openOverlay();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      `${mockPathname}?planView=overlay`,
      { scroll: false }
    );
  });

  it("opens immersive with replace:true", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    const { result } = renderHook(() => usePlanViewMode());

    act(() => {
      result.current.openImmersive();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      `${mockPathname}?planView=immersive`,
      { scroll: false }
    );
  });

  it("opens preaching with replace:false (push)", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    const { result } = renderHook(() => usePlanViewMode());

    act(() => {
      result.current.openPreaching();
    });

    expect(mockPush).toHaveBeenCalledWith(
      `${mockPathname}?planView=preaching`,
      { scroll: false }
    );
  });

  it("closes the view (clears planView param)", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams("planView=overlay"));
    const { result } = renderHook(() => usePlanViewMode());

    act(() => {
      result.current.close();
    });

    expect(mockReplace).toHaveBeenCalledWith(mockPathname, { scroll: false });
  });
});
