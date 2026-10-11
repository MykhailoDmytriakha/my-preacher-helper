import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';

import { ThoughtTextHeader } from '@/components/thought/ThoughtTextHeader';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: ({ disabled, onError, onRetry, onClearError, title }: { disabled: boolean; onError: (words: { key: string }) => void; onRetry: () => void; onClearError: () => void; title?: string }) => <div>
  <button type="button" disabled={disabled} title={title} onClick={() => onError({ key: 'errors.microphoneUnavailable' })}>Record</button>
  <button type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onClearError}>Clear</button>
</div> }));
const dictation = () => ({ isProcessing: false, transcriptionBlocked: false,
  blockedLabelKey: null, error: null, retryCount: 0, maxRetries: 3, complete: jest.fn(), retry: jest.fn(), clear: jest.fn(), stopProcessing: jest.fn() });

it('forwards retry/discard and reports recorder errors while ending its processing state', () => {
  const controller = dictation();
  render(<ThoughtTextHeader dictation={controller} saving={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  expect(controller.retry).toHaveBeenCalledTimes(1);
  expect(controller.clear).toHaveBeenCalledTimes(1);
  expect(controller.stopProcessing).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('errors.microphoneUnavailable');
});

it.each([{ saving: true }, { saving: false, readOnly: true }])('blocks recording for a saving or locked editor: %j', props => {
  render(<ThoughtTextHeader dictation={dictation()} {...props} />);
  expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
});

/**
 * The words name the allowance that actually ran out. Dictation spends transcription AND ai,
 * so the header cannot assume which one stopped it — the hook resolves that and hands over the key.
 */
it('explains quota exhaustion and supports a plain custom field label without dictation', () => {
  const props = {
    dictation: {
      ...dictation(),
      transcriptionBlocked: true,
      blockedLabelKey: 'settings.usage.transcriptionUsageExhausted',
    },
    available: true,
    saving: false,
  };
  const { rerender } = render(<ThoughtTextHeader {...props} />);
  expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('title', 'settings.usage.transcriptionUsageExhausted');
  rerender(<ThoughtTextHeader {...props} labelKey="custom.field" showDictation={false} />);
  expect(screen.getByText('custom.field')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps dictation available when the connection icon says there is none — pressing it sends the recording', () => {
  // Owner's decision 2026-10-10: AI buttons are not disabled by the icon; a failed send says so.
  render(<ThoughtTextHeader dictation={dictation()} saving={false} />);
  expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
});
