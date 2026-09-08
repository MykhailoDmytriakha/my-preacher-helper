import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import CreateThoughtModal from '@/components/CreateThoughtModal';
import EditThoughtModal from '@/components/EditThoughtModal';
import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import { transcribeAudioWithRetry } from '@/utils/transcriptionRetryClient';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: () => ({ isOnline: true, isMagicAvailable: true }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea value={value} onChange={event => onChange(event.target.value)} />,
}));
jest.mock('@/utils/transcriptionRetryClient', () => ({
  ...jest.requireActual('@/utils/transcriptionRetryClient'), transcribeAudioWithRetry: jest.fn(),
}));
jest.mock('@/components/FocusRecorderButton', () => ({
  FocusRecorderButton: ({ onRecordingComplete, onRetry, onClearError, onError, isProcessing, transcriptionError, retryCount }: {
    onRecordingComplete: (blob: Blob) => void; onRetry: () => void; onClearError: () => void;
    onError: (message: string) => void;
    isProcessing: boolean; transcriptionError: string | null; retryCount: number;
  }) => <div>
    <button type="button" onClick={() => onRecordingComplete(new Blob(['original audio']))}>Record</button>
    <button type="button" onClick={onRetry}>Retry</button>
    <button type="button" onClick={onClearError}>Discard audio</button>
    <button type="button" onClick={() => onError('Microphone unavailable')}>Recorder error</button>
    <output data-testid="voice-state">{JSON.stringify({ isProcessing, transcriptionError, retryCount })}</output>
  </div>,
}));

const transcribe = jest.mocked(transcribeAudioWithRetry);
const variants = ['create', 'edit', 'prayer'] as const;
function renderVariant(kind: typeof variants[number]) {
  if (kind === 'create') return render(<CreateThoughtModal isOpen onClose={jest.fn()} onCreateThought={jest.fn()} />);
  if (kind === 'edit') return render(<EditThoughtModal initialText="" initialTags={[]} allowedTags={[]} onSave={jest.fn()} onClose={jest.fn()} />);
  return render(<AddUpdateModal onClose={jest.fn()} onSubmit={jest.fn()} />);
}
function voiceState() { return JSON.parse(screen.getByTestId('voice-state').textContent!); }
beforeEach(() => { transcribe.mockReset(); jest.mocked(toast.error).mockClear(); });

it('keeps prayer recorder errors inline without invoking transcription', () => {
  renderVariant('prayer');
  fireEvent.click(screen.getByRole('button', { name: 'Recorder error' }));
  expect(screen.getByText('Microphone unavailable')).toBeInTheDocument();
  expect(voiceState().isProcessing).toBe(false);
  expect(transcribe).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

describe.each(variants)('%s dictation contract', kind => {
  it('keeps failed audio, retries the same blob and appends to the draft edited during transcription', async () => {
    transcribe.mockRejectedValueOnce(new Error('Network unavailable'));
    renderVariant(kind);
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Before ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(voiceState().transcriptionError).toBe('Network unavailable'));
    expect(editor).toHaveValue('Before ');
    const originalBlob = transcribe.mock.calls[0][0];
    let resolve!: (value: { polishedText: string; originalText: string }) => void;
    transcribe.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(voiceState()).toEqual({ isProcessing: true, transcriptionError: null, retryCount: 1 });
    fireEvent.change(editor, { target: { value: 'Edited while waiting \n ' } });
    await act(async () => { resolve({ polishedText: '  Recognized text  ', originalText: 'Raw' }); });
    expect(transcribe).toHaveBeenLastCalledWith(originalBlob, { endpoint: '/api/thoughts/transcribe' });
    expect(editor).toHaveValue(`${kind === 'prayer' ? 'Edited while waiting' : 'Edited while waiting \n '}\n\nRecognized text`);
    expect(voiceState()).toEqual({ isProcessing: false, transcriptionError: null, retryCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('leaves the draft intact on empty recognition and uses the existing error presentation', async () => {
    transcribe.mockResolvedValueOnce({ polishedText: ' ', originalText: '' });
    renderVariant(kind);
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Do not lose this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(voiceState().isProcessing).toBe(false));
    expect(editor).toHaveValue('Do not lose this');
    expect(voiceState().transcriptionError).toBeNull();
    if (kind === 'prayer') {
      expect(screen.getByText('prayer.update.dictationEmpty')).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    } else expect(toast.error).toHaveBeenCalledWith('errors.audioProcessing');
  });
});
