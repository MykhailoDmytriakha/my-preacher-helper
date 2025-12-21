import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { act } from 'react-dom/test-utils';

import '@testing-library/jest-dom';
import { FocusRecorderButton } from '@/components/FocusRecorderButton';

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock MediaDevices and MediaRecorder
const mockGetUserMedia = jest.fn();
const mockStop = jest.fn();

// Mock MediaRecorder
class MockMediaRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string = 'audio/webm';

  constructor(_stream: MediaStream, options?: { mimeType: string }) {
    this.mimeType = options?.mimeType || 'audio/webm';
  }

  start() {
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (this.onstop) {
      setTimeout(() => {
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['test'], { type: 'audio/webm' }) });
        }
        if (this.onstop) {
          this.onstop();
        }
      }, 0);
    }
  }

  static isTypeSupported(mimeType: string) {
    return mimeType === 'audio/webm;codecs=opus';
  }
}

// Mock AudioContext
class MockAudioContext {
  state: string = 'running';
  
  createMediaStreamSource() {
    return {
      connect: jest.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: jest.fn(),
    };
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

describe('FocusRecorderButton', () => {
  beforeEach(() => {
    // Reset mocks
    mockGetUserMedia.mockClear();
    mockStop.mockClear();

    // Setup MediaDevices mock
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: mockGetUserMedia,
      },
      writable: true,
    });

    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: mockStop }],
    } as unknown as MediaStream);

    // Setup MediaRecorder mock
    global.MediaRecorder = MockMediaRecorder as any;

    // Setup AudioContext mock
    global.AudioContext = MockAudioContext as any;

    // Mock requestAnimationFrame
    global.requestAnimationFrame = jest.fn((cb) => {
      cb(0);
      return 0;
    });

    // Mock cancelAnimationFrame
    global.cancelAnimationFrame = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Rendering', () => {
    it('should render idle state with gray button', () => {
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} />);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('bg-gray-400');
      expect(button).toHaveAttribute('aria-label', 'audio.newRecording');
    });

    it('should render small size variant', () => {
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} size="small" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('w-10');
      expect(button).toHaveClass('h-10');
    });

    it('should show microphone icon in idle state', () => {
      const { container } = render(<FocusRecorderButton onRecordingComplete={jest.fn()} />);
      
      // Check for MicrophoneIcon (it has a specific class or SVG structure)
      const svgIcon = container.querySelector('svg');
      expect(svgIcon).toBeInTheDocument();
    });

    it('should be disabled when disabled prop is true', () => {
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} disabled={true} />);
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveClass('disabled:opacity-50');
    });

    it('should be disabled when isProcessing is true', () => {
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} isProcessing={true} />);
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });
  });

  describe('Recording Functionality', () => {
    it('should show initializing state while waiting for microphone permission', async () => {
      let resolveStream: ((stream: MediaStream) => void) | undefined;
      const pendingStream = new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      });

      mockGetUserMedia.mockReturnValueOnce(pendingStream);

      const onRecordingComplete = jest.fn();
      const { container, unmount } = render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);

      const button = screen.getByRole('button', { name: 'audio.newRecording' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
        expect(button).toHaveClass('bg-yellow-500');
      });

      const initializingIcon = container.querySelector('svg.animate-pulse');
      expect(initializingIcon).toBeInTheDocument();

      // Resolve to avoid leaving a pending promise in the test
      act(() => {
        resolveStream?.({
          getTracks: () => [{ stop: mockStop }],
        } as unknown as MediaStream);
      });

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      unmount();
    });

    it('should start recording on button click', async () => {
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockGetUserMedia).toHaveBeenCalledWith({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      });

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
        expect(button).toHaveAttribute('aria-label', 'audio.stopRecording');
      });
    });

    it('should show countdown timer when recording', async () => {
      jest.useFakeTimers();
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} maxDuration={90} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      // Timer should show remaining time (90 seconds initially)
      expect(screen.getByText('1:30')).toBeInTheDocument();

      // Advance timer by 1 second
      jest.advanceTimersByTime(1000);

      await waitFor(() => {
        expect(screen.getByText('1:29')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });

    it('should show cancel button when recording', async () => {
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const recordButton = screen.getByRole('button', { name: 'audio.newRecording' });
      fireEvent.click(recordButton);

      await waitFor(() => {
        const cancelButton = screen.getByRole('button', { name: 'audio.cancelRecording' });
        expect(cancelButton).toBeInTheDocument();
      });
    });

    it('pauses the countdown when paused and resumes after resume', async () => {
      jest.useFakeTimers();
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} maxDuration={10} />);

      const recordButton = screen.getByRole('button', { name: 'audio.newRecording' });
      fireEvent.click(recordButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'audio.pauseRecording' })).toBeInTheDocument();
      });

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(screen.getByText('0:08')).toBeInTheDocument();

      const pauseButton = screen.getByRole('button', { name: 'audio.pauseRecording' });
      fireEvent.click(pauseButton);

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(screen.getByText('0:08')).toBeInTheDocument();

      const resumeButton = screen.getByRole('button', { name: 'audio.resumeRecording' });
      fireEvent.click(resumeButton);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(screen.getByText('0:06')).toBeInTheDocument();

      jest.useRealTimers();
    });

    it('should cancel recording when cancel button is clicked', async () => {
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const recordButton = screen.getByRole('button', { name: 'audio.newRecording' });
      fireEvent.click(recordButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'audio.cancelRecording' })).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: 'audio.cancelRecording' });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(onRecordingComplete).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'audio.cancelRecording' })).not.toBeInTheDocument();
      });
    });

    it('should stop recording and call onRecordingComplete', async () => {
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const button = screen.getByRole('button');
      
      // Start recording
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      // Stop recording
      fireEvent.click(button);

      await waitFor(() => {
        expect(onRecordingComplete).toHaveBeenCalledWith(expect.any(Blob));
      });
    });

    it('should automatically stop recording after maxDuration', async () => {
      jest.useFakeTimers();
      const onRecordingComplete = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} maxDuration={5} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      // Fast-forward time by maxDuration
      jest.advanceTimersByTime(5000);

      await waitFor(() => {
        expect(onRecordingComplete).toHaveBeenCalled();
      });

      jest.useRealTimers();
    });
  });

  describe('Progress Indicator', () => {
    it('should show circular progress when recording', async () => {
      const onRecordingComplete = jest.fn();
      const { container } = render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      // Check for SVG progress circle
      const progressCircles = container.querySelectorAll('circle');
      expect(progressCircles.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle microphone permission error', async () => {
      mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
      
      const onError = jest.fn();
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} onError={onError} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('errors.microphoneUnavailable');
      });
    });

    it('should show alert if no error handler provided', async () => {
      mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
      
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation();
      render(<FocusRecorderButton onRecordingComplete={jest.fn()} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('errors.microphoneUnavailable');
      });

      alertSpy.mockRestore();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources on unmount', async () => {
      const onRecordingComplete = jest.fn();
      const { unmount } = render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      unmount();

      expect(mockStop).toHaveBeenCalled();
    });

    it('should cleanup timer on unmount', async () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      const onRecordingComplete = jest.fn();
      const { unmount } = render(<FocusRecorderButton onRecordingComplete={onRecordingComplete} />);
      
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveClass('bg-red-500');
      });

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      
      clearIntervalSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('Processing State', () => {
    it('should show processing state with spinner', () => {
      const { container } = render(
        <FocusRecorderButton onRecordingComplete={jest.fn()} isProcessing={true} />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-blue-500');
      
      // Check for spinner
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });
});
