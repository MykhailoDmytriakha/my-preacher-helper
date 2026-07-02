import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";

import { useColumnOutlineState } from "../useColumnOutlineState";

import {
  generateSermonPointsForSection,
  getSermonOutline,
  updateSermonOutline,
} from "@/services/outline.service";

import type { SermonPoint } from "@/models/models";

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("@/services/outline.service", () => ({
  generateSermonPointsForSection: jest.fn(),
  getSermonOutline: jest.fn(),
  updateSermonOutline: jest.fn(),
}));

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

describe("useColumnOutlineState", () => {
  let scheduledTasks: Map<number, () => void | Promise<void>>;
  let nextTaskId: number;
  let scheduleTask: jest.Mock;
  let clearScheduledTask: jest.Mock;
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
    renderHook(() =>
      useColumnOutlineState({
        id: "main",
        sermonId: "sermon-1",
        initialSermonPoints,
        isOnline: true,
        onOutlineUpdate,
        onSubPointDeleted,
        onAddOutlinePoint,
        scheduleTask,
        clearScheduledTask,
        t,
        ...overrides,
      })
    );

  const flushScheduledTasks = async () => {
    const pendingTasks = [...scheduledTasks.values()];
    scheduledTasks.clear();

    for (const task of pendingTasks) {
      await task();
    }
  };

  beforeEach(() => {
    scheduledTasks = new Map();
    nextTaskId = 0;
    scheduleTask = jest.fn((callback: () => void | Promise<void>) => {
      nextTaskId += 1;
      scheduledTasks.set(nextTaskId, callback);
      return nextTaskId;
    });
    clearScheduledTask = jest.fn((taskId: number) => {
      scheduledTasks.delete(taskId);
    });
    onOutlineUpdate = jest.fn();
    onSubPointDeleted = jest.fn();
    onAddOutlinePoint = jest.fn().mockResolvedValue(undefined);

    (getSermonOutline as jest.Mock).mockResolvedValue({
      introduction: [{ id: "intro-1", text: "Intro point" }],
      main: [{ id: "old-main", text: "Old main" }],
      conclusion: [{ id: "conclusion-1", text: "Conclusion point" }],
    });
    (updateSermonOutline as jest.Mock).mockResolvedValue({ success: true });
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
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0]).toEqual(
      expect.objectContaining({ note: "remember lowercase phrasing" })
    );
    expect(updateSermonOutline).toHaveBeenLastCalledWith(
      "sermon-1",
      expect.objectContaining({
        main: expect.arrayContaining([
          expect.objectContaining({ id: "point-1", note: "remember lowercase phrasing" }),
        ]),
      })
    );

    act(() => {
      result.current.handleSetSubPointNote("point-1", "sub-1", "sub note, keep as typed");
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sub-1", note: "sub note, keep as typed" }),
      ])
    );

    act(() => {
      result.current.handleSetSubPointNote("point-1", "sub-1", undefined);
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].subPoints?.[0]).toHaveProperty("note", undefined);
    expect(updateSermonOutline).toHaveBeenLastCalledWith(
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
      })
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
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '"Новый пункт' })])
    );
    expect(updateSermonOutline).toHaveBeenLastCalledWith(
      "sermon-1",
      expect.objectContaining({
        main: expect.arrayContaining([expect.objectContaining({ text: '"Новый пункт' })]),
      })
    );

    act(() => {
      result.current.handleStartEdit(result.current.localSermonPoints[0]);
      result.current.setEditingText("«исправленный пункт");
    });

    expect(result.current.editingText).toBe("«Исправленный пункт");

    act(() => {
      result.current.handleSaveEdit();
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].text).toBe("«Исправленный пункт");
    expect(result.current.editingPointId).toBeNull();

    act(() => {
      result.current.handleSaveEditDirect("point-2", "— прямое редактирование");
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[1].text).toBe("— Прямое редактирование");

    act(() => {
      result.current.handleAddSubPoint("point-1", '"новый подпункт');
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '"Новый подпункт', position: 3000 })])
    );

    act(() => {
      result.current.handleEditSubPoint("point-1", "sub-1", "123 первый подпункт");
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].subPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sub-1", text: "123 Первый подпункт" })])
    );

    act(() => {
      result.current.handleReorderSubPoints("point-1", 0, 1);
    });
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(result.current.localSermonPoints[0].subPoints?.map((subPoint) => subPoint.position)).toEqual([
      1000,
      2000,
      3000,
    ]);

    act(() => {
      result.current.handleDeleteSubPoint("point-1", "sub-2");
    });
    await act(async () => {
      await flushScheduledTasks();
    });

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
    await act(async () => {
      await flushScheduledTasks();
    });

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
    await act(async () => {
      await flushScheduledTasks();
    });

    expect(generateSermonPointsForSection).toHaveBeenCalledWith("sermon-1", "main");
    expect(result.current.localSermonPoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Generated point" })])
    );

    (generateSermonPointsForSection as jest.Mock).mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.handleGenerateSermonPoints();
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to generate outline points");

    const offlineHook = renderState({ isOnline: false });

    act(() => {
      offlineHook.result.current.setNewPointText("offline point");
    });
    act(() => {
      offlineHook.result.current.handleAddPoint();
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to save outline");
  });
});
