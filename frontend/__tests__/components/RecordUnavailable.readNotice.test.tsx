import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RecordUnavailable } from '@/components/RecordUnavailable';
import { DataSyncStatus, STATUS_SETTLE_MS } from '@/data-engine/DataSyncStatus';
import { UNKNOWN_RECORD_PRESENCE } from '@/data-engine/recordPresence';
import { failureWords, refusalWords } from '@/utils/actionFailureMessage';

import type { ReactNode } from 'react';
import type { FailureWords } from '@/utils/actionFailureMessage';
import type { SyncStatus } from '@/data-engine/status';

jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const saved: SyncStatus = { phase: 'saved', freshness: 'cache', checking: false, readFailed: true,
  hasForeignChange: false, canSave: false, canRemove: false, canAcceptRemote: false, canKeepLocal: false };
const readFailure = (code?: string) => failureWords(Object.assign(new Error('No document read'), code ? { code } : {}), 'dataSync.readFailed');
function panel(words: FailureWords, status: SyncStatus | null = saved) {
  return <DataSyncStatus subject="record" status={status} error="dataSync.readFailed" errorWords={words} onRetry={jest.fn()} />;
}
function unavailable(children: ReactNode, checking = false, words?: FailureWords) {
  return <RecordUnavailable readNotice={{ subject: 'record', words }} presence={UNKNOWN_RECORD_PRESENCE} checking={checking} onBack={jest.fn()} onRetry={jest.fn()}>{children}</RecordUnavailable>;
}
function settle() { act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS + 1); }); }
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it.each([undefined, 'unavailable', 'deadline-exceeded'])('shows one summary and retry for the claimed read: %s', code => {
  const words = readFailure(code);
  render(unavailable(panel(words), false, words)); settle();
  expect(screen.getByText('recordAvailability.notHereYet')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('dataSync.readFailed')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(1);
});

it('claims a read with no editor status as well', () => {
  const words = readFailure();
  render(unavailable(panel(words, null), false, words)); settle();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(1);
});

it('keeps a standalone read failure and its retry visible', () => {
  render(panel(readFailure())); settle();
  expect(screen.getByRole('alert')).toHaveTextContent('dataSync.readFailed');
  expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeEnabled();
});

it('does not claim a read before the summary has appeared', () => {
  render(unavailable(panel(readFailure()), true)); settle();
  expect(screen.getByText('recordAvailability.checking')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('dataSync.readFailed');
  expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeEnabled();
});

it('keeps a device-storage refusal even when it was discovered during a read', () => {
  const words = failureWords(Object.assign(new Error('Device storage refused'), { code: 'storage-silent' }), 'dataSync.readFailed');
  render(unavailable(panel(words))); settle();
  expect(screen.getByRole('alert')).toHaveTextContent('dataSync.readOnly.storage');
});

it('keeps a real save refusal, its retry and retained words', () => {
  const words = refusalWords(new Error('My draft could not be saved'), 'dataSync.actionFailed');
  render(unavailable(<><p>My retained paragraph</p>{panel(words, { ...saved, phase: 'localFailure' })}</>)); settle();
  expect(screen.getByRole('alert')).toHaveTextContent('My draft could not be saved');
  expect(screen.getByText('My retained paragraph')).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(2);
});

it('keeps an action refused by the server instead of treating it as a read', () => {
  const words = refusalWords(Object.assign(new Error('Server refused save'), { code: 'unavailable' }), 'dataSync.actionFailed');
  render(unavailable(panel(words, { ...saved, phase: 'refused' }))); settle();
  expect(screen.getByRole('alert')).toHaveTextContent('dataSync.failure.serverUnavailable');
  expect(screen.getByText('dataSync.phase.refused')).toBeVisible();
});

it('keeps recovery choices, recovery failures and a newly refused recovery action', async () => {
  const recover = jest.fn(async () => { throw new Error('Retained draft recovery refused'); });
  const words = readFailure();
  render(unavailable(<DataSyncStatus subject="record" title="Retained draft" status={saved}
    error="dataSync.readFailed" errorWords={words} onRetry={jest.fn()}
    recoveryChoices={[{ id: 'draft-one', title: 'My unfinished words' }]} onRecover={recover} recoveryError="Recovery storage failed" />, false, words));
  settle();
  const region = within(screen.getByRole('region', { name: 'Retained draft' }));
  expect(region.getByText('Recovery storage failed')).toBeVisible();
  fireEvent.change(region.getByRole('combobox'), { target: { value: 'draft-one' } });
  await act(async () => { fireEvent.click(region.getByRole('button', { name: 'dataSync.recover' })); });
  expect(recover).toHaveBeenCalledWith('draft-one');
  expect(region.getByText('Retained draft recovery refused')).toBeVisible();
});

it('keeps an unclassified raw error instead of guessing that it was a read', () => {
  render(unavailable(<DataSyncStatus subject="unknown" status={null} error="Unclassified failure" onRetry={jest.fn()} />));
  expect(screen.getByRole('alert')).toHaveTextContent('Unclassified failure');
});

it('does not classify an empty action refusal as a redundant read', () => {
  render(unavailable(panel(refusalWords(new Error(''), 'dataSync.actionFailed'), { ...saved, phase: 'localFailure' }))); settle();
  expect(screen.getByRole('alert')).toHaveTextContent('dataSync.actionFailed');
});

it('keeps a distinct secondary read under the same unavailable record', () => {
  const primary = readFailure(), secondary = readFailure();
  render(unavailable(<>{panel(primary)}<DataSyncStatus subject="metadata" title="Metadata read" status={saved}
    error="Secondary read failed" errorWords={secondary} onRetry={jest.fn()} /></>, false, primary));
  settle();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(within(screen.getByRole('region', { name: 'Metadata read' })).getByRole('alert')).toHaveTextContent('dataSync.readFailed');
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(2);
});

it('claims inherited primary read words even when a manual form owns the displayed status', () => {
  const words = readFailure();
  render(unavailable(<DataSyncStatus subject="manual-form" status={saved} error="dataSync.readFailed"
    errorWords={words} onRetry={jest.fn()} />, false, words)); settle();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(1);
});

it('claims a separately failed form explicitly owned by the same record', () => {
  const primary = readFailure(), form = readFailure();
  render(<RecordUnavailable presence={UNKNOWN_RECORD_PRESENCE} onBack={jest.fn()} onRetry={jest.fn()}
    readNotice={{ subject: 'record', relatedSubjects: ['meeting-form'], words: primary }}>
    <DataSyncStatus subject="meeting-form" status={saved} error="dataSync.readFailed" errorWords={form} onRetry={jest.fn()} />
  </RecordUnavailable>); settle();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(1);
});

it.each(['action', 'storage'] as const)('keeps a related form %s refusal visible', kind => {
  const words = kind === 'action' ? refusalWords(new Error('Form words not saved'), 'dataSync.actionFailed')
    : failureWords(Object.assign(new Error('Device storage refused'), { code: 'storage-silent' }), 'dataSync.readFailed');
  render(<RecordUnavailable presence={UNKNOWN_RECORD_PRESENCE} onBack={jest.fn()} onRetry={jest.fn()}
    readNotice={{ subject: 'record', relatedSubjects: ['meeting-form'], words: readFailure() }}>
    <DataSyncStatus subject="meeting-form" status={{ ...saved, phase: 'localFailure' }} error="Form failure" errorWords={words} onRetry={jest.fn()} />
  </RecordUnavailable>); settle();
  expect(screen.getByRole('alert')).toHaveTextContent(kind === 'action' ? 'Form words not saved' : 'dataSync.readOnly.storage');
  expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(2);
});
