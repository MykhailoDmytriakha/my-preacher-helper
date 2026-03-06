import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
  AudioLevelIndicator,
  ErrorBanner,
  MainRecordButton,
  RecordingActionButtons,
  RecordingProgress,
  RetryTranscriptionButton,
  SplitRecordButton,
} from "@/components/audio-recorder/AudioRecorderControls";

const t = (key: string) => key;

describe("AudioRecorderControls", () => {
  it("covers main record button states and start/stop handlers", () => {
    const onStart = jest.fn();
    const onStop = jest.fn();
    const { rerender, container } = render(
      <MainRecordButton
        show={true}
        appliedVariant="standard"
        isRecording={false}
        isPaused={false}
        isButtonDisabled={false}
        recordingState="processing"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );

    expect(screen.getByText("audio.processing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <MainRecordButton
        show={true}
        appliedVariant="mini"
        isRecording={false}
        isPaused={false}
        isButtonDisabled={false}
        recordingState="initializing"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );
    expect(screen.getByText("audio.initializing")).toBeInTheDocument();

    rerender(
      <MainRecordButton
        show={true}
        appliedVariant="standard"
        isRecording={true}
        isPaused={false}
        isButtonDisabled={false}
        recordingState="recording"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "audio.stopRecording" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <MainRecordButton
        show={true}
        appliedVariant="standard"
        isRecording={false}
        isPaused={false}
        isButtonDisabled={false}
        recordingState="idle"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );
    expect(screen.getByText("audio.newRecording")).toBeInTheDocument();

    rerender(
      <MainRecordButton
        show={true}
        appliedVariant="standard"
        isRecording={true}
        isPaused={true}
        isButtonDisabled={false}
        recordingState="paused"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );
    expect(screen.getByRole("button", { name: "audio.stopRecording" })).toBeInTheDocument();

    rerender(
      <MainRecordButton
        show={false}
        appliedVariant="standard"
        isRecording={false}
        isPaused={false}
        isButtonDisabled={false}
        recordingState="idle"
        onStart={onStart}
        onStop={onStop}
        t={t}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("covers mini recording action buttons", () => {
    const onStop = jest.fn();
    const onPause = jest.fn();
    const onResume = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(
      <RecordingActionButtons
        isRecording={true}
        isPaused={false}
        appliedVariant="mini"
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.stopRecording" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "audio.pauseRecording" }));
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "audio.cancelRecording" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <RecordingActionButtons
        isRecording={true}
        isPaused={true}
        appliedVariant="mini"
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.resumeRecording" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("covers standard recording action buttons and hidden state", () => {
    const onPause = jest.fn();
    const onResume = jest.fn();
    const onCancel = jest.fn();
    const { rerender, container } = render(
      <RecordingActionButtons
        isRecording={false}
        isPaused={false}
        appliedVariant="standard"
        onStop={jest.fn()}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(
      <RecordingActionButtons
        isRecording={true}
        isPaused={false}
        appliedVariant="standard"
        onStop={jest.fn()}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.pauseRecording" }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "audio.cancelRecording" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <RecordingActionButtons
        isRecording={true}
        isPaused={true}
        appliedVariant="standard"
        onStop={jest.fn()}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.resumeRecording" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("covers retry button visibility and click handling", () => {
    const onRetry = jest.fn();
    const { rerender, container } = render(
      <RetryTranscriptionButton
        show={false}
        onRetry={onRetry}
        appliedVariant="standard"
        retryCount={0}
        maxRetries={3}
        t={t}
      />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(
      <RetryTranscriptionButton
        show={true}
        onRetry={onRetry}
        appliedVariant="mini"
        retryCount={1}
        maxRetries={3}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.retryTranscription" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("audio.retryTranscription (2/3)")).toBeInTheDocument();
  });

  it("covers recording progress for mini and standard variants", () => {
    const { rerender, container } = render(
      <RecordingProgress
        isRecording={false}
        isPaused={false}
        appliedVariant="mini"
        formatTime={(value) => `0:0${value}`}
        recordingTime={1}
        maxDuration={5}
        progressPercentage={20}
      />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(
      <RecordingProgress
        isRecording={true}
        isPaused={true}
        appliedVariant="mini"
        formatTime={(value) => `0:0${value}`}
        recordingTime={2}
        maxDuration={5}
        progressPercentage={40}
      />
    );
    expect(screen.getByText("0:02")).toBeInTheDocument();
    expect(screen.getByText("0:05")).toBeInTheDocument();

    rerender(
      <RecordingProgress
        isRecording={true}
        isPaused={false}
        appliedVariant="mini"
        formatTime={(value) => `0:0${value}`}
        recordingTime={4}
        maxDuration={5}
        progressPercentage={80}
        isInGracePeriod={true}
        gracePeriodRemaining={2}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();

    rerender(
      <RecordingProgress
        isRecording={true}
        isPaused={true}
        appliedVariant="standard"
        formatTime={(value) => `0:0${value}`}
        recordingTime={3}
        maxDuration={5}
        progressPercentage={60}
      />
    );
    expect(container.textContent).toContain("⏸");
    expect(screen.getByText("0:03 / 0:05")).toBeInTheDocument();

    rerender(
      <RecordingProgress
        isRecording={true}
        isPaused={false}
        appliedVariant="standard"
        formatTime={(value) => `0:0${value}`}
        recordingTime={5}
        maxDuration={5}
        progressPercentage={100}
        isInGracePeriod={true}
        gracePeriodRemaining={1}
      />
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("covers error banner variants and dismiss action", () => {
    const onClose = jest.fn();
    const { rerender, container } = render(
      <ErrorBanner errorMessage={null} appliedVariant="standard" onClose={onClose} t={t} />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(<ErrorBanner errorMessage="boom" appliedVariant="mini" onClose={onClose} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "audio.closeError" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ErrorBanner errorMessage="boom" appliedVariant="standard" onClose={onClose} t={t} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("covers audio level visibility rules and rendering", () => {
    const { rerender, container } = render(
      <AudioLevelIndicator isRecording={false} isPaused={false} audioLevel={40} t={t} />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(<AudioLevelIndicator isRecording={true} isPaused={true} audioLevel={40} t={t} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<AudioLevelIndicator isRecording={true} isPaused={false} audioLevel={0} t={t} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<AudioLevelIndicator isRecording={true} isPaused={false} audioLevel={41.6} t={t} />);
    expect(screen.getByText("audio.audioLevel:")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("covers split record button click and disabled state", () => {
    const onStart = jest.fn();
    const { rerender } = render(
      <SplitRecordButton
        splitLeft={<div>left</div>}
        isButtonDisabled={false}
        onStart={onStart}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "audio.newRecording" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <SplitRecordButton
        splitLeft={<div>left</div>}
        isButtonDisabled={true}
        onStart={onStart}
        t={t}
      />
    );

    expect(screen.getByRole("button", { name: "audio.newRecording" })).toBeDisabled();
  });
});
