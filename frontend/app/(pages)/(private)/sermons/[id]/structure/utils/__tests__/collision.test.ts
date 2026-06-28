import { getFirstCollision } from "@dnd-kit/core";

import {
  createStructureCollisionDetection,
  isThoughtItemId,
  overlapFractionOfTarget,
} from "../collision";

// rect(top, left, width, height) — dnd-kit reads top/left/width/height (+right/bottom).
const rect = (top: number, left: number, width: number, height: number) => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const makeArgs = (
  activeId: string,
  collisionRect: ReturnType<typeof rect>,
  rects: Record<string, ReturnType<typeof rect>>,
  pointer: { x: number; y: number } | null = null,
) =>
  ({
    active: { id: activeId },
    collisionRect,
    droppableRects: new Map(Object.entries(rects)),
    droppableContainers: Object.keys(rects).map((id) => ({ id })),
    pointerCoordinates: pointer,
  }) as any;

describe("isThoughtItemId", () => {
  it("treats raw thought ids (incl. local + numeric) as cards", () => {
    expect(isThoughtItemId("abc123")).toBe(true);
    expect(isThoughtItemId("local-temp-1")).toBe(true);
    expect(isThoughtItemId(42)).toBe(true);
  });

  it("treats every structural zone id as NOT a card", () => {
    ["introduction", "main", "conclusion", "ambiguous"].forEach((id) =>
      expect(isThoughtItemId(id)).toBe(false),
    );
    ["outline-point-p1", "outline-gap-3", "sub-point-s1", "unassigned-main", "dummy-drop-zone", "ambiguous-additional-drop"].forEach(
      (id) => expect(isThoughtItemId(id)).toBe(false),
    );
  });
});

describe("overlapFractionOfTarget", () => {
  it("is 1 for a full cover, 0.5 for half, 0 for no overlap", () => {
    const target = rect(100, 0, 200, 100); // 100..200
    expect(overlapFractionOfTarget(rect(100, 0, 200, 100), target)).toBeCloseTo(1);
    expect(overlapFractionOfTarget(rect(150, 0, 200, 100), target)).toBeCloseTo(0.5); // covers 150..200
    expect(overlapFractionOfTarget(rect(400, 0, 200, 100), target)).toBe(0);
  });
});

describe("structureCollisionDetection", () => {
  it("engages the card the dragged card covers >50%, even when the pointer is in the gap (the fix)", () => {
    const { detect } = createStructureCollisionDetection();
    const args = makeArgs(
      "B",
      rect(110, 0, 200, 100), // dragged 110..210 covers A (100..200) by 90/100 = 0.9
      {
        A: rect(100, 0, 200, 100),
        "outline-point-p1": rect(95, 0, 200, 220),
        main: rect(80, 0, 200, 400),
      },
      { x: 100, y: 205 }, // pointer below A, in the outline-point zone — NOT over A
    );
    expect(getFirstCollision(detect(args), "id")).toBe("A");
  });

  it("falls back to the zone when no card is covered past half", () => {
    const { detect } = createStructureCollisionDetection();
    const args = makeArgs(
      "B",
      rect(170, 0, 200, 100), // covers A (100..200) by only 30/100 = 0.3 (< 0.5)
      {
        A: rect(100, 0, 200, 100),
        main: rect(80, 0, 200, 400),
      },
      { x: 100, y: 250 },
    );
    expect(getFirstCollision(detect(args), "id")).toBe("main");
  });

  it("never resolves to a card below the engage threshold, even when the pointer is inside it (Codex P1)", () => {
    const { detect } = createStructureCollisionDetection();
    const args = makeArgs(
      "B",
      rect(170, 0, 200, 100), // covers A (100..200) by 30/100 = 0.30 (< 0.5)
      { A: rect(100, 0, 200, 100), conclusion: rect(80, 0, 200, 600) },
      { x: 100, y: 180 }, // pointer INSIDE card A
    );
    // Fallback must drop the card and resolve to the zone — not grab A on a tiny overlap.
    expect(getFirstCollision(detect(args), "id")).toBe("conclusion");
  });

  it("reset() clears sticky state so the same card dragged twice does not hold a stale target (Codex P2)", () => {
    const { detect, reset } = createStructureCollisionDetection();
    const cards = { A: rect(100, 0, 200, 100), conclusion: rect(80, 0, 200, 600) };

    // Drag 1: engage A.
    expect(getFirstCollision(detect(makeArgs("B", rect(145, 0, 200, 100), cards, { x: 100, y: 195 })), "id")).toBe("A");

    reset(); // new drag of the SAME card id begins

    // Coverage 0.40 (within the hold band) — WITHOUT reset this would still hold A; after
    // reset there is no sticky and 0.40 < engage, so it must fall back to the zone.
    expect(getFirstCollision(detect(makeArgs("B", rect(160, 0, 200, 100), cards, { x: 100, y: 250 })), "id")).toBe("conclusion");
  });

  it("resolves an empty outline point (no cards) via the pointer zone", () => {
    const { detect } = createStructureCollisionDetection();
    const args = makeArgs(
      "X",
      rect(110, 0, 200, 60),
      { "outline-point-empty": rect(100, 0, 200, 80), conclusion: rect(90, 0, 200, 300) },
      { x: 100, y: 130 },
    );
    expect(getFirstCollision(detect(args), "id")).toBe("outline-point-empty");
  });

  // The core anti-jitter proof: drive the dragged card back and forth across the A/C
  // boundary. The raw "most-covered card" flips every frame ("swap glitching"); the
  // hysteresis band must hold one target steady, and only switch once clearly moved.
  it("holds the target across boundary jitter, switching only on a clear move (no swap-glitch)", () => {
    const { detect } = createStructureCollisionDetection();
    const cards = { A: rect(100, 0, 200, 100), C: rect(200, 0, 200, 100) }; // A 100..200, C 200..300

    // tops chosen so coverage hovers around 50/50, then a decisive move onto C.
    const tops = [145, 155, 148, 152, 150, 170];
    const rawBest: string[] = [];
    const chosen: string[] = [];
    for (const top of tops) {
      const args = makeArgs("B", rect(top, 0, 200, 100), cards, { x: 100, y: top + 50 });
      // raw = the card covered most this frame (what a stateless pick would choose)
      const fA = overlapFractionOfTarget(rect(top, 0, 200, 100), cards.A);
      const fC = overlapFractionOfTarget(rect(top, 0, 200, 100), cards.C);
      rawBest.push(fA >= fC ? "A" : "C");
      chosen.push(String(getFirstCollision(detect(args), "id")));
    }

    const flips = (seq: string[]) => seq.reduce((n, v, i) => (i > 0 && v !== seq[i - 1] ? n + 1 : n), 0);

    // Baseline (stateless) oscillates; the detector holds A through the jitter, then
    // switches once to C on the decisive move.
    expect(flips(rawBest)).toBeGreaterThanOrEqual(4);
    expect(chosen.slice(0, 5)).toEqual(["A", "A", "A", "A", "A"]);
    expect(chosen[5]).toBe("C");
    expect(flips(chosen)).toBe(1);
  });

  // Holds across the band [0.35, 0.5], then releases below it so the drop can move on to a
  // zone/gap/other section. (The 2-card "collapse onto self" revert is handled in
  // handleDragEnd, not here — see useStructureDnd.test.ts.)
  it("holds across the band, releases below 0.35", () => {
    const { detect } = createStructureCollisionDetection();
    const cards = { A: rect(100, 0, 200, 100), conclusion: rect(80, 0, 200, 600) };

    // Engage A at 0.55.
    expect(getFirstCollision(detect(makeArgs("B", rect(145, 0, 200, 100), cards, { x: 100, y: 195 })), "id")).toBe("A");
    // Coverage 0.40 (within band) → still A.
    expect(getFirstCollision(detect(makeArgs("B", rect(160, 0, 200, 100), cards, { x: 100, y: 210 })), "id")).toBe("A");
    // Coverage 0.20 (below band) → release to the zone.
    expect(getFirstCollision(detect(makeArgs("B", rect(180, 0, 200, 100), cards, { x: 100, y: 250 })), "id")).toBe("conclusion");
  });
});
