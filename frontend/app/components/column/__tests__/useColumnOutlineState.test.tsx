import { act, renderHook } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";

import { StructureWriterContext, type StructureWriter } from "@/components/sermon/structureWriter";

import { useColumnOutlineState } from "../useColumnOutlineState";

import { generateSermonPointsForSection } from "@/services/outline.service";

import type { SermonOutline, SermonPoint } from "@/models/models";

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("@/services/outline.service", () => ({
  generateSermonPointsForSection: jest.fn(),
}));

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

describe("useColumnOutlineState", () => {
  let scheduleTask: jest.Mock;
  let writer: StructureWriter;
  let onOutlineUpdate: jest.Mock;
  let onSubPointDeleted: jest.Mock;
  let onAddOutlinePoint: jest.Mock;

  const initialSermonPoints: SermonPoint[] = [
    {
      id: "point-1",
      text: "First point",
      subPoints: [
        { id: "sub-1", text: "Sub one", position: 1000 },
        { id: "sub-2", text: "Sub two", position: 2000 },
      ],
    },
    { id: "point-2", text: "Second point" },
  ];

  const renderState = (overrides: Partial<Parameters<typeof useColumnOutlineState>[0]> = {}) =>
    renderHook(
      () =>
        useColumnOutlineState({
          id: "main",
          sermonId: "sermon-1",
          initialSermonPoints,
          onOutlineUpdate,
          onSubPointDeleted,
          onAddOutlinePoint,
          scheduleTask,
          t,
          ...overrides,
        }),
      {
        wrapper: ({ children }) => (
          <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider>
        ),
      }
    );

  /** The writer is asked at once; this lets its answer reach the hook's state. */
  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    scheduleTask = jest.fn();
    writer = {
      updateStructure: jest.fn(),
      updateThought: jest.fn(),
      deleteThought: jest.fn(),
      createManualThought: jest.fn(),
      updateSermonOutline: jest.fn(async (_id: string, outline: SermonOutline) => outline),
    };
    onOutlineUpdate = jest.fn();
    onSubPointDeleted = jest.fn();
    onAddOutlinePoint = jest.fn().mockResolvedValue(undefined);

    (generateSermonPointsForSection as jest.Mock).mockResolvedValue([
      { id: "generated-1", text: "Generated point" },
    ]);
    (toast.error as jest.Mock).mockClear();
    (toast.success as jest.Mock).mockClear();
  });

  it("sets and clears freeform point and sub-point notes without normalizing text", async () => {
    const { result } = renderState();

    act(() => {
      result.current.handleSetPointNote("point-1", "remember lowercase phrasing");
    });
    await settle();

    expect(result.current.localSermonPoints[0]).toEqual(
      expect.objectContaining({ note: "remember lowercase phrasing" })
    );
    expect(writer.updateSermonOutline).toHaveBeenLastCalledWith(
      "sermon-1",
      expect.objectContaining({
        main: expect.arrayContaining([
          expect.objectContaining({ id: "point-1", note: "remember lowercase phrasing" }),
        ]),
      }),
      // The base the write merges against — these tests are about the text
      // that reaches the plan, not about the merge, so it is left unpinned.
      expect.anything(),
      // …and the collision mode this caller asks for.
      "preferMine"
    );

    act(() => {
      result.current.handleSetSubPointNote("point-1", "sub-1", "sub note, keep as typed");
    });
    await settle();

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sub-1", note: "sub note, keep as typed" }),
      ])
    );

    act(() => {
      result.current.handleSetSubPointNote("point-1", "sub-1", undefined);
    });
    await settle();

    expect(result.current.localSermonPoints[0].subPoints?.[0]).toHaveProperty("note", undefined);
    expect(writer.updateSermonOutline).toHaveBeenLastCalledWith(
      "sermon-1",
      expect.objectContaining({
        main: expect.arrayContaining([
          expect.objectContaining({
            id: "point-1",
            subPoints: expect.arrayContaining([
              expect.objectContaining({ id: "sub-1", note: undefined }),
            ]),
          }),
        ]),
      }),
      // The base the write merges against — these tests are about the text
      // that reaches the plan, not about the merge, so it is left unpinned.
      expect.anything(),
      // …and the collision mode this caller asks for.
      "preferMine"
    );
  });

  it("capitalizes the first letter after punctuation across point and sub-point handlers", async () => {
    const { result } = renderState();

    act(() => {
      result.current.startAddingNewPoint();
      result.current.setNewPointText('"новый пункт');
    });

    expect(result.current.newPointText).toBe('"Новый пункт');

    act(() => {
      result.current.handleAddPoint();
    });
    await settle();

    expect(result.current.localSermonPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '"Новый пункт' })])
    );
    expect(writer.updateSermonOutline).toHaveBeenLastCalledWith(
      "sermon-1",
      expect.objectContaining({
        main: expect.arrayContaining([expect.objectContaining({ text: '"Новый пункт' })]),
      }),
      // The base the write merges against — these tests are about the text
      // that reaches the plan, not about the merge, so it is left unpinned.
      expect.anything(),
      // …and the collision mode this caller asks for.
      "preferMine"
    );

    act(() => {
      result.current.handleStartEdit(result.current.localSermonPoints[0]);
      result.current.setEditingText("«исправленный пункт");
    });

    expect(result.current.editingText).toBe("«Исправленный пункт");

    act(() => {
      result.current.handleSaveEdit();
    });
    await settle();

    expect(result.current.localSermonPoints[0].text).toBe("«Исправленный пункт");
    expect(result.current.editingPointId).toBeNull();

    act(() => {
      result.current.handleSaveEditDirect("point-2", "— прямое редактирование");
    });
    await settle();

    expect(result.current.localSermonPoints[1].text).toBe("— Прямое редактирование");

    act(() => {
      result.current.handleAddSubPoint("point-1", '"новый подпункт');
    });
    await settle();

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '"Новый подпункт', position: 3000 })])
    );

    act(() => {
      result.current.handleEditSubPoint("point-1", "sub-1", "123 первый подпункт");
    });
    await settle();

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sub-1", text: "123 Первый подпункт" })])
    );

    act(() => {
      result.current.handleReorderSubPoints("point-1", 0, 1);
    });
    await settle();

    expect(result.current.localSermonPoints[0].subPoints?.map((subPoint) => subPoint.position)).toEqual([
      1000,
      2000,
      3000,
    ]);

    act(() => {
      result.current.handleDeleteSubPoint("point-1", "sub-2");
    });
    await settle();

    expect(onSubPointDeleted).toHaveBeenCalledWith("point-1", "sub-2", "main");
    expect(result.current.localSermonPoints[0].subPoints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sub-2" })])
    );

    act(() => {
      result.current.handleDragEnd({
        draggableId: "point-1",
        type: "DEFAULT",
        source: { droppableId: "main", index: 0 },
        destination: { droppableId: "main", index: 1 },
        reason: "DROP",
        mode: "FLUID",
        combine: null,
      });
    });
    await settle();

    expect(result.current.localSermonPoints[1].id).toBe("point-1");
  });

  it("handles insert, generate, and save guard paths", async () => {
    const { result } = renderState();

    await act(async () => {
      await result.current.handleInsertSave(1, '"вставленный пункт');
    });

    expect(onAddOutlinePoint).toHaveBeenCalledWith("main", 1, '"Вставленный пункт');

    await act(async () => {
      await result.current.handleGenerateSermonPoints();
    });
    await settle();

    expect(generateSermonPointsForSection).toHaveBeenCalledWith("sermon-1", "main");
    expect(result.current.localSermonPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Generated point" })])
    );

    (generateSermonPointsForSection as jest.Mock).mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.handleGenerateSermonPoints();
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to generate structure points");

    // Without a connection the point is still handed to the writer at once, not refused up front
    // (owner's rule 3): the connection icon only shows, and a save that cannot be sent says so itself.
    (toast.error as jest.Mock).mockClear();
    (writer.updateSermonOutline as jest.Mock).mockClear();
    const offlineHook = renderState();

    act(() => {
      offlineHook.result.current.setNewPointText("offline point");
    });
    act(() => {
      offlineHook.result.current.handleAddPoint();
    });

    expect(writer.updateSermonOutline).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalledWith("Failed to save structure");
  });
});
