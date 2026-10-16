import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import RecordingDraftBanner from "@/components/audio-recorder/RecordingDraftBanner";
import type { RecordingDraft } from "@/utils/recordingDraftStore";

// Return the i18n key as-is so assertions can target the raw keys.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockRemoveDraft = jest.fn().mockResolvedValue(undefined);
let mockDrafts: RecordingDraft[] = [];
let mockLoading = false;

jest.mock("@/hooks/useRecordingDrafts", () => ({
  useRecordingDrafts: () => ({
    drafts: mockDrafts,
    loading: mockLoading,
    saveDraft: jest.fn(),
    removeDraft: mockRemoveDraft,
    refresh: jest.fn(),
  }),
}));

const draft: RecordingDraft = {
  id: "draft-1",
  blob: new Blob(["audio"], { type: "audio/webm" }),
  mimeType: "audio/webm",
  createdAt: Date.now(),
  context: "thought",
  sizeBytes: 5,
};
const confirmRecordingDelete = async () => {
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
};

beforeAll(() => {
  // jsdom lacks these; the component creates/revokes object URLs per draft.
  (URL as unknown as { createObjectURL: jest.Mock }).createObjectURL = jest
    .fn()
    .mockReturnValue("blob:mock-url");
  (URL as unknown as { revokeObjectURL: jest.Mock }).revokeObjectURL = jest.fn();
});

beforeEach(() => {
  mockDrafts = [draft];
  mockLoading = false;
  mockRemoveDraft.mockClear();
});

describe("RecordingDraftBanner", () => {
  it("renders the amber card with title, hint and audio player", () => {
    render(<RecordingDraftBanner context="thought" onResend={jest.fn()} />);

    expect(screen.getByText("audio.draft.title")).toBeInTheDocument();
    expect(screen.getByText("audio.draft.hint")).toBeInTheDocument();
    expect(screen.getByLabelText("audio.draft.listen")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(draft.blob);
  });

  it("renders nothing while loading", () => {
    mockLoading = true;
    const { container } = render(
      <RecordingDraftBanner context="thought" onResend={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no drafts", () => {
    mockDrafts = [];
    const { container } = render(
      <RecordingDraftBanner context="thought" onResend={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onResend and removeDraft when resend succeeds", async () => {
    const onResend = jest.fn().mockResolvedValue(true);
    render(<RecordingDraftBanner context="thought" onResend={onResend} />);

    fireEvent.click(screen.getByText("audio.draft.resend"));

    await waitFor(() => expect(onResend).toHaveBeenCalledWith(draft.blob, draft));
    await waitFor(() => expect(mockRemoveDraft).toHaveBeenCalledWith(draft.id));
  });

  it("does NOT remove the draft when resend returns false", async () => {
    const onResend = jest.fn().mockResolvedValue(false);
    render(<RecordingDraftBanner context="thought" onResend={onResend} />);

    fireEvent.click(screen.getByText("audio.draft.resend"));

    await waitFor(() => expect(onResend).toHaveBeenCalledWith(draft.blob, draft));
    expect(mockRemoveDraft).not.toHaveBeenCalled();
  });

  it("calls removeDraft when Discard is confirmed", async () => {
    render(<RecordingDraftBanner context="thought" onResend={jest.fn()} />);

    fireEvent.click(screen.getByText("audio.draft.discard"));
    expect(mockRemoveDraft).not.toHaveBeenCalled();
    await confirmRecordingDelete();

    await waitFor(() => expect(mockRemoveDraft).toHaveBeenCalledWith(draft.id));
  });

  it("asks before discarding the only recording copy and keeps it when cancelled", async () => {
    render(<RecordingDraftBanner context="thought" onResend={jest.fn()} />);

    fireEvent.click(screen.getByText("audio.draft.discard"));
    expect(mockRemoveDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("common.deleteItem.title");

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(mockRemoveDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("audio.draft.title")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("audio.draft.discard")).toBeEnabled());

    fireEvent.click(screen.getByText("audio.draft.discard"));
    await confirmRecordingDelete();
    await waitFor(() => expect(mockRemoveDraft).toHaveBeenCalledTimes(1));
    expect(mockRemoveDraft).toHaveBeenCalledWith(draft.id);
  });

  it("withdraws a discard choice when the same id now names a replacement recording", async () => {
    const view = render(<RecordingDraftBanner context="thought" contextId="thought-1" onResend={jest.fn()} />);

    fireEvent.click(screen.getByText("audio.draft.discard"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mockDrafts = [{ ...draft, blob: new Blob(["replacement"], { type: "audio/webm" }) }];
    view.rerender(<RecordingDraftBanner context="thought" contextId="thought-1" onResend={jest.fn()} />);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockRemoveDraft).not.toHaveBeenCalled();
    expect(screen.getByText("audio.draft.title")).toBeInTheDocument();
  });
});


it('keeps local recovery actions available when provider retry is unavailable', () => {
  const props = { context: 'thought' as const, onResend: jest.fn(), resendDisabled: true };
  render(<RecordingDraftBanner {...props} />);
  expect(screen.getByText('audio.draft.resend')).toBeDisabled();
  expect(screen.getByText('audio.draft.download')).toBeEnabled();
  expect(screen.getByText('audio.draft.discard')).toBeEnabled();
});

it('does not offer already-applied field text for a duplicate insertion', () => {
  const props = { context: 'thought' as const, onResend: jest.fn(), excludeDraftIds: ['draft-1'] };
  render(<RecordingDraftBanner {...props} />);
  expect(screen.queryByText('audio.draft.title')).not.toBeInTheDocument();
});
