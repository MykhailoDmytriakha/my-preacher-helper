import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { act } from 'react-dom/test-utils';
import '@testing-library/jest-dom';

// Import the REAL component (do NOT mock here)
import { AudioRecorder } from '@/components/AudioRecorder';

// Minimal mocks for Web Audio / Media APIs
class MockMediaStreamTrack {
  stop = jest.fn();
}

class MockMediaStream {
  getTracks() {
    return [new MockMediaStreamTrack() as unknown as MediaStreamTrack];
  }
}

type DataHandler = ((e: { data: Blob }) => void) | null;
type VoidHandler = (() => void) | null;

class MockMediaRecorder {
  public ondataavailable: DataHandler = null;
  public onstop: VoidHandler = null;
  public onerror: VoidHandler = null;
  public mimeType: string;
  public state: 'inactive' | 'recording' | 'paused' = 'inactive';
  private emittedChunk = false;
  static isTypeSupported = jest.fn().mockReturnValue(true);

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType || 'audio/webm';
  }

  start = () => {
    this.state = 'recording';
    // Immediately emit one non-empty chunk so onstop can build a Blob
    if (this.ondataavailable && !this.emittedChunk) {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType });
      this.ondataavailable({ data: blob });
      this.emittedChunk = true;
    }
  };

  pause = () => {
    this.state = 'paused';
  };

  resume = () => {
    this.state = 'recording';
  };

  stop = () => {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  };
}

const origMediaDevices = navigator.mediaDevices as any;
const origMediaRecorder = (global as any).MediaRecorder;
const origAudioContext = (global as any).AudioContext;

beforeEach(() => {
  jest.useFakeTimers();

  // getUserMedia mock
  (navigator as any).mediaDevices = {
    getUserMedia: jest.fn().mockResolvedValue(new MockMediaStream()),
  };

  // MediaRecorder mock
  (global as any).MediaRecorder = MockMediaRecorder;

  // Optional AudioContext mock (component tolerates absence, but avoid console noise)
  (global as any).AudioContext = function () {
    return { createMediaStreamSource: () => ({}), createAnalyser: () => ({ fftSize: 0, frequencyBinCount: 1, getByteFrequencyData: () => {} }), close: () => Promise.resolve(), state: 'running' } as any;
  } as any;

  (global as any).requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  (global as any).cancelAnimationFrame = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  (navigator as any).mediaDevices = origMediaDevices;
  (global as any).MediaRecorder = origMediaRecorder;
  (global as any).AudioContext = origAudioContext;
  jest.clearAllMocks();
});

describe('AudioRecorder autoStart behavior', () => {

  it('autoStart fires once, stops at maxDuration, and does not restart', async () => {
    const onComplete = jest.fn();

    const { rerender } = render(
      <AudioRecorder autoStart variant="mini" maxDuration={2} onRecordingComplete={onComplete} />
    );

    // Let useEffect schedule its 0ms timer, then flush all timers
    await act(async () => {
      // First tick to ensure effect runs
      await Promise.resolve();
      jest.runAllTimers();
    });

    // getUserMedia called once on autoStart
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    // Advance time to trigger auto stop at maxDuration (2s)
    await act(async () => {
      jest.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    // onRecordingComplete should be fired exactly once with a Blob
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toBeInstanceOf(Blob);

    // Simulate parent toggling processing state after stop
    rerender(
      <AudioRecorder autoStart variant="mini" maxDuration={2} onRecordingComplete={onComplete} isProcessing={true} />
    );
    rerender(
      <AudioRecorder autoStart variant="mini" maxDuration={2} onRecordingComplete={onComplete} isProcessing={false} />
    );

    // Ensure no second start occurred
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('AudioRecorder pause/resume behavior', () => {
  it('pauses the timer while paused and resumes after resume', async () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();

    render(<AudioRecorder variant="standard" maxDuration={5} onRecordingComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'audio.newRecording' }));

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole('button', { name: 'audio.stopRecording' })).toBeInTheDocument());

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(screen.getByText('0:02 / 0:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'audio.pauseRecording' }));

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(screen.getByText('0:02 / 0:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'audio.resumeRecording' }));

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(screen.getByText('0:03 / 0:05')).toBeInTheDocument();
  });
});

describe('AudioRecorder responsive variant', () => {
  it('switches to the mini variant automatically on narrow screens', async () => {
    const originalMatchMedia = window.matchMedia;
    const addEventListener = jest.fn();
    const removeEventListener = jest.fn();

    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener,
      removeEventListener,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
      onchange: null,
    } as MediaQueryList));

    const { container, unmount } = render(
      <AudioRecorder onRecordingComplete={jest.fn()} />
    );

    await waitFor(() => {
      expect(container.firstChild).toHaveClass('space-y-3');
    });

    unmount();
    window.matchMedia = originalMatchMedia;
  });
});
