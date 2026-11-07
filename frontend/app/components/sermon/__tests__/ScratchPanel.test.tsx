import { act, fireEvent, render, screen, within } from "@testing-library/react";

import ScratchPanel from "../ScratchPanel";
const mockRecordingRows = new Map<string, unknown>();
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (id: string) => mockRecordingRows.get(id)),
  entries: jest.fn(async () => Array.from(mockRecordingRows.entries())),
  update: jest.fn(async (id: string, change: (old: unknown) => unknown) => { mockRecordingRows.set(id, change(mockRecordingRows.get(id))); }),
}));
beforeEach(() => {
  mockRecordingRows.clear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});


import type { ScratchNote } from "@/models/models";
import type { ComponentProps } from "react";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "common.close": "Close",
        "scratch.title": "Scratch Notes",
        "scratch.subtitle": "Capture unfinished thoughts before they become sermon structure.",
        "scratch.badge": "Scratch",
        "scratch.capture.manualAdd": "Write a note",
        "scratch.capture.manualLabel": "Write a note",
        "scratch.capture.add": "Add",
        "scratch.capture.manualSuccess": "Note added to scratch notes.",
        "scratch.capture.manualError": "Could not add the note.",
        "scratch.capture.empty": "No scratch notes yet.",
        "scratch.capture.toBoard": "Work on the plan",
        "scratch.capture.back": "Scratch notes",
        "scratch.voice.success": "Voice note added to scratch notes.",
        "scratch.voice.error": "Could not transcribe this scratch note.",
        "scratch.card.edit": "Edit note",
        "scratch.card.delete": "Delete note",
        "scratch.card.deleteSuccess": "Note deleted",
        "scratch.card.undoDelete": "Undo",
        "scratch.card.deleteConfirmTitle": "Delete note?",
        "scratch.card.deleteConfirm": `This scratch note will be deleted: ${params?.text ?? ""}`,
        "common.delete": "Delete",
        "common.cancel": "Cancel",
        "scratch.card.save": "Save",
        "scratch.card.cancel": "Cancel",
        "scratch.card.placedIn": `In ${params?.section ?? ""}`,
        "scratch.sections.main": "Main part",
        "scratch.board.unplace": "to pool",
      };
      return translations[key] ?? key;
    },
  }),
}));

jest.mock("@/providers/ConnectionProvider", () => ({
  useConnection: () => ({ isMagicAvailable: true }),
}));

jest.mock("@/services/scratch.service", () => ({
  composePlanFromScratch: jest.fn(),
}));

jest.mock("@/services/thought.service", () => ({
  transcribeThoughtAudio: jest.fn(),
}));

jest.mock("@/components/sermon/AudioRecorderPortalBridge", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    __esModule: true,
    default: ({ manualControl }: { manualControl: React.ReactNode }) =>
      React.createElement(
        "div",
        null,
        React.createElement("button", { type: "button" }, "New recording"),
        manualControl
      ),
  };
});

jest.mock("@/components/ui/ConfirmModal", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    __esModule: true,
    default: ({
      isOpen,
      onClose,
      onConfirm,
      title,
      description,
      confirmText,
      cancelText,
    }: {
      isOpen: boolean;
      onClose: () => void;
      onConfirm: () => void;
      title: string;
      description?: string;
      confirmText?: string;
      cancelText?: string;
    }) =>
      isOpen
        ? React.createElement(
            "div",
            { role: "dialog", "aria-label": title },
            React.createElement("p", null, description),
            React.createElement(
              "button",
              { type: "button", onClick: onConfirm },
              confirmText ?? "Confirm"
            ),
            React.createElement(
              "button",
              { type: "button", onClick: onClose },
              cancelText ?? "Cancel"
            )
          )
        : null,
  };
});

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(() => "scratch-undo"),
    error: jest.fn(),
    loading: jest.fn(),
    dismiss: jest.fn(),
  },
}));

const toastMock = () =>
  (jest.requireMock("sonner") as {
    toast: {
      success: jest.Mock;
      error: jest.Mock;
      loading: jest.Mock;
      dismiss: jest.Mock;
    };
  }).toast;

function renderScratchPanel(overrides: Partial<ComponentProps<typeof ScratchPanel>> = {}) {
  const props: ComponentProps<typeof ScratchPanel> = {
    sermonId: "sermon-1",
    notes: [],
    addScratchNote: jest.fn(() => ({
      id: "created-note",
      text: "Manual note",
      createdAt: "2026-07-05T00:00:00.000Z",
    })),
    addRecordedScratchNote: async (text: string, _recordingId: string) => props.addScratchNote(text),
    restoreScratchNote: jest.fn(async (note: ScratchNote) => note),
    updateScratchNote: jest.fn(),
    deleteScratchNote: jest.fn(),
    isScratchWritePending: false,
    scratchRevision: 0,
    onApplyOutline: jest.fn(),
    onOutlineChange: jest.fn(),
    ...overrides,
  };

  render(<ScratchPanel {...props} />);
  return props;
}

describe("ScratchPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a labeled manual note button and a clear add form", () => {
    const props = renderScratchPanel();

    fireEvent.click(screen.getByRole("button", { name: "Write a note" }));

    const input = screen.getByRole("textbox", { name: "Write a note" });
    expect(input).toHaveAttribute("placeholder", "Write a note");
    expect(screen.getByRole("button", { name: "Add" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();

    fireEvent.change(input, { target: { value: "  Manual note  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(props.addScratchNote).toHaveBeenCalledWith("Manual note");
    // NO success message: the note lands in an in-process queue that does not
    // survive a reload, so "added" would be a claim about durability nobody made.
    // The note appearing in the list is the acceptance signal.
    expect(toastMock().success).not.toHaveBeenCalledWith(
      "Note added to scratch notes.",
      expect.anything()
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("textbox", { name: "Write a note" })).not.toBeInTheDocument();
  });

  it("keeps scratch labels out of note cards and restores a deleted note from the toast action", async () => {
    const note: ScratchNote = {
      id: "note-1",
      text: "A concrete preaching note",
      createdAt: "2026-07-05T00:00:00.000Z",
    };
    const props = renderScratchPanel({ notes: [note] });

    const card = screen.getByTestId("scratch-note-card-note-1");
    expect(within(card).queryByText("Scratch")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Delete note" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    expect(props.deleteScratchNote).toHaveBeenCalledWith("note-1");
    const [, options] = toastMock().success.mock.calls[0] as [
      string,
      { position: string; action: { label: string; onClick: (event: MouseEvent) => Promise<void> } },
    ];
    expect(toastMock().success).toHaveBeenCalledWith(
      "Note deleted",
      expect.objectContaining({
        position: "bottom-right",
        action: expect.objectContaining({ label: "Undo" }),
      })
    );

    await act(async () => { await options.action.onClick(new MouseEvent("click", { cancelable: true })); });
    expect(props.restoreScratchNote).toHaveBeenCalledWith(note);
  });

  it("starts restoration only once while the offered Undo is still being captured", async () => {
    const note: ScratchNote = { id: "note-1", text: "Keep these words", createdAt: "2026-07-05" };
    let settle!: (value: ScratchNote | null) => void;
    const capture = new Promise<ScratchNote | null>(resolve => { settle = resolve; });
    const restore = jest.fn(() => capture);
    renderScratchPanel({ notes: [note], restoreScratchNote: restore });
    fireEvent.click(within(screen.getByTestId("scratch-note-card-note-1")).getByRole("button", { name: "Delete note" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    const options = toastMock().success.mock.calls[0][1] as { action: { onClick: (event: MouseEvent) => Promise<void> } };
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => {
      first = options.action.onClick(new MouseEvent("click", { cancelable: true }));
      second = options.action.onClick(new MouseEvent("click", { cancelable: true }));
    });
    const calls = restore.mock.calls.length;
    await act(async () => { settle(note); await Promise.all([first, second]); });
    expect(calls).toBe(1);
  });

  it("keeps the Undo visible as saving and guards reload until the local capture finishes", async () => {
    const note: ScratchNote = { id: "note-1", text: "Keep these words", createdAt: "2026-07-05" };
    let settle!: (value: ScratchNote) => void;
    const capture = new Promise<ScratchNote>(resolve => { settle = resolve; });
    renderScratchPanel({ notes: [note], restoreScratchNote: () => capture });
    fireEvent.click(within(screen.getByTestId("scratch-note-card-note-1")).getByRole("button", { name: "Delete note" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    const [, options] = toastMock().success.mock.calls[0] as [
      string,
      { action: { onClick: (event: MouseEvent) => Promise<void> } },
    ];
    const click = new MouseEvent("click", { cancelable: true });
    const reloadWhileSaving = new Event("beforeunload", { cancelable: true });
    let undo!: Promise<void>;
    act(() => { undo = options.action.onClick(click); });
    try {
      window.dispatchEvent(reloadWhileSaving);
      expect(click.defaultPrevented).toBe(true);
      expect(reloadWhileSaving.defaultPrevented).toBe(true);
      expect(toastMock().loading).toHaveBeenCalledWith(
        "dataSync.phase.savingLocally",
        { id: "scratch-undo", position: "bottom-right", action: undefined, dismissible: false }
      );
      expect(toastMock().dismiss).not.toHaveBeenCalled();
    } finally {
      await act(async () => { settle(note); await undo; });
    }
    const reloadAfterSaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reloadAfterSaving);
    expect(reloadAfterSaving.defaultPrevented).toBe(false);
    expect(toastMock().dismiss).toHaveBeenCalledWith("scratch-undo");
  });

  it("reports a failed Undo and keeps it available to retry", async () => {
    const note: ScratchNote = { id: "note-1", text: "Keep these words", createdAt: "2026-07-05" };
    const failure = new Error("Local capture failed");
    const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const props = renderScratchPanel({ notes: [note], restoreScratchNote: jest.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(note) });
      fireEvent.click(within(screen.getByTestId("scratch-note-card-note-1")).getByRole("button", { name: "Delete note" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      const options = toastMock().success.mock.calls[0][1] as { action: { onClick: (event: MouseEvent) => Promise<void> } };
      await act(async () => { await options.action.onClick(new MouseEvent("click", { cancelable: true })); });
      expect(props.restoreScratchNote).toHaveBeenCalledWith(note);
      expect(toastMock().error).toHaveBeenCalledWith("common.saveError", {
        id: "scratch-undo", position: "bottom-right", dismissible: true, action: options.action,
      });
      expect(toastMock().dismiss).not.toHaveBeenCalled();
      const reloadAfterFailure = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(reloadAfterFailure);
      expect(reloadAfterFailure.defaultPrevented).toBe(false);
      await act(async () => { await options.action.onClick(new MouseEvent("click", { cancelable: true })); });
      expect(props.restoreScratchNote).toHaveBeenCalledTimes(2);
      expect(toastMock().dismiss).toHaveBeenCalledWith("scratch-undo");
      expect(report).toHaveBeenCalledWith("Failed to restore a scratch note", failure);
    } finally { report.mockRestore(); }
  });

  it("asks for confirmation before deleting a note and keeps it when the preacher backs out", () => {
    const note: ScratchNote = {
      id: "note-1",
      text: "An idea that would be painful to retype",
      createdAt: "2026-07-05T00:00:00.000Z",
    };
    const props = renderScratchPanel({ notes: [note] });

    fireEvent.click(
      within(screen.getByTestId("scratch-note-card-note-1")).getByRole("button", {
        name: "Delete note",
      })
    );

    // Armed, not fired: nothing is gone yet and the note text is quoted back.
    expect(props.deleteScratchNote).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "This scratch note will be deleted: An idea that would be painful to retype"
      )
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.deleteScratchNote).not.toHaveBeenCalled();
    expect(toastMock().success).not.toHaveBeenCalled();
    expect(screen.getByTestId("scratch-note-card-note-1")).toBeInTheDocument();
  });

  it("routes an emptied note through the same confirmation instead of deleting silently", () => {
    const note: ScratchNote = {
      id: "note-1",
      text: "A note about to be cleared",
      createdAt: "2026-07-05T00:00:00.000Z",
    };
    const props = renderScratchPanel({ notes: [note] });

    fireEvent.click(screen.getByText("A note about to be cleared"));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.blur(textarea);

    expect(props.deleteScratchNote).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(props.deleteScratchNote).toHaveBeenCalledWith("note-1");
  });
});
