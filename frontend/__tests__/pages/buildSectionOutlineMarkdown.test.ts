import { buildSectionOutlineMarkdown } from "@/(pages)/(private)/sermons/[id]/plan/buildSectionOutlineMarkdown";

describe("buildSectionOutlineMarkdown", () => {
  it("keeps duplicate titles independent by using point ids", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        { id: "p1", text: "Same title" },
        { id: "p2", text: "Same title" },
      ],
      outlinePointsContentById: {
        p1: "First point content",
        p2: "Second point content",
      },
    });

    expect(result).toBe(
      "## Same title\n\nFirst point content\n\n## Same title\n\nSecond point content"
    );
  });

  it("renders empty content deterministically without crashing", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        { id: "p1", text: "Intro" },
        { id: "p2", text: "Main" },
      ],
      outlinePointsContentById: {
        p1: "",
      },
    });

    expect(result).toBe("## Intro\n\n\n\n## Main\n\n");
  });

  it("preserves exact outline order regardless of object key order", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        { id: "p2", text: "Second in outline" },
        { id: "p1", text: "First in map" },
        { id: "p3", text: "Third in outline" },
      ],
      outlinePointsContentById: {
        p1: "A",
        p2: "B",
        p3: "C",
      },
    });

    expect(result).toBe(
      "## Second in outline\n\nB\n\n## First in map\n\nA\n\n## Third in outline\n\nC"
    );
  });

  it("returns empty string when section has no outline points", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [],
      outlinePointsContentById: {
        p1: "Unused",
      },
    });

    expect(result).toBe("");
  });
});
