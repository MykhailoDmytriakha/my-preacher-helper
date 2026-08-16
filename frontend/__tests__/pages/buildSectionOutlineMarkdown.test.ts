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

    // An unfilled point contributes its heading and nothing else. This used to trail
    // blank lines after every empty point ("## Intro\n\n\n\n"), which showed up as gaps
    // in the assembled conspectus — visible to anyone reading it from the pulpit.
    expect(result).toBe("## Intro\n\n## Main");
  });

  it("assembles a point and its sub-points as a hierarchy", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        {
          id: "p1",
          text: "God is faithful",
          subPoints: [
            { id: "sp2", text: "In waiting", position: 2000 },
            { id: "sp1", text: "In trial", position: 1000 },
          ],
        },
      ],
      outlinePointsContentById: {
        p1: "One supporting line",
        sp1: "What to say in trial",
        sp2: "What to say in waiting",
      },
    });

    // Sub-points print in their arranged order, not the order the object listed them.
    expect(result).toBe(
      "## God is faithful\n\nOne supporting line\n\n### In trial\n\nWhat to say in trial\n\n### In waiting\n\nWhat to say in waiting"
    );
  });

  it("keeps a generated blob from getting its sub-point headings printed twice", () => {
    // Generation returns ONE text for a point that already carries its own `###`
    // headings. Printing ours on top would duplicate every sub-point on generated
    // points — so a sub-point prints only when it holds text of its own.
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        {
          id: "p1",
          text: "God is faithful",
          subPoints: [{ id: "sp1", text: "In trial", position: 1000 }],
        },
      ],
      outlinePointsContentById: {
        p1: "Opening line\n\n### In trial\n\nGenerated body",
      },
    });

    expect(result).toBe("## God is faithful\n\nOpening line\n\n### In trial\n\nGenerated body");
  });

  it("still prints the sub-point skeleton while the point is unfilled", () => {
    const result = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [
        {
          id: "p1",
          text: "God is faithful",
          subPoints: [{ id: "sp1", text: "In trial", position: 1000 }],
        },
      ],
      outlinePointsContentById: {},
    });

    // Seeing "I have not filled this in yet" while preparing is worth more than a tidy
    // document — this is what the file did before cells existed, and it stays.
    expect(result).toBe("## God is faithful\n\n### In trial");
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

/**
 * TWO WRITERS, ONE CELL MAP — AND ONLY ONE HEADING PER SUB-POINT.
 *
 * Generation stores ONE blob for a point, with its `###` headings already inside. The
 * hand-written screen stores each sub-point in a cell of its own. On a point that has both,
 * printing the heading unconditionally produced it twice in the document.
 */
describe('a sub-point heading is never printed twice', () => {
  const pointWithSubPoint = {
    id: 'p1',
    text: 'Point',
    subPoints: [{ id: 's1', text: 'Testing', position: 1000 }],
  };

  it('keeps the heading that the generated text already carries', () => {
    const markdown = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [pointWithSubPoint],
      outlinePointsContentById: {
        p1: 'Generated intro\n\n### Testing\n\nGenerated body',
        s1: 'Something added by hand',
      },
    });

    expect(markdown.match(/### Testing/g)).toHaveLength(1);
    // The hand-written text still reaches the document — only its duplicate heading is gone.
    expect(markdown).toContain('Something added by hand');
  });

  it('still prints the heading when the point holds no text of its own', () => {
    const markdown = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [pointWithSubPoint],
      outlinePointsContentById: { s1: 'Written by hand' },
    });

    expect(markdown.match(/### Testing/g)).toHaveLength(1);
    expect(markdown).toContain('Written by hand');
  });
});

describe('heading suppression matches whole headings only', () => {
  it('does not treat a longer heading as the same one', () => {
    const markdown = buildSectionOutlineMarkdown({
      orderedOutlinePoints: [{
        id: 'p1',
        text: 'Point',
        subPoints: [{ id: 's1', text: 'Hope', position: 1000 }],
      }],
      outlinePointsContentById: {
        // A different sub-point whose title merely starts with the same word.
        p1: 'Intro\n\n### Hopeful response\n\nGenerated body',
        s1: 'Written by hand',
      },
    });

    // `Hope` was never headed in the blob, so its own heading must still be printed.
    expect(markdown).toContain('### Hope\n');
    expect(markdown).toContain('Written by hand');
  });
});
