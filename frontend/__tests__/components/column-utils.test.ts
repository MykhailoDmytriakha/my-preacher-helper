import {
  getAdjacentSectionIds,
  getForceTagForContainer,
  getOutlineInsertAccent,
  getPlaceholderColors,
  getReviewToggleLabel,
  getSectionBorderColor,
  getSectionHeaderBgStyle,
  isColumnSectionId,
  isPendingItem,
  isPointAudioSection,
  mapColumnIdToSectionType,
  openPointEditor,
} from "@/components/column/utils";
import type { SermonPoint } from "@/models/models";
import { getCanonicalTagForSection } from "@/utils/tagUtils";

jest.mock("@/utils/tagUtils", () => ({
  getCanonicalTagForSection: jest.fn((section: string) => `${section}-tag`),
}));

describe("column utils", () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    (options?.defaultValue as string | undefined) ?? key;

  it("covers section mapping and palette helpers", () => {
    expect(isColumnSectionId("main")).toBe(true);
    expect(isColumnSectionId("ambiguous")).toBe(false);
    expect(isPointAudioSection("conclusion")).toBe(true);

    expect(getPlaceholderColors("introduction")).toEqual(
      expect.objectContaining({
        border: expect.stringContaining("border-amber-200"),
        bg: expect.stringContaining("bg-amber-50"),
      })
    );
    expect(getPlaceholderColors("custom", "#123456")).toEqual({
      border: "border-2 border-opacity-30",
      bg: "bg-gray-50 dark:bg-gray-800",
      header: "bg-gray-100 dark:bg-gray-700",
      headerText: "text-gray-700 dark:text-gray-200",
    });
    expect(getPlaceholderColors("unknown")).toEqual({
      border: "border-2 border-gray-200 dark:border-gray-700",
      bg: "bg-gray-50 dark:bg-gray-800",
      header: "bg-gray-100 dark:bg-gray-700",
      headerText: "text-gray-700 dark:text-gray-200",
    });

    expect(getForceTagForContainer("introduction")).toBe("introduction-tag");
    expect(getForceTagForContainer("main")).toBe("main-tag");
    expect(getForceTagForContainer("conclusion")).toBe("conclusion-tag");
    expect(getForceTagForContainer("ambiguous")).toBeUndefined();
    expect(getCanonicalTagForSection).toHaveBeenCalledWith("conclusion");

    expect(getSectionHeaderBgStyle("main")).toEqual({ backgroundColor: "#2563eb" });
    expect(getSectionHeaderBgStyle("other", "#abcdef")).toEqual({ backgroundColor: "#abcdef" });
    expect(getSectionBorderColor("conclusion")).toBe("border-green-200");
    expect(getSectionBorderColor("other")).toBe("border-gray-200");
    expect(getSectionBorderColor("main", "#abcdef")).toBe("");

    expect(getOutlineInsertAccent("main")).toEqual(
      expect.objectContaining({
        badgeClassName: expect.stringContaining("border-blue-200"),
        badgeShadowStyle: expect.objectContaining({
          boxShadow: expect.stringContaining("#2563eb"),
        }),
      })
    );
    expect(getOutlineInsertAccent("other")).toEqual(
      expect.objectContaining({
        badgeClassName: expect.stringContaining("border-blue-200"),
        lineStyle: expect.objectContaining({
          background: expect.stringContaining("#3b82f6"),
        }),
      })
    );

    expect(getAdjacentSectionIds("introduction")).toEqual({
      previousSectionId: null,
      nextSectionId: "main",
    });
    expect(getAdjacentSectionIds("main")).toEqual({
      previousSectionId: "introduction",
      nextSectionId: "conclusion",
    });
    expect(getAdjacentSectionIds("ambiguous")).toEqual({
      previousSectionId: null,
      nextSectionId: null,
    });
  });

  it("covers editing helpers and structural lookups", () => {
    const reviewedPoint: SermonPoint = { id: "p-1", text: "Reviewed", isReviewed: true };
    const editablePoint: SermonPoint = { id: "p-2", text: "Editable" };
    const setLocalEditText = jest.fn();
    const setIsEditingLocally = jest.fn();
    const onEditPoint = jest.fn();

    openPointEditor({
      point: reviewedPoint,
      isLocked: true,
      setLocalEditText,
      setIsEditingLocally,
      onEditPoint,
    });
    expect(setLocalEditText).not.toHaveBeenCalled();

    openPointEditor({
      point: editablePoint,
      isFocusMode: true,
      setLocalEditText,
      setIsEditingLocally,
      onEditPoint,
    });
    expect(onEditPoint).toHaveBeenCalledWith(editablePoint);

    openPointEditor({
      point: editablePoint,
      setLocalEditText,
      setIsEditingLocally,
      onEditPoint,
    });
    expect(setLocalEditText).toHaveBeenCalledWith("Editable");
    expect(setIsEditingLocally).toHaveBeenCalledWith(true);

    expect(getReviewToggleLabel(true, t)).toBe("Unlock all thoughts in this outline point");
    expect(getReviewToggleLabel(false, t)).toBe("Lock all thoughts in this outline point");

    expect(mapColumnIdToSectionType("introduction")).toBe("introduction");
    expect(mapColumnIdToSectionType("main")).toBe("mainPart");
    expect(mapColumnIdToSectionType("conclusion")).toBe("conclusion");
    expect(mapColumnIdToSectionType("ambiguous")).toBeNull();

    expect(isPendingItem({ id: "local-thought-1", content: "", customTagNames: [] } as any)).toBe(true);
    expect(
      isPendingItem({ id: "server-1", content: "", customTagNames: [], syncStatus: "error" } as any)
    ).toBe(true);
    expect(isPendingItem({ id: "server-2", content: "", customTagNames: [] } as any)).toBe(false);
  });
});
