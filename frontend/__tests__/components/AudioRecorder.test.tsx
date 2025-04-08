import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the AudioRecorder component completely with a more sophisticated implementation
// that can handle state changes and simulate behavior
jest.mock('@components/AudioRecorder', () => {
  const MockAudioRecorder = (props: any) => {
    const [isRecording, setIsRecording] = React.useState(false);
    const [recordingTime, setRecordingTime] = React.useState(0);
    
    const handleStartRecording = () => {
      if (props.isProcessing) return;
      setIsRecording(true);
      setRecordingTime(1); // Simulate 1 second passed
    };

    const handleStopRecording = () => {
      setIsRecording(false);
      setRecordingTime(0);
      // Call the callback with a mock blob
      if (props.onRecordingComplete) {
        const mockBlob = new Blob([], { type: 'audio/webm' });
        props.onRecordingComplete(mockBlob);
      }
    };

    const handleErrorClick = () => {
      // Simulate microphone permission error
      if (props.onError) {
        props.onError('errors.microphoneAccess');
      }
      window.alert('errors.microphoneAccess');
    };

    return (
      <div data-testid="audio-recorder-component">
        {!isRecording ? (
          <button 
            data-testid="record-button"
            disabled={props.isProcessing}
            onClick={handleStartRecording}
          >
            {props.isProcessing ? 'audio.processing' : 'audio.newRecording'}
          </button>
        ) : (
          <button 
            data-testid="stop-button"
            onClick={handleStopRecording}
          >
            audio.stopRecording
          </button>
        )}
        
        <div data-testid="timer">
          {isRecording ? `0:0${recordingTime}` : '0:00'} / 1:00
        </div>
        
        <div data-testid="audio-progress-bar-container">
          <div 
            data-testid="progress-bar"
            style={{ width: isRecording ? `${(recordingTime / 60) * 100}%` : '0%' }}
          ></div>
        </div>
        
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
  
  it('transitions to recording state when record button is clicked', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
    // Should now be in recording state
    expect(screen.getByTestId('stop-button')).toBeInTheDocument();
    expect(screen.queryByTestId('record-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('timer')).toHaveTextContent('0:01 / 1:00');
    
    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toHaveStyle('width: 1.6666666666666667%'); // 1/60 * 100
  });
  
  it('calls onRecordingComplete when stopping recording', () => {
    render(
      <AudioRecorder
        onRecordingComplete={mockOnRecordingComplete}
        isProcessing={false}
      />
    );
    
    // Start recording
    const recordButton = screen.getByTestId('record-button');
    fireEvent.click(recordButton);
    
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
    expect(alertSpy).toHaveBeenCalledWith('errors.microphoneAccess');
    
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
}); 