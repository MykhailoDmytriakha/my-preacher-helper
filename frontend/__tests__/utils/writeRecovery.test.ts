import {
  recoveryText,
  showRecoverableWriteFailure,
  writeFailureTranslationKey,
} from '@/utils/writeRecovery';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';

const mockToastError = jest.fn();

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

describe('writeRecovery', () => {
  it('carries the person\'s text and a copy action in the recovery message', () => {
    showRecoverableWriteFailure({
      error: Object.assign(new Error('denied'), { code: 'permission-denied' }),
      title: 'Save refused',
      description: 'The words the person actually typed',
      retryLabel: 'Retry',
      retry: jest.fn(),
      copyLabel: 'Copy my text',
      id: 'late-refusal',
    });

    const [title, options] = mockToastError.mock.calls.at(-1) as [
      string,
      { description: string; action?: { label: string } },
    ];
    expect(title).toBe('Save refused');
    // The text has to travel with the message: it is the only copy left.
    expect(options.description).toBe('The words the person actually typed');
    expect(options.action?.label).toBe('Copy my text');
  });

  it('classifies a rules refusal without guessing that an unknown failure was refused', () => {
    const refusal = Object.assign(new Error('denied'), { code: 'firestore/permission-denied' });

    expect(writeFailureTranslationKey(refusal, 'common.saveError')).toBe('writeRecovery.refused');
    expect(writeFailureTranslationKey(new StaleWriteError('meta', 1, 2), 'common.saveError')).toBe(
      'writeRecovery.refused'
    );
    expect(writeFailureTranslationKey(new Error('unknown'), 'common.saveError')).toBe('common.saveError');
  });

  it('offers copy instead of retry for a stale conflict, while a transient failure still retries', () => {
    const retry = jest.fn();

    showRecoverableWriteFailure({
      error: new StaleWriteError('study-note', 3, 4),
      title: 'Write refused',
      description: 'Exact draft text',
      retryLabel: 'Retry',
      retry,
      copyLabel: 'Copy my text',
      id: 'stale-write',
    });

    const [, staleOptions] = mockToastError.mock.calls[0] as [
      string,
      { action?: { label: string; onClick: () => void } },
    ];
    expect(staleOptions.action?.label).toBe('Copy my text');
    expect(staleOptions.action?.label).not.toBe('Retry');
    staleOptions.action?.onClick();
    expect(retry).not.toHaveBeenCalled();

    mockToastError.mockClear();
    showRecoverableWriteFailure({
      error: new Error('temporary network failure'),
      title: 'Write failed',
      description: 'Exact draft text',
      retryLabel: 'Retry',
      retry,
      copyLabel: 'Copy my text',
      id: 'transient-write',
    });

    const [, transientOptions] = mockToastError.mock.calls[0] as [
      string,
      { action?: { label: string; onClick: () => void } },
    ];
    expect(transientOptions.action?.label).toBe('Retry');
    expect(transientOptions.action?.label).not.toBe('Copy my text');
    transientOptions.action?.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps every non-empty human field in the exact recovery text', () => {
    expect(recoveryText(['Exact title', '', undefined, 'Exact body'])).toBe(
      'Exact title\nExact body'
    );
  });

});
