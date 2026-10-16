import { act, fireEvent, render, screen } from '@testing-library/react';
import { AudioRecorder } from '@/components/AudioRecorder';
import { useAudioRecorderLifecycle } from '@/components/audio-recorder/useAudioRecorderLifecycle';

jest.mock('@/components/audio-recorder/useAudioRecorderLifecycle', () => ({ useAudioRecorderLifecycle: jest.fn() }));
jest.mock('@/components/audio-recorder/useResponsiveRecorderVariant', () => ({ useResponsiveRecorderVariant: () => 'standard' }));
jest.mock('@/components/audio-recorder/AudioRecorderControls', () => ({
  AudioRecoveryPanel: ({ onDiscard }: { onDiscard: () => void }) => <button onClick={onDiscard}>Discard source</button>,
  AudioLevelIndicator: () => null, ErrorBanner: () => null, MainRecordButton: () => null,
  RecordingActionButtons: () => null, RecordingProgress: () => null, SplitRecordButton: () => null,
}));

it('retains the in-session source until the durable discard is accepted', async () => {
  const clear = jest.fn();
  jest.mocked(useAudioRecorderLifecycle).mockReturnValue({ recordingTime: 0, recordingState: 'idle', hasStoredAudio: true,
    storedAudioUrl: 'blob:source', transcriptionErrorMessage: 'Keep this source', discardStoredAudio: clear,
  } as unknown as ReturnType<typeof useAudioRecorderLifecycle>);
  let accept!: () => void;
  const discard = jest.fn(() => new Promise<void>(resolve => { accept = resolve; }));
  render(<AudioRecorder onRecordingComplete={jest.fn()} onDiscardRecording={discard} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard source' }));
  expect(discard).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
  await act(async () => { accept(); });
  expect(clear).toHaveBeenCalledTimes(1);
});

it('does not clear a later take when an older discard finishes', async () => {
  const clear = jest.fn();
  const state = (url: string) => ({ recordingTime: 0, recordingState: 'idle', hasStoredAudio: true,
    storedAudioUrl: url, transcriptionErrorMessage: 'Keep source', discardStoredAudio: clear,
  } as unknown as ReturnType<typeof useAudioRecorderLifecycle>);
  jest.mocked(useAudioRecorderLifecycle).mockReturnValue(state('blob:first'));
  let accept!: () => void;
  const discard = jest.fn(() => new Promise<void>(resolve => { accept = resolve; }));
  const props = { onRecordingComplete: jest.fn(), onDiscardRecording: discard };
  const view = render(<AudioRecorder {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard source' }));
  jest.mocked(useAudioRecorderLifecycle).mockReturnValue(state('blob:later'));
  view.rerender(<AudioRecorder {...props} />);
  await act(async () => { accept(); });
  expect(clear).not.toHaveBeenCalled();
});
