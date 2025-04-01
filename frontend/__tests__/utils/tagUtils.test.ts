import { isStructureTag, getDefaultTagStyling, getStructureIcon, getTagStyle } from "../../app/utils/tagUtils";
import { getContrastColor } from "../../app/utils/color";

// Mock color utility
jest.mock("../../app/utils/color", () => ({
  getContrastColor: jest.fn(),
}));

describe("tagUtils", () => {
  beforeEach(() => {
    // Reset mock implementation
    (getContrastColor as jest.Mock).mockImplementation((color) => 
      color === "#FFFFFF" ? "#000000" : "#FFFFFF"
    );
  });

  describe("isStructureTag", () => {
    test("identifies intro tags in different languages", () => {
      expect(isStructureTag("intro")).toBe(true);
      expect(isStructureTag("Intro")).toBe(true);
      expect(isStructureTag("вступление")).toBe(true);
      expect(isStructureTag("Вступление")).toBe(true);
      expect(isStructureTag("вступ")).toBe(true);
    });

    test("identifies main tags in different languages", () => {
      expect(isStructureTag("main")).toBe(true);
      expect(isStructureTag("Main")).toBe(true);
      expect(isStructureTag("основная часть")).toBe(true);
      expect(isStructureTag("Основная часть")).toBe(true);
      expect(isStructureTag("основна частина")).toBe(true);
    });

    test("identifies conclusion tags in different languages", () => {
      expect(isStructureTag("conclusion")).toBe(true);
      expect(isStructureTag("Conclusion")).toBe(true);
      expect(isStructureTag("заключение")).toBe(true);
      expect(isStructureTag("Заключение")).toBe(true);
      expect(isStructureTag("висновок")).toBe(true);
    });

    test("returns false for non-structure tags", () => {
      expect(isStructureTag("important")).toBe(false);
      expect(isStructureTag("quote")).toBe(false);
      expect(isStructureTag("example")).toBe(false);
      expect(isStructureTag("application")).toBe(false);
    });
  });

  describe("getDefaultTagStyling", () => {
    test("returns blue styling for intro tags", () => {
      const styling = getDefaultTagStyling("вступление");
      expect(styling.bg).toContain("blue");
      expect(styling.text).toContain("blue");
    });

    test("returns purple styling for main tags", () => {
      const styling = getDefaultTagStyling("main");
      expect(styling.bg).toContain("purple");
      expect(styling.text).toContain("purple");
    });

    test("returns green styling for conclusion tags", () => {
      const styling = getDefaultTagStyling("заключение");
      expect(styling.bg).toContain("green");
      expect(styling.text).toContain("green");
    });

    test("returns indigo styling for other tags", () => {
      const styling = getDefaultTagStyling("example");
      expect(styling.bg).toContain("indigo");
      expect(styling.text).toContain("indigo");
    });
  });

  describe("getStructureIcon", () => {
    test("returns intro icon for intro tags", () => {
      const icon = getStructureIcon("вступление");
      expect(icon).not.toBeNull();
      expect(icon!.svg).toContain("<polyline points=\"4 17 10 11 4 5\"></polyline>");
    });

    test("returns main icon for main tags", () => {
      const icon = getStructureIcon("main");
      expect(icon).not.toBeNull();
      expect(icon!.svg).toContain("<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"></rect>");
    });

    test("returns conclusion icon for conclusion tags", () => {
      const icon = getStructureIcon("заключение");
      expect(icon).not.toBeNull();
      expect(icon!.svg).toContain("<polyline points=\"20 17 10 11 20 5\"></polyline>");
    });

    test("returns null for non-structure tags", () => {
      const icon = getStructureIcon("example");
      expect(icon).toBeNull();
    });
  });

  describe("getTagStyle", () => {
    test("returns correct styling for structure tag with color", () => {
      const { className, style } = getTagStyle("intro", "#FF0000");
      
      expect(className).toContain("rounded-full");
      expect(className).toContain("font-medium");
      expect(style.backgroundColor).toBe("#FF0000");
      expect(style.boxShadow).toBeDefined();
      expect(style.border).toBeDefined();
    });

    test("returns correct styling for non-structure tag with color", () => {
      const { className, style } = getTagStyle("example", "#00FF00");
      
      expect(className).toContain("rounded-full");
      expect(className).not.toContain("font-medium");
      expect(style.backgroundColor).toBe("#00FF00");
      expect(style.boxShadow).toBeUndefined();
      expect(style.border).toBeUndefined();
    });

    test("returns correct styling for structure tag without color", () => {
      const { className, style } = getTagStyle("conclusion");
      
      expect(className).toContain("rounded-full");
      expect(className).toContain("font-medium");
      expect(className).toContain("bg-green");
      expect(className).toContain("text-green");
      expect(style).toEqual({});
    });

    test("returns correct styling for non-structure tag without color", () => {
      const { className, style } = getTagStyle("example");
      
      expect(className).toContain("rounded-full");
      expect(className).toContain("bg-indigo");
      expect(className).toContain("text-indigo");
      expect(style).toEqual({});
    });
  });
}); 