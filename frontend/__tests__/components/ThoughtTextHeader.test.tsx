import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';

import { ThoughtTextHeader } from '@/components/thought/ThoughtTextHeader';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: ({ disabled, onError, onRetry, onClearError, title }: { disabled: boolean; onError: (message: string) => void; onRetry: () => void; onClearError: () => void; title?: string }) => <div>
  <button type="button" disabled={disabled} title={title} onClick={() => onError('Microphone failed')}>Record</button>
  <button type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onClearError}>Clear</button>
</div> }));
const dictation = () => ({ isProcessing: false, transcriptionBlocked: false, error: null, retryCount: 0, maxRetries: 3, complete: jest.fn(), retry: jest.fn(), clear: jest.fn(), stopProcessing: jest.fn() });

it('forwards retry/discard and reports recorder errors while ending its processing state', () => {
  const controller = dictation();
  render(<ThoughtTextHeader dictation={controller} available saving={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  expect(controller.retry).toHaveBeenCalledTimes(1);
  expect(controller.clear).toHaveBeenCalledTimes(1);
  expect(controller.stopProcessing).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Microphone failed');
});

it.each([{ available: false, saving: false }, { available: true, saving: true }, { available: true, saving: false, readOnly: true }])('blocks recording for unavailable or locked editors: %j', props => {
  render(<ThoughtTextHeader dictation={dictation()} {...props} />);
  expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
});

it('explains quota exhaustion and supports a plain custom field label without dictation', () => {
  const props = { dictation: { ...dictation(), transcriptionBlocked: true }, available: true, saving: false };
  const { rerender } = render(<ThoughtTextHeader {...props} />);
  expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('title', 'settings.usage.transcriptionUsageExhausted');
  rerender(<ThoughtTextHeader {...props} labelKey="custom.field" showDictation={false} />);
  expect(screen.getByText('custom.field')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
