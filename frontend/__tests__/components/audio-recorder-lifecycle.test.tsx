import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useAudioRecorderLifecycle } from "@/components/audio-recorder/useAudioRecorderLifecycle";
import { useResponsiveRecorderVariant } from "@/components/audio-recorder/useResponsiveRecorderVariant";
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
  getAudioGracePeriod: jest.fn(() => 2),
  getAudioRecordingDuration: jest.fn(() => 90),
}));

type RecorderMock = {
  mimeType?: string;
  start: jest.Mock;
  stop: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
};

type LifecycleOverrides = Partial<Parameters<typeof useAudioRecorderLifecycle>[0]>;

const mockedAudioFormatUtils = jest.mocked(audioFormatUtils);
const mockedAudioRecorderConfig = jest.mocked(audioRecorderConfig);

const originalMediaDevices = navigator.mediaDevices;
const originalAudioContext = (global as typeof globalThis & { AudioContext?: typeof AudioContext }).AudioContext;
const originalAlert = global.alert;
const originalBlob = global.Blob;
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;
const originalMatchMedia = window.matchMedia;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let recorder: RecorderMock;
let recordedDataHandler: ((event: BlobEvent) => void) | null;
let recordedStopHandler: (() => void) | null;
let _recordedErrorHandler: (() => void) | null;
let trackStop: jest.Mock;
let audioContextClose: jest.Mock;

const createArgs = (overrides: LifecycleOverrides = {}) => ({
  onRecordingComplete: jest.fn(),
  isProcessing: false,
  maxDuration: 2,
  onError: jest.fn(),
  disabled: false,
  onRetry: jest.fn(),
  transcriptionError: null,
  onClearError: jest.fn(),
  autoStart: false,
  hideKeyboardShortcuts: false,
  onRecordingStateChange: jest.fn(),
  t: (key: string) => key,
  ...overrides,
});

const startRecording = async (
  result: { current: ReturnType<typeof useAudioRecorderLifecycle> }
) => {
  await act(async () => {
    await result.current.startRecording();
  });
};

const emitRecordedBlob = (blob = new Blob([new Uint8Array([1])], { type: "audio/webm" })) => {
  act(() => {
    recordedDataHandler?.({ data: blob } as BlobEvent);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  recordedDataHandler = null;
  recordedStopHandler = null;
  _recordedErrorHandler = null;

  recorder = {
    mimeType: "audio/webm",
    start: jest.fn(),
    stop: jest.fn(() => {
      recordedStopHandler?.();
    }),
    pause: jest.fn(),
    resume: jest.fn(),
  };

  mockedAudioRecorderConfig.getAudioGracePeriod.mockReturnValue(2);

  mockedAudioFormatUtils.createConfiguredMediaRecorder.mockImplementation(
    (_stream, mimeType, onDataAvailable, onStop, onError) => {
      recorder.mimeType = mimeType;
      recordedDataHandler = onDataAvailable;
      recordedStopHandler = onStop;
      _recordedErrorHandler = onError;
      return recorder as unknown as MediaRecorder;
    }
  );

  trackStop = jest.fn();
  audioContextClose = jest.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: () => [{ stop: trackStop }],
      }),
    },
  });

  (global as typeof globalThis & { AudioContext?: typeof AudioContext }).AudioContext = jest.fn(
    () =>
      ({
        createMediaStreamSource: () => ({ connect: jest.fn() }),
        createAnalyser: () => ({
          fftSize: 0,
          frequencyBinCount: 1,
          getByteFrequencyData: (values: Uint8Array) => {
            values[0] = 64;
          },
        }),
        close: audioContextClose,
        state: "running",
      }) as unknown as AudioContext
  ) as unknown as typeof AudioContext;

  global.alert = jest.fn();
  global.requestAnimationFrame = jest.fn(() => 101);
  global.cancelAnimationFrame = jest.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => "blob:stored-audio"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn(),
  });
  window.matchMedia = originalMatchMedia;
});

afterEach(() => {
  jest.useRealTimers();

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });

  (global as typeof globalThis & { AudioContext?: unknown }).AudioContext = originalAudioContext;
  global.alert = originalAlert;
  global.Blob = originalBlob;
  global.requestAnimationFrame = originalRequestAnimationFrame;
  global.cancelAnimationFrame = originalCancelAnimationFrame;
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
  } else {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  }
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  } else {
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
  window.matchMedia = originalMatchMedia;

  jest.clearAllMocks();
});

describe("useAudioRecorderLifecycle", () => {
  it("records successfully, retries transcription, closes errors, and clears stored audio", async () => {
    const args = createArgs();
    const { result, rerender } = renderHook((props) => useAudioRecorderLifecycle(props), {
      initialProps: args,
    });

    await waitFor(() => {
      expect(args.onRecordingStateChange).toHaveBeenCalledWith(false);
    });

    await startRecording(result);
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });
    expect(args.onRecordingStateChange).toHaveBeenLastCalledWith(true);

    recorder.mimeType = undefined;
    emitRecordedBlob();

    act(() => {
      result.current.stopRecording();
    });

    await waitFor(() => {
      expect(args.onRecordingComplete).toHaveBeenCalledTimes(1);
    });
    expect(mockedAudioFormatUtils.logAudioInfo).toHaveBeenCalledTimes(1);
    expect(result.current.hasStoredAudio).toBe(true);
    await waitFor(() => {
      expect(result.current.storedAudioUrl).toBe("blob:stored-audio");
    });

    rerender(createArgs({ ...args, transcriptionError: "boom" }));
    expect(result.current.transcriptionErrorMessage).toBe("boom");

    act(() => {
      result.current.retryTranscription();
    });
    expect(args.onRetry).toHaveBeenCalledTimes(1);

    rerender(createArgs({ ...args, transcriptionError: null }));
    const onClearError = args.onClearError as jest.Mock;
    const clearCallsBeforeClose = onClearError.mock.calls.length;
    act(() => {
      result.current.closeError();
    });
    expect(onClearError).toHaveBeenCalledTimes(clearCallsBeforeClose + 1);
    expect(result.current.hasStoredAudio).toBe(false);
    await waitFor(() => {
      expect(result.current.storedAudioUrl).toBeNull();
    });

    await startRecording(result);
    emitRecordedBlob();
    act(() => {
      result.current.stopRecording();
    });
    await waitFor(() => {
      expect(result.current.hasStoredAudio).toBe(true);
    });

    act(() => {
      (window as unknown as { clearAudioRecorderStorage: () => void }).clearAudioRecorderStorage();
    });
    expect(result.current.hasStoredAudio).toBe(false);
    expect(result.current.transcriptionErrorMessage).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stored-audio");
  });

  it("retries a saved recording through the completion callback when no parent retry is supplied", async () => {
    const args = createArgs({ onRetry: undefined });
    const { result, rerender } = renderHook((props) => useAudioRecorderLifecycle(props), {
      initialProps: args,
    });

    await startRecording(result);
    emitRecordedBlob();

    act(() => {
      result.current.stopRecording();
    });

    await waitFor(() => {
      expect(args.onRecordingComplete).toHaveBeenCalledTimes(1);
    });

    rerender(createArgs({ ...args, onRetry: undefined, transcriptionError: "transcription failed" }));

    const onClearError = args.onClearError as jest.Mock;
    const clearCallsBeforeRetry = onClearError.mock.calls.length;
    act(() => {
      result.current.retryTranscription();
    });

    expect(onClearError).toHaveBeenCalledTimes(clearCallsBeforeRetry + 1);
    expect(args.onRecordingComplete).toHaveBeenCalledTimes(2);
    expect(args.onRecordingComplete).toHaveBeenLastCalledWith(expect.any(Blob));
  });

  it("guards start and falls back to alert when microphone access fails", async () => {
    const disabledArgs = createArgs({ disabled: true, onError: undefined });
    const { result, rerender } = renderHook((props) => useAudioRecorderLifecycle(props), {
      initialProps: disabledArgs,
    });

    await startRecording(result);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValueOnce(new Error("blocked"));
    rerender(createArgs({ ...disabledArgs, disabled: false, onError: undefined }));

    await startRecording(result);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith("errors.microphoneUnavailable");
    });
  });

  it("surfaces known format issues and empty-stop failures", async () => {
    const args = createArgs();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockedAudioFormatUtils.hasKnownIssues.mockReturnValue(true);

    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    await startRecording(result);
    act(() => {
      result.current.stopRecording();
    });

    await waitFor(() => {
      expect(args.onError).toHaveBeenCalledWith("errors.audioProcessing");
    });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles stop, pause, resume, and cancel edge cases", async () => {
    const args = createArgs();
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    act(() => {
      result.current.stopRecording();
      result.current.cancelRecording();
      result.current.pauseRecording();
      result.current.resumeRecording();
    });

    await startRecording(result);

    recorder.pause.mockImplementationOnce(() => {
      throw new Error("pause failed");
    });
    act(() => {
      result.current.pauseRecording();
    });
    expect(args.onError).toHaveBeenCalledWith("errors.audioProcessing");

    await startRecording(result);
    act(() => {
      result.current.pauseRecording();
    });
    recorder.resume.mockImplementationOnce(() => {
      throw new Error("resume failed");
    });
    act(() => {
      result.current.resumeRecording();
    });
    expect(args.onError).toHaveBeenCalledWith("errors.audioProcessing");

    await startRecording(result);
    recorder.stop.mockImplementationOnce(() => {
      throw new Error("stop failed");
    });
    act(() => {
      result.current.stopRecording();
    });
    expect(args.onError).toHaveBeenCalledWith("errors.audioProcessing");

    await startRecording(result);
    recorder.stop.mockImplementationOnce(() => {
      throw new Error("cancel failed");
    });
    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isPaused).toBe(false);
  });

  it("stops at max duration without grace period and cleans up active resources on unmount", async () => {
    mockedAudioRecorderConfig.getAudioGracePeriod.mockReturnValue(0);
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const args = createArgs({ maxDuration: 1 });
    const { result, unmount } = renderHook(() => useAudioRecorderLifecycle(args));

    await startRecording(result);
    emitRecordedBlob();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(args.onRecordingComplete).toHaveBeenCalledTimes(1);
    });

    await startRecording(result);
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });
    expect(global.requestAnimationFrame).toHaveBeenCalled();

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(101);
    expect(trackStop).toHaveBeenCalled();
    expect(audioContextClose).toHaveBeenCalled();
  });

  it("clears the running timer before a deferred stop and surfaces empty blob errors", async () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const args = createArgs({ maxDuration: 5 });
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    recorder.stop.mockImplementation(() => {});

    await startRecording(result);
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(result.current.recordingTime).toBe(1);

    act(() => {
      recordedDataHandler?.({ data: { size: 1 } as Blob } as BlobEvent);
    });

    class EmptyBlob {
      size = 0;
      type: string;

      constructor(_parts?: BlobPart[], options?: BlobPropertyBag) {
        this.type = options?.type ?? "audio/webm";
      }
    }

    global.Blob = EmptyBlob as unknown as typeof Blob;

    act(() => {
      result.current.stopRecording();
    });

    await waitFor(() => {
      expect(result.current.isRecording).toBe(false);
    });
    expect(clearIntervalSpy).toHaveBeenCalled();

    await act(async () => {
      await recordedStopHandler?.();
    });

    await waitFor(() => {
      expect(args.onError).toHaveBeenCalledWith("errors.audioProcessing");
    });
    expect(args.onRecordingComplete).not.toHaveBeenCalled();
  });

  it("records without creating audio-level monitoring when disabled", async () => {
    const args = createArgs({ enableAudioLevelMonitoring: false });
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));

    await startRecording(result);
    emitRecordedBlob();

    act(() => {
      result.current.stopRecording();
    });

    await waitFor(() => {
      expect(args.onRecordingComplete).toHaveBeenCalledTimes(1);
    });
    expect(global.AudioContext).not.toHaveBeenCalled();
    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("routes keyboard shortcuts correctly", async () => {
    const args = createArgs();
    const { result } = renderHook(() => useAudioRecorderLifecycle(args));
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { code: "Space", ctrlKey: true });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { code: "Space", ctrlKey: true });
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.isRecording).toBe(true);
    });

    fireEvent.keyDown(document, { code: "Escape" });
    await waitFor(() => {
      expect(result.current.isRecording).toBe(false);
    });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});

describe("useResponsiveRecorderVariant", () => {
  it("covers modern matchMedia listeners and the explicit mini override", () => {
    let changeListener: ((event: MediaQueryListEvent) => void) | null = null;
    const addEventListener = jest.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      changeListener = listener;
    });
    const removeEventListener = jest.fn();

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      media: "(max-width: 767px)",
      addEventListener,
      removeEventListener,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      onchange: null,
      dispatchEvent: jest.fn(),
    }));

    const { result, unmount } = renderHook(
      () => useResponsiveRecorderVariant("standard")
    );

    expect(result.current).toBe("mini");
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    act(() => {
      changeListener?.({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current).toBe("standard");

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    const { result: miniResult } = renderHook(() => useResponsiveRecorderVariant("mini"));
    expect(miniResult.current).toBe("mini");
  });

  it("covers legacy listeners and resize fallback directly", () => {
    const legacyAddListener = jest.fn();
    const legacyRemoveListener = jest.fn();

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 767px)",
      addEventListener: undefined,
      removeEventListener: undefined,
      addListener: legacyAddListener,
      removeListener: legacyRemoveListener,
      onchange: null,
      dispatchEvent: jest.fn(),
    }));

    const { result, unmount } = renderHook(() => useResponsiveRecorderVariant("standard"));
    expect(result.current).toBe("standard");
    expect(legacyAddListener).toHaveBeenCalled();

    unmount();
    expect(legacyRemoveListener).toHaveBeenCalled();
  });

  it("covers resize fallback when matchMedia is unavailable", () => {
    const addEventListener = jest.spyOn(window, "addEventListener");
    const removeEventListener = jest.spyOn(window, "removeEventListener");
    const originalInnerWidth = window.innerWidth;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
      writable: true,
    });

    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    const { result, unmount } = renderHook(() => useResponsiveRecorderVariant("standard"));
    expect(result.current).toBe("standard");
    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 600,
        writable: true,
      });
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toBe("mini");

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    });

    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });
});
