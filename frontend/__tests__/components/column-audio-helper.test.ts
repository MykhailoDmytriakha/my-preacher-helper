import { recordAudioThought as rawRecordAudioThought } from "@/components/column/audio";
import { createAudioThought } from "@/services/thought.service";
import { withStatus } from "@/utils/aiTimeFailure";
import { UsageCapReachedError } from "@/services/usageLimits";
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

const mockParkRecording = jest.fn(async (_input: unknown) => 'source-1');
const mockReleaseRecording = jest.fn(async (_id: string, _ownerId: string) => undefined);
jest.mock('@/utils/recordingDraftStore', () => ({
  saveRecordingDraft: (...args: unknown[]) => mockParkRecording(...args as [unknown]),
  deleteRecordingDraft: (...args: unknown[]) => mockReleaseRecording(...args as [string, string]),
}));
const recordAudioThought = (args: Omit<Parameters<typeof rawRecordAudioThought>[0], 'ownerId'>) => rawRecordAudioThought(Object.assign({ ownerId: 'owner' }, args));

describe("column audio helper", () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    key === "errors.audioProcessing"
      ? "Audio processing failed"
      : ((options?.defaultValue as string | undefined) ?? key);

  beforeEach(() => {
    jest.clearAllMocks();
    mockParkRecording.mockReset().mockResolvedValue('source-1');
    mockReleaseRecording.mockClear();
    jest.mocked(createAudioThought).mockReset();
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
      "point-1", undefined, expect.objectContaining({ id: expect.any(String), sectionId: 'main' })
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
      "sermon-2", 0, 3, undefined, undefined, expect.objectContaining({ id: expect.any(String), sectionId: 'conclusion' })
    );
    expect(onAudioThoughtCreated).toHaveBeenCalledWith({ id: "thought-2" }, "conclusion");
    expect(toast.success).toHaveBeenCalledWith("Saved to conclusion");
  });

  it("says no answer came in time for a recording instead of printing HTTP 504", async () => {
    const setIsRecordingAudio = jest.fn();
    const setAudioError = jest.fn();
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    (createAudioThought as jest.Mock).mockRejectedValueOnce(withStatus(new Error("Transcription failed (attempt 1/4): HTTP 504"), 504));

    await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "ambiguous",
      sermonId: "sermon-3",
      setIsRecordingAudio,
      setAudioError,
      t,
      errorContext: "audio helper failed",
    });

    expect(setAudioError).toHaveBeenCalledWith({ key: "errors.aiOutOfTimeAudio" });
    expect(toast.error).toHaveBeenCalledWith("errors.aiOutOfTimeAudio");
    consoleWarnSpy.mockRestore();
  });

  it("returns null and reports the translated fallback on error", async () => {
    const setIsRecordingAudio = jest.fn();
    const setAudioError = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

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
    expect(setAudioError).toHaveBeenCalledWith({ key: "errors.audioProcessing" });
    expect(toast.error).toHaveBeenCalledWith("Audio processing failed");
    expect(consoleErrorSpy).toHaveBeenCalledWith("audio helper failed", "boom");

    consoleErrorSpy.mockRestore();
  });

  /**
   * THE DEVELOPER'S SENTENCE MUST NEVER REACH THE PREACHER.
   *
   * `error.message` of a usage-cap error reads "Usage cap reached for ai", and this helper put
   * it straight onto the recovery card AND into a red toast — on top of the warm message the
   * global handler had already raised for the same refusal. One event, three announcements,
   * two of them in English, and the one written for a person was the one underneath.
   */
  it("tells a refusal apart from a failure, and lets the refusal speak for itself", async () => {
    const setAudioError = jest.fn();
    const setLimitReached = jest.fn();

    (createAudioThought as jest.Mock).mockRejectedValueOnce(
      new UsageCapReachedError("transcription", 110, 100, 110, "2026-10-01T00:00:00.000Z")
    );

    const result = await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "main",
      sermonId: "sermon-1",
      setIsRecordingAudio: jest.fn(),
      setAudioError,
      setLimitReached,
      t,
      errorContext: "ctx",
    });

    expect(result).toBeNull();
    expect(setLimitReached).toHaveBeenLastCalledWith(true);
    expect(setAudioError).toHaveBeenLastCalledWith({ key: "audio.limitReached" });
    // The dialog is the announcement; a red toast here is the second one.
    expect(toast.error).not.toHaveBeenCalled();
    expect(JSON.stringify(setAudioError.mock.calls)).not.toContain("Usage cap reached");
  });

  it("clears a previous refusal when a new recording starts", async () => {
    const setLimitReached = jest.fn();
    (createAudioThought as jest.Mock).mockResolvedValueOnce({ id: "thought-2" });

    await recordAudioThought({
      audioBlob: new Blob(["audio"]),
      sectionId: "main",
      sermonId: "sermon-1",
      setIsRecordingAudio: jest.fn(),
      setAudioError: jest.fn(),
      setLimitReached,
      t,
      errorContext: "ctx",
    });

    expect(setLimitReached).toHaveBeenCalledWith(false);
    expect(setLimitReached).not.toHaveBeenCalledWith(true);
  });
  it('parks the exact point destination before starting provider work', async () => {
    let accept!: () => void;
    mockParkRecording.mockImplementationOnce(() => new Promise<string>(resolve => { accept = () => resolve('source-1'); }));
    jest.mocked(createAudioThought).mockImplementationOnce(() => new Promise(() => undefined));
    const pending = recordAudioThought({ audioBlob: new Blob(['voice']), sermonId: 'sermon-1', sectionId: 'main', pointId: 'point-1', subPointId: 'sub-1',
      setIsRecordingAudio: jest.fn(), setAudioError: jest.fn(), t, errorContext: 'Recovery' });
    await Promise.resolve();
    expect(mockParkRecording).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner', context: 'outline',
      contextId: JSON.stringify(['sermon-1', 'main']), destination: { sectionId: 'main', pointId: 'point-1', subPointId: 'sub-1' } }));
    expect(createAudioThought).not.toHaveBeenCalled();
    accept(); await Promise.resolve();
    void pending;
  });

  it('keeps the provider stopped and the source recoverable when local parking fails', async () => {
    mockParkRecording.mockRejectedValueOnce(new Error('Storage full'));
    const error = jest.fn();
    await recordAudioThought({ audioBlob: new Blob(['voice']), sermonId: 'sermon-1', sectionId: 'main',
      setIsRecordingAudio: jest.fn(), setAudioError: error, t, errorContext: 'Recovery' });
    expect(error).toHaveBeenCalledWith({ key: 'audio.draft.saveFailed' });
    expect(createAudioThought).not.toHaveBeenCalled();
    expect(mockReleaseRecording).not.toHaveBeenCalled();
  });

});
