import { buildPlanOutlineLookup, getPointFromLookup, getPointSectionFromLookup } from "@/(pages)/(private)/sermons/[id]/plan/planOutlineLookup";
import type { Sermon } from "@/models/models";

function createSermonWithOutline(outline: Sermon["outline"]): Sermon {
  return {
    id: "sermon-1",
    title: "Sermon Title",
    verse: "John 3:16",
    date: "2026-02-27",
    thoughts: [],
    userId: "user-1",
    outline,
  };
}

describe("planOutlineLookup", () => {
  it("builds point lookup and section order maps from outline", () => {
    const sermon = createSermonWithOutline({
      introduction: [
        { id: "intro-1", text: "Intro 1" },
      ],
      main: [
        { id: "main-1", text: "Main 1" },
        { id: "main-2", text: "Main 2" },
      ],
      conclusion: [
        { id: "conc-1", text: "Conclusion 1" },
      ],
    });

    const lookup = buildPlanOutlineLookup(sermon);

    expect(lookup.pointIdsBySection.introduction).toEqual(["intro-1"]);
    expect(lookup.pointIdsBySection.main).toEqual(["main-1", "main-2"]);
    expect(lookup.pointIdsBySection.conclusion).toEqual(["conc-1"]);

    expect(getPointSectionFromLookup(lookup, "main-2")).toBe("main");
    expect(getPointFromLookup(lookup, "main-2")).toEqual({ id: "main-2", text: "Main 2" });
  });

  it("returns safe fallbacks for unknown point and missing outline", () => {
    const withoutOutline: Sermon = {
      id: "sermon-2",
      title: "No Outline",
      verse: "",
      date: "2026-02-27",
      thoughts: [],
      userId: "user-1",
    };

    const lookup = buildPlanOutlineLookup(withoutOutline);

    expect(lookup.pointIdsBySection.introduction).toEqual([]);
    expect(lookup.pointIdsBySection.main).toEqual([]);
    expect(lookup.pointIdsBySection.conclusion).toEqual([]);
    expect(getPointSectionFromLookup(lookup, "missing")).toBeNull();
    expect(getPointFromLookup(lookup, "missing")).toBeUndefined();
  });

  it("preserves first-match behavior when duplicate ids exist across sections", () => {
    const sermon = createSermonWithOutline({
      introduction: [{ id: "dup-id", text: "Intro Dup" }],
      main: [{ id: "dup-id", text: "Main Dup" }],
      conclusion: [],
    });

    const lookup = buildPlanOutlineLookup(sermon);

    expect(getPointSectionFromLookup(lookup, "dup-id")).toBe("introduction");
    expect(getPointFromLookup(lookup, "dup-id")).toEqual({ id: "dup-id", text: "Intro Dup" });
  });
});
