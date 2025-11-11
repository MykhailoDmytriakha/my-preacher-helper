import { isStructureTag, getDefaultTagStyling, getStructureIcon, getTagStyle, normalizeStructureTag } from "../../app/utils/tagUtils";
import { getTagStyling } from "../../app/utils/themeColors";
import { getContrastColor } from "../../app/utils/color";
import { runScenarios } from "@test-utils/scenarioRunner";

// Mock dependencies
jest.mock("../../app/utils/color", () => ({
  getContrastColor: jest.fn(),
}));

jest.mock("../../app/utils/themeColors", () => ({
  getTagStyling: jest.fn(),
}));

describe("tagUtils", () => {
  beforeEach(() => {
    // Reset mock implementations
    (getContrastColor as jest.Mock).mockImplementation((color) => 
      color === "#FFFFFF" ? "#000000" : "#FFFFFF"
    );

    // Mock the getTagStyling to return predictable test values
    (getTagStyling as jest.Mock).mockImplementation((section) => {
      if (section === 'introduction') {
        return {
          bg: "bg-blue-50 dark:bg-blue-900",
          text: "text-blue-800 dark:text-blue-200"
        };
      } else if (section === 'mainPart') {
        return {
          bg: "bg-purple-50 dark:bg-purple-900",
          text: "text-purple-800 dark:text-purple-200"
        };
      } else if (section === 'conclusion') {
        return {
          bg: "bg-green-50 dark:bg-green-900",
          text: "text-green-800 dark:text-green-200"
        };
      }
      return {
        bg: "bg-indigo-50 dark:bg-indigo-900",
        text: "text-indigo-800 dark:text-indigo-200"
      };
    });
  });

  describe("isStructureTag", () => {
    it("covers locale permutations in one shot", async () => {
      await runScenarios([
        {
          name: "intro synonyms",
          run: () => {
            ["intro", "Intro", "вступление", "Вступление", "вступ"].forEach((value) =>
              expect(isStructureTag(value)).toBe(true)
            );
          },
        },
        {
          name: "main synonyms",
          run: () => {
            ["main", "Main", "основная часть", "Основная часть", "основна частина"].forEach((value) =>
              expect(isStructureTag(value)).toBe(true)
            );
          },
        },
        {
          name: "conclusion synonyms",
          run: () => {
            ["conclusion", "Conclusion", "заключение", "Заключение", "висновок"].forEach((value) =>
              expect(isStructureTag(value)).toBe(true)
            );
          },
        },
        {
          name: "non-structure tags",
          run: () => {
            ["important", "quote", "example", "application"].forEach((value) =>
              expect(isStructureTag(value)).toBe(false)
            );
          },
        },
      ]);
    });
  });

  describe("normalizeStructureTag", () => {
    it("maps localized tags to canonical slugs once", async () => {
      await runScenarios([
        {
          name: "english variants",
          run: () => {
            expect(normalizeStructureTag("Introduction")).toBe("intro");
            expect(normalizeStructureTag("Intro")).toBe("intro");
            expect(normalizeStructureTag("Main Part")).toBe("main");
            expect(normalizeStructureTag("Main")).toBe("main");
            expect(normalizeStructureTag("Conclusion")).toBe("conclusion");
          },
        },
        {
          name: "ru/uk variants",
          run: () => {
            expect(normalizeStructureTag("Вступление")).toBe("intro");
            expect(normalizeStructureTag("Вступ")).toBe("intro");
            expect(normalizeStructureTag("Основная часть")).toBe("main");
            expect(normalizeStructureTag("Основна частина")).toBe("main");
            expect(normalizeStructureTag("Заключение")).toBe("conclusion");
            expect(normalizeStructureTag("Висновок")).toBe("conclusion");
          },
        },
        {
          name: "non-structure tags",
          run: () => {
            ["Grace", "random", ""].forEach((value) => expect(normalizeStructureTag(value)).toBeNull());
          },
        },
      ]);
    });
  });

  describe("getDefaultTagStyling", () => {
    it("matches tag families within one test", async () => {
      await runScenarios([
        {
          name: "introduction colors",
          run: () => {
            const styling = getDefaultTagStyling("вступление");
            expect(getTagStyling).toHaveBeenCalledWith("introduction");
            expect(styling.bg).toContain("blue");
          },
        },
        {
          name: "main colors",
          run: () => {
            const styling = getDefaultTagStyling("main");
            expect(getTagStyling).toHaveBeenCalledWith("mainPart");
            expect(styling.bg).toContain("purple");
          },
        },
        {
          name: "conclusion colors",
          run: () => {
            const styling = getDefaultTagStyling("заключение");
            expect(getTagStyling).toHaveBeenCalledWith("conclusion");
            expect(styling.bg).toContain("green");
          },
        },
        {
          name: "custom tag colors",
          run: () => {
            (getTagStyling as jest.Mock).mockClear();
            const styling = getDefaultTagStyling("example");
            expect(getTagStyling).not.toHaveBeenCalled();
            expect(styling.bg).toContain("indigo");
          },
        },
      ]);
    });
  });

  describe("getStructureIcon", () => {
    it("maps structure tags to icons at once", async () => {
      await runScenarios([
        {
          name: "intro icon",
          run: () => {
            const icon = getStructureIcon("вступление");
            expect(icon?.svg).toContain("<polyline points=\"4 17 10 11 4 5\"></polyline>");
          },
        },
        {
          name: "main icon",
          run: () => {
            const icon = getStructureIcon("main");
            expect(icon?.svg).toContain("<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"></rect>");
          },
        },
        {
          name: "conclusion icon",
          run: () => {
            const icon = getStructureIcon("заключение");
            expect(icon?.svg).toContain("<polyline points=\"20 17 10 11 20 5\"></polyline>");
          },
        },
        {
          name: "non-structure tags",
          run: () => expect(getStructureIcon("example")).toBeNull(),
        },
      ]);
    });
  });

  describe("getTagStyle", () => {
    it("covers structure vs custom styling in a single test", async () => {
      await runScenarios([
        {
          name: "structure tag ignores color",
          run: () => {
            const { className, style } = getTagStyle("intro", "#FF0000");
            expect(className).toContain("font-medium");
            expect(style).toEqual({});
          },
        },
        {
          name: "custom tag with color",
          run: () => {
            const { className, style } = getTagStyle("example", "#00FF00");
            expect(className).not.toContain("font-medium");
            expect(style.backgroundColor).toBe("#00FF00");
          },
        },
        {
          name: "structure tag without color",
          run: () => {
            const { className, style } = getTagStyle("conclusion");
            expect(className).toContain("bg-green");
            expect(style).toEqual({});
          },
        },
        {
          name: "custom tag without color",
          run: () => {
            const { className, style } = getTagStyle("example");
            expect(className).toContain("bg-indigo");
            expect(style).toEqual({});
          },
        },
      ]);
    });
  });

  describe("class stability and color usage", () => {
    it("validates repeated class tokens with and without inline colors", async () => {
      await runScenarios([
        {
          name: "structure tags stable classes",
          run: () => {
            const withColor = getTagStyle("Вступление", "#ff0000");
            const withoutColor = getTagStyle("Вступление");
            expect(withColor.className).toBe(withoutColor.className);
            expect(withColor.style).toEqual({});
            expect(withoutColor.style).toEqual({});
          },
        },
        {
          name: "custom tags change only styles",
          run: () => {
            const noColor = getTagStyle("Custom");
            const withColor = getTagStyle("Custom", "#112233");
            expect(withColor.className).toBe(noColor.className);
            expect(noColor.style).toEqual({});
            expect(withColor.style).toMatchObject({ backgroundColor: "#112233" });
          },
        },
      ]);
    });
  });
}); 
