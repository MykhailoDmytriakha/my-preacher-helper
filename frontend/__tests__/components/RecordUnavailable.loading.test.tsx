import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RecordUnavailable } from '@/components/RecordUnavailable';
import { UNKNOWN_RECORD_PRESENCE } from '@/data-engine/recordPresence';

jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const snapshot = { resource: { collection: 'groups', id: 'one' }, value: null, metadata: null };

it('shows an unanswered first read without claiming the record is unavailable', () => {
  const view = render(<RecordUnavailable presence={UNKNOWN_RECORD_PRESENCE} checking pageLoading onBack={jest.fn()} onRetry={jest.fn()} />);
  expect(screen.getByText('recordAvailability.checking')).toBeVisible();
  expect(screen.queryByText('recordAvailability.notHereYet')).not.toBeInTheDocument();
  expect(screen.queryByText('recordAvailability.checkConnection')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
  expect(view.container.querySelector('[data-page-loading]')).not.toBeNull();
});

it('keeps retained words readable while the first read is still unanswered', () => {
  const view = render(<RecordUnavailable presence={UNKNOWN_RECORD_PRESENCE} checking onBack={jest.fn()} onRetry={jest.fn()}>
    <p>My saved preparation.</p>
  </RecordUnavailable>);
  expect(screen.getByText('My saved preparation.')).toBeVisible();
  expect(screen.queryByText('recordAvailability.notHereYet')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-page-loading]')).toBeNull();
});

it.each(['absent', 'deleting'] as const)('preserves a proven %s verdict during a recheck', kind => {
  const presence = kind === 'absent' ? { kind, source: 'server' as const, snapshot } : { kind, source: 'local' as const, snapshot };
  render(<RecordUnavailable presence={presence} checking onBack={jest.fn()} onRetry={jest.fn()}>
    <p>A copy remains readable.</p>
  </RecordUnavailable>);
  expect(screen.getByText(`recordAvailability.${kind === 'absent' ? 'notFound' : 'deleting'}`)).toBeVisible();
  expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeEnabled();
  expect(screen.getByText('A copy remains readable.')).toBeVisible();
});

it('keeps retry and back usable after an unanswered read has settled', async () => {
  const retry = jest.fn().mockResolvedValue(undefined), back = jest.fn();
  render(<RecordUnavailable presence={UNKNOWN_RECORD_PRESENCE} onBack={back} onRetry={retry} />);
  expect(screen.getByText('recordAvailability.notHereYet')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
  expect(back).toHaveBeenCalledTimes(1);
});

it('moves from waiting to a settled unknown answer and then confirmed absence', () => {
  const props = { onBack: jest.fn(), onRetry: jest.fn() };
  const view = render(<RecordUnavailable {...props} presence={UNKNOWN_RECORD_PRESENCE} checking pageLoading />);
  expect(screen.queryByText('recordAvailability.notHereYet')).not.toBeInTheDocument();
  view.rerender(<RecordUnavailable {...props} presence={UNKNOWN_RECORD_PRESENCE} />);
  expect(screen.getByText('recordAvailability.notHereYet')).toBeVisible();
  view.rerender(<RecordUnavailable {...props} presence={{ kind: 'absent', source: 'server', snapshot }} />);
  expect(screen.getByText('recordAvailability.notFound')).toBeVisible();
  expect(view.container.querySelector('[data-page-loading]')).toBeNull();
});
