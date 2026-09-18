import {
  getAudioIconButtonClassName,
  getAudioTextButtonClassName,
  getPdfIconButtonClassName,
  getPdfTextButtonClassName,
  getTxtIconButtonClassName,
  getTxtTextButtonClassName,
  getWordIconButtonClassName,
  getWordTextButtonClassName,
} from "@/components/export-buttons/classNames";

describe("export button classNames", () => {
  /**
   * GREY MEANS ONE THING: THIS CANNOT BE PRESSED.
   *
   * Every icon used to be grey at rest and coloured only under the cursor, so a working TXT
   * button and a dead PDF button looked the same — one shade of grey apart — and the only way
   * to tell them apart was to try.
   */
  it("gives every available icon its own colour at rest, on a fresh card and a preached one", () => {
    [true, false].forEach((isPreached) => {
      expect(getTxtIconButtonClassName(isPreached)).toContain("text-blue-600");
      expect(getPdfIconButtonClassName(true, isPreached)).toContain("text-purple-600");
      expect(getWordIconButtonClassName(false, isPreached)).toContain("text-green-600");
      expect(getAudioIconButtonClassName(isPreached)).toContain("text-orange-600");
    });
  });

  it("keeps grey for the one state that really is unavailable", () => {
    [true, false].forEach((isPreached) => {
      expect(getPdfIconButtonClassName(false, isPreached)).toContain("cursor-not-allowed");
      expect(getPdfIconButtonClassName(false, isPreached)).toContain("text-gray-300");
      expect(getWordIconButtonClassName(true, isPreached)).toContain("cursor-not-allowed");
      expect(getWordIconButtonClassName(true, isPreached)).toContain("text-gray-300");
    });
  });

  it("still deepens the colour under the cursor, so pressing stays legible", () => {
    expect(getTxtIconButtonClassName(false)).toContain("hover:bg-blue-50");
    expect(getPdfIconButtonClassName(true, false)).toContain("hover:bg-purple-50");
    expect(getWordIconButtonClassName(false, false)).toContain("hover:bg-green-50");
    expect(getAudioIconButtonClassName(false)).toContain("hover:bg-orange-50");
    // A preached card is already a grey field, so the hover wash matches it.
    expect(getTxtIconButtonClassName(true)).toContain("hover:bg-gray-200");
  });

  it("covers text button variants across availability and preached state", () => {
    expect(getTxtTextButtonClassName(true)).toContain("bg-gray-300");
    expect(getTxtTextButtonClassName(false)).toContain("bg-blue-100");

    expect(getPdfTextButtonClassName(true, true)).toContain("hover:text-purple-600");
    expect(getPdfTextButtonClassName(false, true)).toContain("cursor-not-allowed");
    expect(getPdfTextButtonClassName(true, false)).toContain("bg-purple-100");
    expect(getPdfTextButtonClassName(false, false)).toContain("opacity-50");

    expect(getWordTextButtonClassName(true, true)).toContain("cursor-not-allowed");
    expect(getWordTextButtonClassName(false, true)).toContain("hover:text-green-600");
    expect(getWordTextButtonClassName(false, false)).toContain("bg-green-100");

    expect(getAudioTextButtonClassName(true)).toContain("bg-gray-300");
    expect(getAudioTextButtonClassName(false)).toContain("bg-orange-100");
  });
});
