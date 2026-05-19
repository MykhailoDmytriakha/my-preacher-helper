import { recordAudioThought } from "@/components/column/audio";
import { createAudioThought } from "@/services/thought.service";
import { toast } from "sonner";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/services/thought.service", () => ({
  createAudioThought: jest.fn(),
}));

describe("column audio helper", () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    key === "errors.audioProcessing"
      ? "Audio processing failed"
      : ((options?.defaultValue as string | undefined) ?? key);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records an outline-point thought with pointId", async () => {
    const setIsRecordingAudio = jest.fn();
    const setAudioError = jest.fn();
    const onAudioThoughtCreated = jest.fn();
    const onSuccess = jest.fn();

    (createAudioThought as jest.Mock).mockResolvedValueOnce({ id: "thought-1" });

    const result = await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "main",
      sermonId: "sermon-1",
      pointId: "point-1",
      setIsRecordingAudio,
      setAudioError,
      onAudioThoughtCreated,
      t,
      onSuccess,
      errorContext: "record failed",
    });

    expect(createAudioThought).toHaveBeenCalledWith(
      expect.any(Blob),
      "sermon-1",
      0,
      3,
      "point-1"
    );
    expect(onAudioThoughtCreated).toHaveBeenCalledWith({ id: "thought-1" }, "main");
    expect(onSuccess).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Thought added successfully");
    expect(setAudioError).toHaveBeenCalledWith(null);
    expect(setIsRecordingAudio).toHaveBeenNthCalledWith(1, true);
    expect(setIsRecordingAudio).toHaveBeenLastCalledWith(false);
    expect(result).toEqual({ id: "thought-1" });
  });

  it("records a section-level thought without pointId", async () => {
    const setIsRecordingAudio = jest.fn();
    const setAudioError = jest.fn();
    const onAudioThoughtCreated = jest.fn();

    (createAudioThought as jest.Mock).mockResolvedValueOnce({ id: "thought-2" });

    await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "conclusion",
      sermonId: "sermon-2",
      setIsRecordingAudio,
      setAudioError,
      onAudioThoughtCreated,
      t,
      successMessage: "Saved to conclusion",
      errorContext: "record failed",
    });

    expect(createAudioThought).toHaveBeenCalledWith(
      expect.any(Blob),
      "sermon-2"
    );
    expect(onAudioThoughtCreated).toHaveBeenCalledWith({ id: "thought-2" }, "conclusion");
    expect(toast.success).toHaveBeenCalledWith("Saved to conclusion");
  });

  it("returns null and reports the translated fallback on error", async () => {
    const setIsRecordingAudio = jest.fn();
    const setAudioError = jest.fn();
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    (createAudioThought as jest.Mock).mockRejectedValueOnce("boom");

    const result = await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "ambiguous",
      sermonId: "sermon-3",
      setIsRecordingAudio,
      setAudioError,
      t,
      errorContext: "audio helper failed",
    });

    expect(result).toBeNull();
    expect(setAudioError).toHaveBeenCalledWith("Audio processing failed");
    expect(toast.error).toHaveBeenCalledWith("Audio processing failed");
    expect(consoleWarnSpy).toHaveBeenCalledWith("audio helper failed", "boom");

    consoleWarnSpy.mockRestore();
  });
});
