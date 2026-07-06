import { fireEvent, render, screen, within } from "@testing-library/react";

import ScratchPanel from "../ScratchPanel";

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
        "scratch.capture.toBoard": "Plan editor",
        "scratch.capture.back": "Scratch notes",
        "scratch.voice.success": "Voice note added to scratch notes.",
        "scratch.voice.error": "Could not transcribe this scratch note.",
        "scratch.card.edit": "Edit note",
        "scratch.card.delete": "Delete note",
        "scratch.card.deleteSuccess": "Note deleted",
        "scratch.card.undoDelete": "Undo",
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

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const toastMock = () =>
  (jest.requireMock("sonner") as {
    toast: {
      success: jest.Mock;
      error: jest.Mock;
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
    restoreScratchNote: jest.fn((note: ScratchNote) => note),
    updateScratchNote: jest.fn(),
    deleteScratchNote: jest.fn(),
    setScratchNoteSection: jest.fn(),
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
    expect(toastMock().success).toHaveBeenCalledWith(
      "Note added to scratch notes.",
      expect.objectContaining({ position: "bottom-right" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("textbox", { name: "Write a note" })).not.toBeInTheDocument();
  });

  it("keeps scratch labels out of note cards and restores a deleted note from the toast action", () => {
    const note: ScratchNote = {
      id: "note-1",
      text: "A concrete preaching note",
      createdAt: "2026-07-05T00:00:00.000Z",
    };
    const props = renderScratchPanel({ notes: [note] });

    const card = screen.getByTestId("scratch-note-card-note-1");
    expect(within(card).queryByText("Scratch")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Delete note" }));

    expect(props.deleteScratchNote).toHaveBeenCalledWith("note-1");
    const [, options] = toastMock().success.mock.calls[0] as [
      string,
      { position: string; action: { label: string; onClick: () => void } },
    ];
    expect(toastMock().success).toHaveBeenCalledWith(
      "Note deleted",
      expect.objectContaining({
        position: "bottom-right",
        action: expect.objectContaining({ label: "Undo" }),
      })
    );

    options.action.onClick();
    expect(props.restoreScratchNote).toHaveBeenCalledWith(note);
  });
});
