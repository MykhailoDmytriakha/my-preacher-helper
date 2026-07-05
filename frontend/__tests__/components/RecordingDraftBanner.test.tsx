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

    await waitFor(() => expect(onResend).toHaveBeenCalledWith(draft.blob));
    await waitFor(() => expect(mockRemoveDraft).toHaveBeenCalledWith(draft.id));
  });

  it("does NOT remove the draft when resend returns false", async () => {
    const onResend = jest.fn().mockResolvedValue(false);
    render(<RecordingDraftBanner context="thought" onResend={onResend} />);

    fireEvent.click(screen.getByText("audio.draft.resend"));

    await waitFor(() => expect(onResend).toHaveBeenCalledWith(draft.blob));
    expect(mockRemoveDraft).not.toHaveBeenCalled();
  });

  it("calls removeDraft when Discard is clicked", () => {
    render(<RecordingDraftBanner context="thought" onResend={jest.fn()} />);

    fireEvent.click(screen.getByText("audio.draft.discard"));

    expect(mockRemoveDraft).toHaveBeenCalledWith(draft.id);
  });
});
