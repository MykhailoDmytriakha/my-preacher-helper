import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import { persistedWrite } from '@/utils/recoverableWrite';
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
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };

      return translations[key] || key;
    },
  }),
}));

describe('MarkAnsweredModal', () => {
  it('submits an empty answer through the skip action', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.resolve()));

    render(<MarkAnsweredModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(undefined, undefined);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('submits the trimmed answer text and enters the saving state', async () => {
    const onClose = jest.fn();
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        persistedWrite(new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }))
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

    expect(onSubmit).toHaveBeenCalledWith('God provided', '  God provided  ');
    expect(screen.getByRole('button', { name: '...' })).toBeDisabled();

    resolveSubmit?.();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('stays open and preserves the typed answer when the write is refused', async () => {
    const refusal = Object.assign(new Error('Permission denied'), {
      code: 'permission-denied',
      name: 'FirebaseError',
    });
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(refusal)));

    render(<MarkAnsweredModal onClose={onClose} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Share the answer');
    fireEvent.change(textarea, { target: { value: 'God provided the exact answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Answer' }));

    // AWAITED first: the assertions used to run on the same tick as the click, before the
    // rejected promise reached `catch` — so they would have stayed green even if the catch
    // had started closing the editor and destroying the only visible copy of the text.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // The message belongs to the prayer recovery descriptor — one refusal, one reporter.
    // The editor's own duty is what follows: stay open, keep the answer as typed.
    expect(textarea).toHaveValue('God provided the exact answer');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('steps aside on a CONFLICT, because the choice lives on the page behind it', async () => {
    /**
     * A stale refusal is not a message but a CHOICE — "keep mine / take theirs" — and it
     * is offered by the page's conflict banner, which already carries this exact answer.
     * This modal is `fixed inset-0 z-50`: staying open buries that banner under an
     * overlay nothing can be clicked through, so Save looked like it did nothing at all.
     */
    const stale = Object.assign(new Error('Refused a stale write'), { isStaleWrite: true });
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(stale)));

    render(<MarkAnsweredModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share the answer'), {
      target: { value: 'God provided a job' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Answer' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
