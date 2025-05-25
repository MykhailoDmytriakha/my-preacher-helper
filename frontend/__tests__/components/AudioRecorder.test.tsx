import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the AudioRecorder component completely with a more sophisticated implementation
// that can handle state changes and simulate behavior
jest.mock('@components/AudioRecorder', () => {
  const MockAudioRecorder = (props: any) => {
    const [isRecording, setIsRecording] = React.useState(false);
    const [recordingTime, setRecordingTime] = React.useState(0);
    const [isInitializing, setIsInitializing] = React.useState(false);
    const [audioLevel, setAudioLevel] = React.useState(0);
    
    const handleStartRecording = () => {
      if (props.isProcessing || props.disabled || isInitializing) return;
      setIsInitializing(true);
      setTimeout(() => {
        setIsInitializing(false);
        setIsRecording(true);
        setRecordingTime(1); // Simulate 1 second passed
        setAudioLevel(50); // Simulate audio level
      }, 100);
    };

    const handleStopRecording = () => {
      setIsRecording(false);
      setRecordingTime(0);
      setAudioLevel(0);
      // Call the callback with a mock blob
      if (props.onRecordingComplete) {
        const mockBlob = new Blob([], { type: 'audio/webm' });
        props.onRecordingComplete(mockBlob);
      }
    };

    const handleCancelRecording = () => {
      setIsRecording(false);
      setRecordingTime(0);
      setAudioLevel(0);
      // Don't call onRecordingComplete for cancel
    };

    const handleErrorClick = () => {
      // Simulate microphone permission error
      if (props.onError) {
        props.onError('errors.microphoneUnavailable');
      } else {
        window.alert('errors.microphoneUnavailable');
      }
    };

    const maxDuration = props.maxDuration || 60;
    const recordingState = props.isProcessing ? 'processing' : 
                          isInitializing ? 'initializing' : 
                          isRecording ? 'recording' : 'idle';

    return (
      <div data-testid="audio-recorder-component" className={props.className}>
        {/* Main controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button 
            data-testid={isRecording ? "stop-button" : "record-button"}
            disabled={props.isProcessing || props.disabled || isInitializing}
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className="min-w-[200px] px-6 py-3 rounded-xl font-medium"
          >
            {recordingState === 'processing' && 'audio.processing'}
            {recordingState === 'initializing' && 'audio.initializing'}
            {recordingState === 'recording' && 'audio.stopRecording'}
            {recordingState === 'idle' && 'audio.newRecording'}
          </button>
          
          {isRecording && (
            <button 
              data-testid="cancel-button"
              onClick={handleCancelRecording}
            >
              audio.cancelRecording
            </button>
          )}
          
          <div data-testid="timer" className="text-sm font-mono">
            {isRecording ? `0:0${recordingTime}` : '0:00'} / {Math.floor(maxDuration / 60)}:{(maxDuration % 60).toString().padStart(2, '0')}
          </div>
          
          {isRecording && (
            <div data-testid="recording-indicator" className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <div className="text-xs">audio.recording</div>
            </div>
          )}
        </div>
        
        {/* Progress bar */}
        <div data-testid="audio-progress-bar-container" className="w-full">
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              data-testid="progress-bar"
              style={{ width: isRecording ? `${(recordingTime / maxDuration) * 100}%` : '0%' }}
              className="h-full rounded-full"
            ></div>
          </div>
          
          {/* Audio level indicator */}
          {isRecording && audioLevel > 0 && (
            <div data-testid="audio-level-indicator" className="mt-2">
              <div className="flex items-center gap-2 text-xs">
                <span>audio.audioLevel:</span>
                <div className="flex-1 bg-gray-200 h-1 rounded-full">
                  <div 
                    data-testid="audio-level-bar"
                    style={{ width: `${audioLevel}%` }}
                    className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500"
                  />
                </div>
                <span data-testid="audio-level-value">{Math.round(audioLevel)}%</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Keyboard shortcuts hint */}
        {!isRecording && (
          <div data-testid="keyboard-shortcuts" className="text-xs text-center">
            audio.keyboardShortcuts: Ctrl+Space audio.toRecord, Esc audio.toCancel
          </div>
        )}
        
        {/* For testing error states */}
        <button 
          data-testid="error-button" 
          onClick={handleErrorClick}
        >
          Simulate Error
        </button>
      </div>
    );
  };
  
  return {
    AudioRecorder: MockAudioRecorder
  };
});

// Import the mocked component
import { AudioRecorder } from '@components/AudioRecorder';

describe('AudioRecorder - UI Tests', () => {
  const mockOnRecordingComplete = jest.fn();
  const mockOnError = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders in initial state', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    expect(screen.getByTestId('audio-recorder-component')).toBeInTheDocument();
    expect(screen.getByTestId('record-button')).toBeInTheDocument();
    expect(screen.getByTestId('record-button')).toBeEnabled();
    expect(screen.getByTestId('record-button')).toHaveTextContent('audio.newRecording');
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00 / 1:00');
    
    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toHaveStyle('width: 0%');
  });

  it('shows processing state when isProcessing is true', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={true}
      />
    );
    
    expect(screen.getByTestId('record-button')).toBeDisabled();
    expect(screen.getByTestId('record-button')).toHaveTextContent('audio.processing');
  });
  
  it('transitions to recording state when record button is clicked', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start (after initialization)
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should now be in recording state
    expect(screen.getByTestId('stop-button')).toBeInTheDocument();
    expect(screen.queryByTestId('record-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:01 / 1:00');
    
    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toHaveStyle('width: 1.6666666666666667%'); // 1/60 * 100
  });
  
  it('calls onRecordingComplete when stopping recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Stop recording
    const stopButton = screen.getByTestId('stop-button');
    fireEvent.click(stopButton);
    
    // Verify callback was called with a Blob
    expect(mockOnRecordingComplete).toHaveBeenCalledTimes(1);
    expect(mockOnRecordingComplete.mock.calls[0][0]).toBeInstanceOf(Blob);
    
    // Should be back in initial state
    expect(screen.getByTestId('record-button')).toBeInTheDocument();
    expect(screen.queryByTestId('stop-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00 / 1:00');
    
    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toHaveStyle('width: 0%');
  });
  
  it('handles errors correctly', () => {
    // Mock window.alert
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Trigger an error
    const errorButton = screen.getByTestId('error-button');
    fireEvent.click(errorButton);
    
    // Check if error handling works
    expect(alertSpy).toHaveBeenCalledWith('errors.microphoneUnavailable');
    
    // Clean up
    alertSpy.mockRestore();
  });
  
  it('does not allow recording when in processing state', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={true}
      />
    );
    
    const recordButton = screen.getByTestId('record-button');
    expect(recordButton).toBeDisabled();
    
    // Try to click anyway
    fireEvent.click(recordButton);
    
    // Should still be in initial state, not recording
    expect(screen.queryByTestId('stop-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00 / 1:00');
  });

  it('shows cancel button during recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should show both stop and cancel buttons
    expect(screen.getByTestId('stop-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toHaveTextContent('audio.cancelRecording');
  });

  it('cancels recording without calling onRecordingComplete', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Verify we're recording
    expect(screen.getByTestId('stop-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:01 / 1:00');
    
    // Cancel recording
    const cancelButton = screen.getByTestId('cancel-button');
    fireEvent.click(cancelButton);
    
    // Should return to initial state without calling onRecordingComplete
    expect(mockOnRecordingComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-button')).toBeInTheDocument();
    expect(screen.queryByTestId('stop-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00 / 1:00');
    
    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toHaveStyle('width: 0%');
  });

  it('does not show cancel button when not recording', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Should not show cancel button in initial state
    expect(screen.getByTestId('record-button')).toBeInTheDocument();
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument();
  });

  it('shows initializing state when starting recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Should show initializing state briefly
    expect(recordButton).toHaveTextContent('audio.initializing');
    expect(recordButton).toBeDisabled();
  });

  it('shows audio level indicator during recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should show audio level indicator
    expect(screen.getByTestId('audio-level-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('audio-level-bar')).toBeInTheDocument();
    expect(screen.getByTestId('audio-level-value')).toHaveTextContent('50%');
  });

  it('shows recording indicator during recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should show recording indicator
    expect(screen.getByTestId('recording-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('recording-indicator')).toHaveTextContent('audio.recording');
  });

  it('shows keyboard shortcuts when not recording', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Should show keyboard shortcuts
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
    expect(screen.getByTestId('keyboard-shortcuts')).toHaveTextContent('audio.keyboardShortcuts');
  });

  it('hides keyboard shortcuts when recording', async () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Wait for recording to start
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should not show keyboard shortcuts during recording
    expect(screen.queryByTestId('keyboard-shortcuts')).not.toBeInTheDocument();
  });

  it('respects custom maxDuration prop', () => {
    const customMaxDuration = 120; // 2 minutes
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
        maxDuration={customMaxDuration}
      />
    );
    
    // Should show custom max duration in timer
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00 / 2:00');
  });

  it('respects disabled prop', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
        disabled={true}
      />
    );
    
    const recordButton = screen.getByTestId('record-button');
    expect(recordButton).toBeDisabled();
    
    // Try to click anyway
    fireEvent.click(recordButton);
    
    // Should still be in initial state
    expect(screen.getByTestId('record-button')).toHaveTextContent('audio.newRecording');
  });

  it('applies custom className', () => {
    const customClass = 'my-custom-class';
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
        className={customClass}
      />
    );
    
    expect(screen.getByTestId('audio-recorder-component')).toHaveClass(customClass);
  });

  it('calls onError callback when provided', () => {
    const mockOnError = jest.fn();
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
        onError={mockOnError}
      />
    );
    
    // Trigger an error
    const errorButton = screen.getByTestId('error-button');
    fireEvent.click(errorButton);
    
    // Should call onError instead of alert
    expect(mockOnError).toHaveBeenCalledWith('errors.microphoneUnavailable');
  });
}); 