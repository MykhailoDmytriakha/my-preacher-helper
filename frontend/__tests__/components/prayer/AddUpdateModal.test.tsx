import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import { persistedWrite } from '@/utils/recoverableWrite';
import { transcribeAudioWithRetry } from '@/utils/transcriptionRetryClient';
import '@testing-library/jest-dom';

jest.mock('@components/FocusRecorderButton', () => ({
  FocusRecorderButton: ({ disabled, isProcessing, onRecordingComplete }: any) => (
    <button
      type="button"
      aria-label="Record voice"
      disabled={disabled || isProcessing}
      onClick={() => onRecordingComplete(new Blob(['audio'], { type: 'audio/webm' }))}
    >
      Record voice
    </button>
  ),
}));

jest.mock('@/utils/transcriptionRetryClient', () => {
  const actual = jest.requireActual('@/utils/transcriptionRetryClient');
  return {
    ...actual,
    transcribeAudioWithRetry: jest.fn(),
  };
});

jest.mock('@/utils/recordingDraftStore', () => ({
  saveRecordingDraft: jest.fn().mockResolvedValue('draft-1'),
  deleteRecordingDraft: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'buttons.close': 'Close',
        'prayer.update.title': 'Add Update',
        'prayer.update.placeholder': 'Share an update',
        'prayer.update.cancel': 'Cancel',
        'prayer.update.submit': 'Save Update',
        'prayer.update.saving': 'Saving update',
        'prayer.update.dictate': 'Dictate',
        'prayer.update.dictationEmpty': 'No speech',
        'prayer.update.dictationError': 'Dictation failed',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };

      return translations[key] || key;
    },
  }),
}));

const mockTranscribeAudioWithRetry = transcribeAudioWithRetry as jest.MockedFunction<typeof transcribeAudioWithRetry>;

describe('AddUpdateModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits trimmed text and closes after success', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.resolve()));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: 'Save Update' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: '  We prayed together  ' },
    });
    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Update' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.submit(enabledSubmitButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('We prayed together', '  We prayed together  ');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves the failure to the recovery descriptor and stays usable', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(new Error('Save failed'))));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: 'Update text' },
    });
    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Update' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.submit(enabledSubmitButton.closest('form') as HTMLFormElement);

    // The descriptor in usePrayerRequests reports this write's failure, with the text and
    // a retry. The modal repeating it — in raw technical wording — made one failed save
    // arrive as two messages. Its duty is to stay open, hold the update, stay usable.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Share an update')).toHaveValue('Update text');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact update in the textarea when the write is refused', async () => {
    const refusal = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(refusal)));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Share an update');
    fireEvent.change(textarea, { target: { value: 'Господь ответил в среду' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Update' }).closest('form') as HTMLFormElement);
    // The message belongs to this entity's recovery descriptor — one refusal, one
    // reporter. The editor's duty, checked below, is to stay open with the text intact.
    expect(textarea).toHaveValue('Господь ответил в среду');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('appends dictated text before submitting an update', async () => {
    mockTranscribeAudioWithRetry.mockResolvedValue({
      polishedText: 'Voice update from prayer meeting',
      originalText: 'voice update from prayer meeting',
    });
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.resolve()));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: 'Manual note ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));

    await waitFor(() => {
      expect(mockTranscribeAudioWithRetry).toHaveBeenCalledWith(expect.any(Blob), {
        endpoint: '/api/thoughts/transcribe',
      });
      expect(screen.getByPlaceholderText('Share an update')).toHaveValue(
        'Manual note\n\nVoice update from prayer meeting'
      );
    });

    fireEvent.submit(screen.getByRole('button', { name: 'Save Update' }).closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'Manual note\n\nVoice update from prayer meeting',
        'Manual note\n\nVoice update from prayer meeting'
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
