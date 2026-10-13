import { act, renderHook } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";

import { createEngineStructureWriter } from "@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter";
import { StructureWriterContext, type StructureWriter } from "@/components/sermon/structureWriter";

import { useColumnOutlineState } from "../useColumnOutlineState";


import type { DocumentData } from "@/data-engine/types";
import type { SermonOutline, SermonPoint } from "@/models/models";

/**
 * A POINT EDITED ON THE STRUCTURE BOARD REACHES THE ENGINE DOCUMENT AT ONCE
 * (BUG-20261010-column-outline-save-cancelled-on-leave).
 *
 * The column waited a 200 ms pause and then read the plan before handing the edit over; leaving the
 * board, or the screen going dark, in that window cancelled the timer and the edit never left the
 * screen. The engine writer keeps a change on the device the moment it is handed over and sends it
 * itself, hidden page or not — so with it there is nothing to wait for and nothing to read first.
 */
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/services/outline.service", () => ({
  generateSermonPointsForSection: jest.fn(),
}));

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
const points: SermonPoint[] = [{ id: "point-1", text: "First point" }, { id: "point-2", text: "Second point" }];

const engineWriter = () => {
  const handed: SermonOutline[] = [];
  const writer: StructureWriter = {
    updateStructure: jest.fn(),
    updateThought: jest.fn(),
    deleteThought: jest.fn(),
    createManualThought: jest.fn(),
    updateSermonOutline: jest.fn(async (_id: string, outline: SermonOutline) => { handed.push(outline); return outline; }),
  };
  return { writer, handed };
};

/**
 * The real engine writer over a sermon draft. Like the engine, it lays a hand-over on the draft at
 * once and answers only later, when told — after the change is kept on the device.
 */
const engineDocument = (outline: SermonOutline) => {
  const state = { current: { userId: "owner-1", title: "Grace", thoughts: [], outline } as unknown as DocumentData };
  const real = createEngineStructureWriter({ update: async (updater) => { state.current = updater(state.current)!; } }, "owner-1");
  const answers: (() => void)[] = [];
  const writer: StructureWriter = {
    ...real,
    updateSermonOutline: (...args) => {
      const applied = real.updateSermonOutline(...args);
      return new Promise((resolve, reject) => { answers.push(() => { applied.then(resolve, reject); }); });
    },
  };
  const answerAll = async () => { while (answers.length) { answers.shift()!(); await Promise.resolve(); await Promise.resolve(); } };
  return { state, writer, answerAll };
};
const outlineOf = (state: { current: DocumentData }) => state.current.outline as unknown as SermonOutline;

describe("the structure board column on the data engine", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("hands an edited point to the engine at once, without a pause or a read of the plan", async () => {
    const { writer, handed } = engineWriter();
    const scheduleTask = jest.fn();
    const { result } = renderHook(() => useColumnOutlineState({
      id: "main", sermonId: "sermon-1", initialSermonPoints: points, scheduleTask, t,
    }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });

    await act(async () => { result.current.handleSaveEditDirect("point-1", "Edited a moment before leaving"); });

    expect(writer.updateSermonOutline).toHaveBeenCalledTimes(1);
    expect(handed[0].main.map((point) => point.text)).toEqual(["Edited a moment before leaving", "Second point"]);
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it("keeps the edit when the board is left right after it", async () => {
    const { writer, handed } = engineWriter();
    const { result, unmount } = renderHook(() => useColumnOutlineState({
      id: "main", sermonId: "sermon-1", initialSermonPoints: points, t,
    }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });

    act(() => { result.current.handleSaveEditDirect("point-2", "Typed, then the board was closed"); });
    unmount();

    expect(handed.map((outline) => outline.main[1].text)).toContain("Typed, then the board was closed");
  });

  it("builds a second edit on the first one, though the engine has not answered the first yet", async () => {
    // Codex review: renamed and renamed back before the first answer, the engine kept the middle
    // wording — the second hand-over was merged against the plan from before the first.
    const { state, writer, answerAll } = engineDocument({ introduction: [], main: points, conclusion: [] });
    const { result } = renderHook(() => useColumnOutlineState({ id: "main", sermonId: "sermon-1", initialSermonPoints: points, t }),
      { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });

    act(() => { result.current.handleSaveEditDirect("point-1", "Changed"); });
    act(() => { result.current.handleSaveEditDirect("point-1", "First point"); });
    act(() => { result.current.handleSaveEditDirect("point-2", "Second point, kept"); });
    await act(async () => { await answerAll(); });

    expect(outlineOf(state).main.map((point) => point.text)).toEqual(["First point", "Second point, kept"]);
    expect(result.current.localSermonPoints.map((point) => point.text)).toEqual(["First point", "Second point, kept"]);
  });

  it("says so when an edit handed over fails, even after the board was left", async () => {
    const { writer } = engineDocument({ introduction: [], main: points, conclusion: [] });
    const closing: StructureWriter = { ...writer, updateSermonOutline: jest.fn(async () => { throw new Error("Storage is full"); }) };
    const { result, unmount } = renderHook(() => useColumnOutlineState({ id: "main", sermonId: "sermon-1", initialSermonPoints: points, t }),
      { wrapper: ({ children }) => <StructureWriterContext.Provider value={closing}>{children}</StructureWriterContext.Provider> });

    act(() => { result.current.handleSaveEditDirect("point-1", "Edited"); });
    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("leaves the other two sections to the merge: what this column never saw is kept", async () => {
    const { writer } = engineWriter();
    const { result } = renderHook(() => useColumnOutlineState({
      id: "main", sermonId: "sermon-1", initialSermonPoints: points, t,
    }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });

    await act(async () => { result.current.handleSaveEditDirect("point-1", "Edited"); });

    const [, mine, base] = jest.mocked(writer.updateSermonOutline).mock.calls[0];
    // Untouched sections are the same on both sides, so the three-way merge keeps the stored ones.
    expect(mine.introduction).toEqual(base!.introduction);
    expect(mine.conclusion).toEqual(base!.conclusion);
    expect(base!.main).toEqual(points);
  });
});
