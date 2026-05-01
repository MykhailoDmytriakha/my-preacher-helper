import { fireEvent, render, screen } from '@testing-library/react';

import { FlatRecorderButton } from '@/components/FlatRecorderButton';
import { useAudioRecorderLifecycle } from '@/components/audio-recorder/useAudioRecorderLifecycle';

jest.mock('@/components/audio-recorder/useAudioRecorderLifecycle', () => ({
  useAudioRecorderLifecycle: jest.fn(),
}));

jest.mock('@/components/audio-recorder/AudioRecorderControls', () => ({
  AudioRecoveryPanel: ({ show }: { show: boolean }) => show ? <div data-testid="recovery-panel" /> : null,
  ErrorBanner: ({ errorMessage }: { errorMessage: string | null }) => errorMessage ? <div data-testid="error-banner">{errorMessage}</div> : null,
}));

const mockUseAudioRecorderLifecycle = useAudioRecorderLifecycle as jest.MockedFunction<typeof useAudioRecorderLifecycle>;

const makeLifecycle = (overrides = {}) => ({
  recordingTime: 0,
  isRecording: false,
  isPaused: false,
  audioLevel: 0,
  isInitializing: false,
  isInGracePeriod: false,
  gracePeriodRemaining: 0,
  recordingState: 'idle' as const,
  transcriptionErrorMessage: null,
  hasStoredAudio: false,
  storedAudioUrl: null,
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  cancelRecording: jest.fn(),
  pauseRecording: jest.fn(),
  resumeRecording: jest.fn(),
  retryTranscription: jest.fn(),
  recordAgain: jest.fn(),
  discardStoredAudio: jest.fn(),
  closeError: jest.fn(),
  ...overrides,
});

describe('FlatRecorderButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts recording from the compact idle control and disables audio-level monitoring', () => {
    const lifecycle = makeLifecycle();
    mockUseAudioRecorderLifecycle.mockReturnValue(lifecycle);

    render(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={30} />);

    fireEvent.click(screen.getByRole('button', { name: 'audio.newRecording' }));

    expect(lifecycle.startRecording).toHaveBeenCalledTimes(1);
    expect(mockUseAudioRecorderLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        autoStart: false,
        hideKeyboardShortcuts: true,
        enableAudioLevelMonitoring: false,
        maxDuration: 30,
      })
    );
  });

  it('shows timer and pause/cancel/finish controls while recording', () => {
    const lifecycle = makeLifecycle({
      recordingTime: 5,
      isRecording: true,
      recordingState: 'recording' as const,
    });
    mockUseAudioRecorderLifecycle.mockReturnValue(lifecycle);

    render(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={30} />);

    expect(screen.getByTestId('flat-recorder-button')).toHaveClass('w-[188px]');
    expect(screen.getByTestId('flat-recorder-timer')).toHaveTextContent('0:25');
    expect(screen.getByText('0:25')).toHaveClass('whitespace-nowrap');

    fireEvent.click(screen.getByRole('button', { name: 'audio.pauseRecording' }));
    fireEvent.click(screen.getByRole('button', { name: 'audio.cancelRecording' }));
    fireEvent.click(screen.getByRole('button', { name: 'audio.stopRecording' }));

    expect(lifecycle.pauseRecording).toHaveBeenCalledTimes(1);
    expect(lifecycle.cancelRecording).toHaveBeenCalledTimes(1);
    expect(lifecycle.stopRecording).toHaveBeenCalledTimes(1);
  });

  it('keeps the same fixed width across idle and recording states', () => {
    const idleLifecycle = makeLifecycle();
    const recordingLifecycle = makeLifecycle({
      recordingTime: 61,
      isRecording: true,
      recordingState: 'recording' as const,
    });
    mockUseAudioRecorderLifecycle.mockReturnValue(idleLifecycle);

    const { rerender } = render(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={90} />);

    expect(screen.getByTestId('flat-recorder-button')).toHaveClass('w-[188px]');

    mockUseAudioRecorderLifecycle.mockReturnValue(recordingLifecycle);
    rerender(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={90} />);

    expect(screen.getByTestId('flat-recorder-button')).toHaveClass('w-[188px]');
    expect(screen.getByTestId('flat-recorder-timer')).toHaveTextContent('0:29');
  });

  it('uses focus recorder colors for pause/resume and cancel actions', () => {
    const lifecycle = makeLifecycle({
      recordingTime: 5,
      isRecording: true,
      recordingState: 'recording' as const,
    });
    mockUseAudioRecorderLifecycle.mockReturnValue(lifecycle);

    const { rerender } = render(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={30} />);

    expect(screen.getByRole('button', { name: 'audio.pauseRecording' })).toHaveClass('bg-yellow-500');
    expect(screen.getByRole('button', { name: 'audio.cancelRecording' })).toHaveClass('bg-white');

    mockUseAudioRecorderLifecycle.mockReturnValue(makeLifecycle({
      recordingTime: 5,
      isRecording: true,
      isPaused: true,
      recordingState: 'paused' as const,
    }));
    rerender(<FlatRecorderButton onRecordingComplete={jest.fn()} maxDuration={30} />);

    expect(screen.getByRole('button', { name: 'audio.resumeRecording' })).toHaveClass('bg-green-500');
  });
});
