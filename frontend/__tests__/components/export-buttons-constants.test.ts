import {
  ACTIVE_BUTTON_CLASS,
  AUDIO_BUTTON_LABEL,
  INACTIVE_BUTTON_CLASS,
  LAYOUT_CLASS_BY_ORIENTATION,
  TOOLTIP_POSITION_BY_ORIENTATION,
} from "@/components/export-buttons/constants";

describe("export-buttons constants", () => {
  it("exposes stable layout and tooltip mappings", () => {
    expect(AUDIO_BUTTON_LABEL).toBe("Audio (Beta)");
    expect(LAYOUT_CLASS_BY_ORIENTATION).toEqual({
      horizontal: "flex-row",
      vertical: "flex-col",
    });
    expect(TOOLTIP_POSITION_BY_ORIENTATION).toEqual({
      horizontal: "tooltiptext-top",
      vertical: "tooltiptext-right",
    });
  });

  it("keeps the active and inactive button class contracts intact", () => {
    expect(ACTIVE_BUTTON_CLASS).toContain("bg-blue-500");
    expect(ACTIVE_BUTTON_CLASS).toContain("text-white");
    expect(INACTIVE_BUTTON_CLASS).toContain("text-gray-700");
    expect(INACTIVE_BUTTON_CLASS).toContain("hover:bg-gray-200");
  });
});
