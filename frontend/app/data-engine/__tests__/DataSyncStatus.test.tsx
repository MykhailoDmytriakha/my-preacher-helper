import { act, fireEvent, render, screen } from '@testing-library/react';

import en from '../../../locales/en/translation.json';
import ru from '../../../locales/ru/translation.json';
import uk from '../../../locales/uk/translation.json';
import { DataSyncStatus } from '../DataSyncStatus';

import type { SyncPhase, SyncStatus } from '../status';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const dictionary = jest.requireActual('../../../locales/en/translation.json');
  return key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key;
} }) }));
const status = (phase: SyncPhase, extras: Partial<SyncStatus> = {}): SyncStatus => ({ phase, freshness: 'server', checking: false, readFailed: false, hasForeignChange: false, canSave: false, canRemove: false, canAcceptRemote: false, canKeepLocal: false, ...extras });
const deferred = () => { let resolve!: () => void; let reject!: (reason: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe('DataSyncStatus', () => {
  it.each(Object.keys(en.dataSync.phase) as SyncPhase[])('renders the canonical %s phase with translated copy', phase => {
    render(<DataSyncStatus status={status(phase)} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.phase[phase]);
    for (const locale of [en, ru, uk]) expect(locale.dataSync.phase[phase]).toBeTruthy();
  });

  it('never offers discard or overwrite actions for an unknown pending command or a deleted resource', () => {
    const keep = jest.fn(), accept = jest.fn(), retry = jest.fn();
    const { rerender } = render(<DataSyncStatus status={status('unknown')} onKeepLocal={keep} onAcceptRemote={accept} onRetry={retry} />);
    expect(screen.queryByText(en.dataSync.keepLocal)).not.toBeInTheDocument();
    expect(screen.queryByText(en.dataSync.acceptRemote)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeEnabled();
    rerender(<DataSyncStatus status={status('deleted', { canAcceptRemote: true })} onKeepLocal={keep} onAcceptRemote={accept} />);
    expect(screen.queryByText(en.dataSync.keepLocal)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.dataSync.acceptRemote })).toBeEnabled();
    expect(keep).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled();
  });

  it('reuses the conflict banner when both explicit resolutions are allowed and prevents duplicate actions', async () => {
    const waiting = deferred(), keep = jest.fn(() => waiting.promise), accept = jest.fn();
    render(<DataSyncStatus status={status('conflict', { canKeepLocal: true, canAcceptRemote: true })} onKeepLocal={keep} onAcceptRemote={accept} />);
    expect(screen.getByRole('alert')).toHaveTextContent(en.freshness.conflictTitle);
    const button = screen.getByRole('button', { name: en.freshness.conflictKeepMine });
    fireEvent.click(button); fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(keep).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    await act(async () => waiting.resolve());
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictTakeTheirs }));
    await act(async () => { await Promise.resolve(); }); expect(accept).toHaveBeenCalledTimes(1);
  });

  it('keeps refusal correction and remote acceptance separate from conflict detection', async () => {
    const keep = jest.fn(), accept = jest.fn();
    const { rerender } = render(<DataSyncStatus status={status('refused', { canKeepLocal: true })} onKeepLocal={keep} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.keepLocal }));
    await act(async () => { await Promise.resolve(); }); expect(keep).toHaveBeenCalledTimes(1);
    rerender(<DataSyncStatus status={status('remoteChanged', { canAcceptRemote: true })} onAcceptRemote={accept} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.acceptRemote }));
    await act(async () => { await Promise.resolve(); }); expect(accept).toHaveBeenCalledTimes(1);
  });

  it('reports local storage and read failures, and surfaces a failed retry without claiming a save', async () => {
    const retry = jest.fn().mockRejectedValue(new Error('Storage full'));
    render(<DataSyncStatus status={status('localFailure', { freshness: 'cache', checking: true, readFailed: true })} error="Draft not durable" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Draft not durable');
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.freshness.cache);
    expect(screen.getByText(en.dataSync.checking)).toBeInTheDocument(); expect(screen.getByText(en.dataSync.readFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry }));
    await act(async () => { await Promise.resolve(); }); expect(retry).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit human-labeled recovery choice and never automatically discovers or selects a draft', async () => {
    const discover = jest.fn(), recover = jest.fn();
    const choices = [{ id: 'first', title: 'Yesterday’s sermon', preview: 'A recognizable opening' }, { id: 'second', title: 'This morning’s draft' }];
    const { rerender } = render(<DataSyncStatus status={status('draft')} recoveryChoices={choices} onListRecovery={discover} onRecover={recover} />);
    expect(discover).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: en.dataSync.recover }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.findRecovery }));
    await act(async () => { await Promise.resolve(); }); expect(discover).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(en.dataSync.recoveryLabel), { target: { value: 'first' } });
    expect(screen.getByText('A recognizable opening')).toBeInTheDocument();
    fireEvent.click(button); await act(async () => { await Promise.resolve(); }); expect(recover).toHaveBeenCalledWith('first');
    rerender(<DataSyncStatus status={status('draft')} recoveryChoices={[choices[1]]} onRecover={recover} recoveryLoading recoveryError="Could not read another draft" />);
    expect(screen.getByRole('button', { name: en.dataSync.recover })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read another draft');
  });

  it('reports action errors, ignores late errors after callback replacement, and renders nothing without information', async () => {
    const { container, rerender, unmount } = render(<DataSyncStatus status={null} />); expect(container).toBeEmptyDOMElement();
    const old = deferred(), retry = jest.fn(() => old.promise);
    rerender(<DataSyncStatus status={status('unknown', { freshness: 'unknown' })} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry })); await act(async () => { await Promise.resolve(); });
    const fresh = jest.fn().mockRejectedValue(undefined);
    rerender(<DataSyncStatus status={status('unknown')} onRetry={fresh} />);
    await act(async () => old.reject(new Error('Old account failure'))); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry })); await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.actionFailed);
    unmount();
  });
});
