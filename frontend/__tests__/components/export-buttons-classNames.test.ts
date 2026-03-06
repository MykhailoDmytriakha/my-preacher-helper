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
  it("covers icon button variants across availability and preached state", () => {
    expect(getTxtIconButtonClassName(true)).toContain("text-gray-500");
    expect(getTxtIconButtonClassName(false)).toContain("hover:bg-blue-50");

    expect(getPdfIconButtonClassName(false, false)).toContain("cursor-not-allowed");
    expect(getPdfIconButtonClassName(true, true)).toContain("hover:text-purple-600");
    expect(getPdfIconButtonClassName(true, false)).toContain("hover:bg-purple-50");

    expect(getWordIconButtonClassName(true, false)).toContain("cursor-not-allowed");
    expect(getWordIconButtonClassName(false, true)).toContain("hover:text-green-600");
    expect(getWordIconButtonClassName(false, false)).toContain("hover:bg-green-50");

    expect(getAudioIconButtonClassName(true)).toContain("hover:text-orange-600");
    expect(getAudioIconButtonClassName(false)).toContain("hover:bg-orange-50");
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
