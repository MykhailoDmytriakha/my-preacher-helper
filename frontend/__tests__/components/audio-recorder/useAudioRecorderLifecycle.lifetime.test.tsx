import { act, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useAudioRecorderLifecycle } from "@/components/audio-recorder/useAudioRecorderLifecycle";
import * as audioFormatUtils from "@/utils/audioFormatUtils";
import * as audioRecorderConfig from "@/utils/audioRecorderConfig";

jest.mock("@/utils/audioFormatUtils", () => ({
  createConfiguredMediaRecorder: jest.fn(),
  getAllSupportedFormats: jest.fn(() => ["audio/webm"]),
  getBestSupportedFormat: jest.fn(() => "audio/webm"),
  hasKnownIssues: jest.fn(() => false),
  logAudioInfo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/utils/audioRecorderConfig", () => ({
  getAudioGracePeriod: jest.fn(() => 0),
  getAudioRecordingDuration: jest.fn(() => 90),
}));

const mockedAudioFormatUtils = jest.mocked(audioFormatUtils);
const mockedAudioRecorderConfig = jest.mocked(audioRecorderConfig);

type RecorderMock = {
  mimeType: string;
  start: jest.Mock;
  stop: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
};

type Args = Parameters<typeof useAudioRecorderLifecycle>[0];

const makeArgs = (overrides: Partial<Args> = {}): Args => ({
  onRecordingComplete: jest.fn(),
  isProcessing: false,
  maxDuration: 90,
  onError: jest.fn(),
  disabled: false,
  onRetry: undefined,
  transcriptionError: null,
  onClearError: jest.fn(),
  autoStart: false,
  hideKeyboardShortcuts: true,
  onRecordingStateChange: jest.fn(),
  enableAudioLevelMonitoring: false,
  t: key => key,
  ...overrides,
});

let getUserMedia: jest.Mock;
let trackStop: jest.Mock;
let recorder: RecorderMock;
let dataHandler: ((event: BlobEvent) => void) | null;
let stopHandler: (() => Promise<void>) | null;

const makeStream = () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream;

beforeEach(() => {
  dataHandler = null;
  stopHandler = null;
  trackStop = jest.fn();
  recorder = {
    mimeType: "audio/webm",
    start: jest.fn(),
    stop: jest.fn(() => { void stopHandler?.(); }),
    pause: jest.fn(),
    resume: jest.fn(),
  };
  mockedAudioRecorderConfig.getAudioGracePeriod.mockReturnValue(0);
  mockedAudioFormatUtils.createConfiguredMediaRecorder.mockImplementation(
    (_stream, mimeType, onData, onStop) => {
      recorder.mimeType = mimeType;
      dataHandler = onData;
      stopHandler = onStop;
      return recorder as unknown as MediaRecorder;
    }
  );
  mockedAudioFormatUtils.logAudioInfo.mockResolvedValue(undefined);

  getUserMedia = jest.fn().mockResolvedValue(makeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  (global as typeof globalThis & { AudioContext?: unknown }).AudioContext = jest.fn(() => ({
    createMediaStreamSource: () => ({ connect: jest.fn() }),
    createAnalyser: () => ({
      fftSize: 0,
      frequencyBinCount: 1,
      getByteFrequencyData: (values: Uint8Array) => { values[0] = 0; },
    }),
    close: jest.fn().mockResolvedValue(undefined),
    state: "running",
  })) as unknown as typeof AudioContext;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("useAudioRecorderLifecycle recorder lifetime", () => {
  it("cancels pending permission immediately and ignores its late grant", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const lateTrackStop = jest.fn();
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>(resolve => { resolveStream = resolve; }));
    const onRecordingStateChange = jest.fn();
    const args = makeArgs({ onRecordingStateChange });
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    await act(async () => { void result.current.startRecording(); });
    await waitFor(() => expect(result.current.isInitializing).toBe(true));
    await waitFor(() => expect(onRecordingStateChange).toHaveBeenLastCalledWith(true));
    act(() => { result.current.cancelRecording(); });
    const stateAfterCancel = {
      initializing: result.current.isInitializing,
      recording: result.current.isRecording,
      activity: onRecordingStateChange.mock.calls.at(-1)?.[0],
    };

    await act(async () => {
      resolveStream?.({ getTracks: () => [{ stop: lateTrackStop }] } as unknown as MediaStream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect({
      ...stateAfterCancel,
      releasedRetiredStream: lateTrackStop.mock.calls.length,
      recorderConstructions: mockedAudioFormatUtils.createConfiguredMediaRecorder.mock.calls.length,
      recorderStarts: recorder.start.mock.calls.length,
      lateErrors: (args.onError as jest.Mock).mock.calls.length,
      activityAfterLateGrant: onRecordingStateChange.mock.calls.at(-1)?.[0],
    }).toEqual({
      initializing: false,
      recording: false,
      activity: false,
      releasedRetiredStream: 1,
      recorderConstructions: 0,
      recorderStarts: 0,
      lateErrors: 0,
      activityAfterLateGrant: false,
    });
  });

  it("lets a newer attempt start before the canceled attempt's permission resolves", async () => {
    let resolveOldStream: ((stream: MediaStream) => void) | undefined;
    const oldTrackStop = jest.fn();
    const newTrackStop = jest.fn();
    const oldStream = { getTracks: () => [{ stop: oldTrackStop }] } as unknown as MediaStream;
    const newStream = { getTracks: () => [{ stop: newTrackStop }] } as unknown as MediaStream;
    getUserMedia
      .mockReturnValueOnce(new Promise<MediaStream>(resolve => { resolveOldStream = resolve; }))
      .mockResolvedValueOnce(newStream);
    const onRecordingStateChange = jest.fn();
    const args = makeArgs({ onRecordingStateChange });
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    let oldAttempt: Promise<void> | undefined;
    await act(async () => { oldAttempt = result.current.startRecording(); });
    await waitFor(() => expect(result.current.isInitializing).toBe(true));
    act(() => { result.current.cancelRecording(); });
    await act(async () => { await result.current.startRecording(); });
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(onRecordingStateChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      resolveOldStream?.(oldStream);
      await oldAttempt;
      await Promise.resolve();
    });

    expect({
      activeStreamIsNew: mockedAudioFormatUtils.createConfiguredMediaRecorder.mock.calls[0]?.[0] === newStream,
      oldGrantStopped: oldTrackStop.mock.calls.length,
      newStreamStillActive: newTrackStop.mock.calls.length,
      recorderConstructions: mockedAudioFormatUtils.createConfiguredMediaRecorder.mock.calls.length,
      recorderStarts: recorder.start.mock.calls.length,
      stillRecording: result.current.isRecording,
      activityAfterOldGrant: onRecordingStateChange.mock.calls.at(-1)?.[0],
      errors: (args.onError as jest.Mock).mock.calls.length,
    }).toEqual({
      activeStreamIsNew: true,
      oldGrantStopped: 1,
      newStreamStillActive: 0,
      recorderConstructions: 1,
      recorderStarts: 1,
      stillRecording: true,
      activityAfterOldGrant: true,
      errors: 0,
    });

    act(() => { result.current.cancelRecording(); });
    expect(newTrackStop).toHaveBeenCalledTimes(1);
  });

  it("releases a microphone stream acquired after unmount without creating or starting a recorder", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>(resolve => { resolveStream = resolve; }));
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useAudioRecorderLifecycle(args));

    await act(async () => { void result.current.startRecording(); });
    await waitFor(() => expect(result.current.isInitializing).toBe(true));
    unmount();

    await act(async () => {
      resolveStream?.(makeStream());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect({
      releasedLateStream: trackStop.mock.calls.length,
      recorderConstructions: mockedAudioFormatUtils.createConfiguredMediaRecorder.mock.calls.length,
      recorderStarts: recorder.start.mock.calls.length,
      lateErrors: (args.onError as jest.Mock).mock.calls.length,
    }).toEqual({ releasedLateStream: 1, recorderConstructions: 0, recorderStarts: 0, lateErrors: 0 });
  });

  it("does not report a microphone rejection that arrives after unmount", async () => {
    let rejectPermission: ((error: Error) => void) | undefined;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((_resolve, reject) => { rejectPermission = reject; }));
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useAudioRecorderLifecycle(args));

    await act(async () => { void result.current.startRecording(); });
    await waitFor(() => expect(result.current.isInitializing).toBe(true));
    unmount();

    await act(async () => {
      rejectPermission?.(new Error("permission rejected after unmount"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(args.onError).not.toHaveBeenCalled();
  });

  it.each(["permission", "construction", "start"] as const)(
    "keeps the previous playable blob and retry source after Record Again fails at %s",
    async failure => {
      const args = makeArgs();
      const { result, rerender } = renderHook(props => useAudioRecorderLifecycle(props), { initialProps: args });
      await act(async () => { await result.current.startRecording(); });
      act(() => { dataHandler?.({ data: new Blob(["original audio"], { type: "audio/webm" }) as Blob } as BlobEvent); });
      act(() => { result.current.stopRecording(); });
      await waitFor(() => expect(args.onRecordingComplete).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.hasStoredAudio).toBe(true));
      const originalBlob = (args.onRecordingComplete as jest.Mock).mock.calls[0][0] as Blob;

      rerender(makeArgs({ ...args, transcriptionError: { said: "transcription failed" } }));
      const onClearError = args.onClearError as jest.Mock;
      onClearError.mockClear();
      (args.onError as jest.Mock).mockClear();

      if (failure === "permission") {
        getUserMedia.mockRejectedValueOnce(new Error("permission denied"));
      } else if (failure === "construction") {
        mockedAudioFormatUtils.createConfiguredMediaRecorder.mockImplementationOnce(() => {
          throw new Error("MediaRecorder construction failed");
        });
      } else {
        recorder.start.mockImplementationOnce(() => { throw new Error("MediaRecorder start failed"); });
      }

      act(() => { result.current.recordAgain(); });
      await waitFor(() => expect(args.onError).toHaveBeenCalled());
      const afterFailedReplacement = {
        hasStoredAudio: result.current.hasStoredAudio,
        clearedParentRetrySource: onClearError.mock.calls.length,
      };

      act(() => { result.current.retryTranscription(); });

      expect({
        ...afterFailedReplacement,
        retryReusedOriginalBlob: (args.onRecordingComplete as jest.Mock).mock.calls.length === 2 &&
          (args.onRecordingComplete as jest.Mock).mock.calls[1][0] === originalBlob,
      }).toEqual({
        hasStoredAudio: true,
        clearedParentRetrySource: 0,
        retryReusedOriginalBlob: true,
      });
    }
  );

  it("keeps activity true through permission, recording, pause, and pending finalization, then resets on completion or cancel", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>(resolve => { resolveStream = resolve; }));
    let resolveAudioInfo: (() => void) | undefined;
    mockedAudioFormatUtils.logAudioInfo.mockReturnValueOnce(new Promise<void>(resolve => { resolveAudioInfo = resolve; }));
    const onRecordingStateChange = jest.fn();
    const args = makeArgs({ onRecordingStateChange });
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    await act(async () => { void result.current.startRecording(); });
    await waitFor(() => expect(result.current.isInitializing).toBe(true));
    await waitFor(() => expect(onRecordingStateChange).toHaveBeenLastCalledWith(true));

    await act(async () => {
      resolveStream?.(makeStream());
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(onRecordingStateChange).toHaveBeenLastCalledWith(true);

    act(() => { result.current.pauseRecording(); });
    expect(result.current.isPaused).toBe(true);
    expect(onRecordingStateChange).toHaveBeenLastCalledWith(true);

    act(() => { dataHandler?.({ data: new Blob(["final audio"], { type: "audio/webm" }) as Blob } as BlobEvent); });
    act(() => { result.current.stopRecording(); });
    expect(result.current.isRecording).toBe(false);
    expect(onRecordingStateChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      resolveAudioInfo?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(args.onRecordingComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRecordingStateChange).toHaveBeenLastCalledWith(false));

    await act(async () => { await result.current.startRecording(); });
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    act(() => { result.current.cancelRecording(); });
    await waitFor(() => expect(onRecordingStateChange).toHaveBeenLastCalledWith(false));
  });
});
