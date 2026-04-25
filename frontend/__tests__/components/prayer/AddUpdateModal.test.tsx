import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import { transcribeThoughtAudio } from '@services/thought.service';
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

jest.mock('@services/thought.service', () => ({
  transcribeThoughtAudio: jest.fn(),
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
      };

      return translations[key] || key;
    },
  }),
}));

const mockTranscribeThoughtAudio = transcribeThoughtAudio as jest.MockedFunction<typeof transcribeThoughtAudio>;

describe('AddUpdateModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits trimmed text and closes after success', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

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
      expect(onSubmit).toHaveBeenCalledWith('We prayed together');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows submit errors and still allows manual cancel', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: 'Update text' },
    });
    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Update' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.submit(enabledSubmitButton.closest('form') as HTMLFormElement);

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('appends dictated text before submitting an update', async () => {
    mockTranscribeThoughtAudio.mockResolvedValue({
      polishedText: 'Voice update from prayer meeting',
      originalText: 'voice update from prayer meeting',
    });
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: 'Manual note ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));

    await waitFor(() => {
      expect(mockTranscribeThoughtAudio).toHaveBeenCalledWith(expect.any(Blob));
      expect(screen.getByPlaceholderText('Share an update')).toHaveValue(
        'Manual note\n\nVoice update from prayer meeting'
      );
    });

    fireEvent.submit(screen.getByRole('button', { name: 'Save Update' }).closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Manual note\n\nVoice update from prayer meeting');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
