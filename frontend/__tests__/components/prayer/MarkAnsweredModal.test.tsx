import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'prayer.markAnswered.title': 'Mark as Answered',
        'prayer.markAnswered.subtitle': 'Record how God answered this prayer.',
        'prayer.markAnswered.placeholder': 'Share the answer',
        'prayer.markAnswered.skip': 'Skip',
        'prayer.markAnswered.submit': 'Save Answer',
      };

      return translations[key] || key;
    },
  }),
}));

describe('MarkAnsweredModal', () => {
  it('submits an empty answer through the skip action', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(<MarkAnsweredModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(undefined);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('submits the trimmed answer text and enters the saving state', async () => {
    const onClose = jest.fn();
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(<MarkAnsweredModal onClose={onClose} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: 'Save Answer' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Share the answer'), {
      target: { value: '  God provided  ' },
    });

    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Answer' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.click(enabledSubmitButton);

    expect(onSubmit).toHaveBeenCalledWith('God provided');
    expect(screen.getByRole('button', { name: '...' })).toBeDisabled();

    resolveSubmit?.();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
