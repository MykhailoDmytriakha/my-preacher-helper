import { act, fireEvent, render, screen } from '@testing-library/react';

import en from '../../../locales/en/translation.json';
import ru from '../../../locales/ru/translation.json';
import uk from '../../../locales/uk/translation.json';
import { DataSyncStatus, STATUS_SETTLE_MS } from '../DataSyncStatus';
import { isSyncTrouble } from '../status';
import { diagnosticEvents } from '@/utils/appDiagnostics';

import type { SyncPhase, SyncStatus } from '../status';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const dictionary = jest.requireActual('../../../locales/en/translation.json');
  return key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key;
} }) }));
const status = (phase: SyncPhase, extras: Partial<SyncStatus> = {}): SyncStatus => ({ phase, freshness: 'server', checking: false, readFailed: false, hasForeignChange: false, canSave: false, canRemove: false, canAcceptRemote: false, canKeepLocal: false, ...extras });
const deferred = () => { let resolve!: () => void; let reject!: (reason: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe('DataSyncStatus', () => {
  it('makes earlier unfinished drafts visible beside an otherwise saved document', () => {
    render(<DataSyncStatus subject="doc" status={status('saved')} recoveryChoices={[{ id: 'earlier', title: 'Unfinished draft' }]} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.unfinishedWork);
    expect(screen.queryByText(en.dataSync.phase.saved)).not.toBeInTheDocument();
  });
  const phases = Object.keys(en.dataSync.phase) as SyncPhase[];
  it.each(phases.filter(isSyncTrouble))('renders the trouble phase %s with translated copy', phase => {
    render(<DataSyncStatus subject="doc" status={status(phase)} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.phase[phase]);
    for (const locale of [en, ru, uk]) expect(locale.dataSync.phase[phase]).toBeTruthy();
  });
  /*
   * WHEN EVERYTHING GOES AS EXPECTED, NOTHING IS SHOWN (owner, 2026-09-29): "Saved." sat above every
   * engine screen and the line came and went with each keystroke, moving the page.
   */
  it.each(phases.filter(phase => !isSyncTrouble(phase)))('says nothing in the ordinary %s phase', phase => {
    const { container } = render(<DataSyncStatus subject="doc" status={status(phase)} onRetry={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never offers discard or overwrite actions for an unknown pending command or a deleted resource', () => {
    const keep = jest.fn(), accept = jest.fn(), retry = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="doc" status={status('unknown')} onKeepLocal={keep} onAcceptRemote={accept} onRetry={retry} />);
    expect(screen.queryByText(en.dataSync.keepLocal)).not.toBeInTheDocument();
    expect(screen.queryByText(en.dataSync.acceptRemote)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeEnabled();
    rerender(<DataSyncStatus subject="doc" status={status('deleted', { canAcceptRemote: true })} onKeepLocal={keep} onAcceptRemote={accept} />);
    expect(screen.queryByText(en.dataSync.keepLocal)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.dataSync.acceptRemote })).toBeEnabled();
    expect(keep).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled();
  });

  it('reuses the conflict banner when both explicit resolutions are allowed and prevents duplicate actions', async () => {
    const waiting = deferred(), keep = jest.fn(() => waiting.promise), accept = jest.fn();
    render(<DataSyncStatus subject="doc" status={status('conflict', { canKeepLocal: true, canAcceptRemote: true })} onKeepLocal={keep} onAcceptRemote={accept} />);
    expect(screen.getByRole('alert')).toHaveTextContent(en.freshness.conflictTitle);
    const button = screen.getByRole('button', { name: en.freshness.conflictKeepMine });
    fireEvent.click(button); fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(keep).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    await act(async () => waiting.resolve());
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictTakeTheirs }));
    await act(async () => { await Promise.resolve(); }); expect(accept).toHaveBeenCalledTimes(1);
  });

  it('does the action that was clicked even when the screen re-renders before it starts', async () => {
    // Screens pass fresh callbacks on every render. A re-render between the click and the start
    // of the action (the engine still reporting while the person clicks) used to drop the click.
    const conflict = status('conflict', { canKeepLocal: true, canAcceptRemote: true });
    const keep = jest.fn(), accept = jest.fn(), keepNext = jest.fn(), acceptNext = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="doc" status={conflict} onKeepLocal={keep} onAcceptRemote={accept} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
      rerender(<DataSyncStatus subject="doc" status={conflict} onKeepLocal={keepNext} onAcceptRemote={acceptNext} />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(keep).toHaveBeenCalledTimes(1); expect(keepNext).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictTakeTheirs }));
      rerender(<DataSyncStatus subject="doc" status={conflict} onKeepLocal={keep} onAcceptRemote={accept} />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(acceptNext).toHaveBeenCalledTimes(1); expect(accept).not.toHaveBeenCalled();
  });

  /** BUG-20261003-sync-actions-unlock-on-rerender: the lock belongs to the subject, not to the callbacks. */
  it('keeps every action locked while one runs, even when the screen passes fresh callbacks', async () => {
    const conflict = status('conflict', { canKeepLocal: true, canAcceptRemote: true });
    const waiting = deferred(), keep = jest.fn(() => waiting.promise), acceptNext = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="sermon-1" status={conflict} onKeepLocal={keep} onAcceptRemote={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    rerender(<DataSyncStatus subject="sermon-1" status={conflict} onKeepLocal={jest.fn()} onAcceptRemote={acceptNext} />);
    const theirs = screen.getByRole('button', { name: en.freshness.conflictTakeTheirs });
    expect(theirs).toBeDisabled();
    fireEvent.click(theirs); await act(async () => { await Promise.resolve(); });
    expect(acceptNext).not.toHaveBeenCalled();
    await act(async () => waiting.resolve());
    expect(theirs).toBeEnabled();
    fireEvent.click(theirs); await act(async () => { await Promise.resolve(); });
    expect(acceptNext).toHaveBeenCalledTimes(1);
  });

  it('frees the actions of another subject at once, whatever still hangs for the previous one', async () => {
    const conflict = status('conflict', { canKeepLocal: true, canAcceptRemote: true });
    const hanging = deferred(), acceptOther = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="sermon-1" status={conflict} onKeepLocal={() => hanging.promise} onAcceptRemote={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    rerender(<DataSyncStatus subject="sermon-2" status={conflict} onKeepLocal={jest.fn()} onAcceptRemote={acceptOther} />);
    const theirs = screen.getByRole('button', { name: en.freshness.conflictTakeTheirs });
    expect(theirs).toBeEnabled();
    fireEvent.click(theirs); await act(async () => { await Promise.resolve(); });
    expect(acceptOther).toHaveBeenCalledTimes(1);
    // The previous subject's late failure is not this one's.
    await act(async () => hanging.reject(new Error('Old sermon failure')));
    expect(screen.queryByRole('alert', { name: /Old sermon/ })).not.toBeInTheDocument();
    expect(screen.queryByText(en.dataSync.actionFailed)).not.toBeInTheDocument();
  });

  it('keeps a subject locked when the block comes back to it while its action still runs', async () => {
    const conflict = status('conflict', { canKeepLocal: true, canAcceptRemote: true });
    const hanging = deferred(), accept = jest.fn();
    const view = (subject: string) => <DataSyncStatus subject={subject} status={conflict} onKeepLocal={() => hanging.promise} onAcceptRemote={accept} />;
    const { rerender } = render(view('sermon-1'));
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    rerender(view('sermon-2'));
    rerender(view('sermon-1'));
    expect(screen.getByRole('button', { name: en.freshness.conflictTakeTheirs })).toBeDisabled();
    await act(async () => hanging.resolve());
    expect(screen.getByRole('button', { name: en.freshness.conflictTakeTheirs })).toBeEnabled();
  });

  /** BUG-20261003-date-form-accepts-impossible-day: "keep mine" sends the form, so the form's checks come first. */
  it('keeps mine only when the surrounding form passes its own checks', async () => {
    const conflict = status('conflict', { canKeepLocal: true, canAcceptRemote: true });
    const keep = jest.fn();
    const Form = ({ noValidate = false, valid }: { noValidate?: boolean; valid: boolean }) => <form noValidate={noValidate}>
      <input aria-label="date" ref={input => input?.setCustomValidity(valid ? '' : 'There is no such day in the calendar')} />
      <DataSyncStatus subject="doc" status={conflict} onKeepLocal={keep} onAcceptRemote={jest.fn()} />
    </form>;
    const { rerender } = render(<Form valid={false} />);
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    expect(keep).not.toHaveBeenCalled();
    rerender(<Form valid />);
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    expect(keep).toHaveBeenCalledTimes(1);
    // A form that checks itself is left to its own checks.
    rerender(<Form noValidate valid={false} />);
    fireEvent.click(screen.getByRole('button', { name: en.freshness.conflictKeepMine }));
    await act(async () => { await Promise.resolve(); });
    expect(keep).toHaveBeenCalledTimes(2);
  });

  /** BUG-20261003-document-retry-error-hidden: the failure stays said across the re-render it causes. */
  it('keeps saying that a retry failed when the screen re-renders with fresh callbacks', async () => {
    const trouble = status('unknown');
    const { rerender } = render(<DataSyncStatus subject="sermon-1" status={trouble} onRetry={jest.fn().mockRejectedValue(new Error('Queue unreadable'))} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry }));
    rerender(<DataSyncStatus subject="sermon-1" status={trouble} onRetry={jest.fn()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Queue unreadable');
  });

  it('keeps refusal correction and remote acceptance separate from conflict detection', async () => {
    const keep = jest.fn(), accept = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="doc" status={status('refused', { canKeepLocal: true })} onKeepLocal={keep} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.keepLocal }));
    await act(async () => { await Promise.resolve(); }); expect(keep).toHaveBeenCalledTimes(1);
    rerender(<DataSyncStatus subject="doc" status={status('remoteChanged', { canAcceptRemote: true })} onAcceptRemote={accept} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.acceptRemote }));
    await act(async () => { await Promise.resolve(); }); expect(accept).toHaveBeenCalledTimes(1);
  });

  it('reports local storage and read failures, and surfaces a failed retry without claiming a save', async () => {
    jest.useFakeTimers();
    const retry = jest.fn().mockRejectedValue(new Error('Storage full'));
    render(<DataSyncStatus subject="doc" status={status('localFailure', { freshness: 'cache', checking: true, readFailed: true })} error="Draft not durable" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Draft not durable');
    // Freshness and read trouble are said once they last, not on every passing check.
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    jest.useRealTimers();
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.freshness.cache);
    expect(screen.queryByText(en.dataSync.checking)).not.toBeInTheDocument(); expect(screen.getByText(en.dataSync.readFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry }));
    await act(async () => { await Promise.resolve(); }); expect(retry).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit human-labeled recovery choice and never selects a draft by itself', async () => {
    const recover = jest.fn();
    const choices = [{ id: 'first', title: 'Yesterday’s sermon', preview: 'A recognizable opening' }, { id: 'second', title: 'This morning’s draft' }];
    const { rerender } = render(<DataSyncStatus subject="doc" status={status('draft')} recoveryChoices={choices} onRecover={recover} />);
    expect(recover).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: en.dataSync.recover }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(en.dataSync.recoveryLabel), { target: { value: 'first' } });
    expect(screen.getByText('A recognizable opening')).toBeInTheDocument();
    fireEvent.click(button); await act(async () => { await Promise.resolve(); }); expect(recover).toHaveBeenCalledWith('first');
    rerender(<DataSyncStatus subject="doc" status={status('draft')} recoveryChoices={[choices[1]]} onRecover={recover} recoveryLoading recoveryError="Could not read another draft" />);
    expect(screen.getByRole('button', { name: en.dataSync.recover })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read another draft');
  });

  /*
   * Drafts are discovered by `useRecoveryDiscovery` when a screen opens, so a "Find saved drafts"
   * button only repeated that search and sat on every engine screen as an unexplained control
   * (owner, 2026-09-29: "непонятная кнопка … везде показывается").
   */
  it('offers no button to search for drafts; found drafts appear on their own', () => {
    const { container, rerender } = render(<DataSyncStatus subject="doc" status={status('saved')} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    rerender(<DataSyncStatus subject="doc" status={status('saved')} recoveryChoices={[{ id: 'earlier', title: 'Unfinished draft' }]} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.unfinishedWork);
    expect(screen.getByRole('option', { name: 'Unfinished draft' })).toBeInTheDocument();
  });

  it('stays quiet while a change travels as expected, and speaks as soon as the app cannot resolve it', () => {
    const retry = jest.fn();
    const { rerender } = render(<DataSyncStatus subject="doc" status={status('draft')} onRetry={retry} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.dataSync.retry })).not.toBeInTheDocument();
    rerender(<DataSyncStatus subject="doc" status={status('unknown')} onRetry={retry} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.phase.unknown);
    expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeInTheDocument();
    rerender(<DataSyncStatus subject="doc" status={status('saved')} error="Disk full" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
  });

  it('names its subject only together with something worth saying', () => {
    const { container, rerender } = render(<DataSyncStatus subject="doc" title="Settings" status={status('saved', { freshness: 'cache' })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DataSyncStatus subject="doc" title="Settings" status={status('refused')} />);
    expect(screen.getByRole('region', { name: 'Settings' })).toHaveTextContent('Settings');
    expect(screen.getByRole('status')).toHaveTextContent(en.dataSync.phase.refused);
  });

  it('reports action errors, ignores late errors of a subject no longer shown, and renders nothing without information', async () => {
    const { container, rerender, unmount } = render(<DataSyncStatus subject="doc" status={null} />); expect(container).toBeEmptyDOMElement();
    const old = deferred(), retry = jest.fn(() => old.promise);
    rerender(<DataSyncStatus subject="old-account" status={status('unknown', { freshness: 'unknown' })} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry })); await act(async () => { await Promise.resolve(); });
    const fresh = jest.fn().mockRejectedValue(undefined);
    rerender(<DataSyncStatus subject="new-account" status={status('unknown')} onRetry={fresh} />);
    await act(async () => old.reject(new Error('Old account failure'))); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry })); await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.actionFailed);
    unmount();
  });
});

/*
 * THE PAGE DOES NOT JUMP ON A BACKGROUND CHECK. Measured live on a council 2026-09-27: after two
 * quiet minutes the engine checks the server every ~16 s, and every check inserted "Checking for
 * updates…" under "Saved." for a tenth of a second — the whole council moved down 20 px and back.
 * The owner read it as the page jumping every thirty seconds while he was only reading.
 */
describe('background checks leave the page still', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('says nothing about a routine check', () => {
    const { container, rerender } = render(<DataSyncStatus subject="doc" status={status('saved')} />);
    const still = container.textContent;
    rerender(<DataSyncStatus subject="doc" status={status('saved', { checking: true })} />);
    expect(container.textContent).toBe(still);
  });

  it('does not flash freshness or read trouble that passes within the check', () => {
    const { container, rerender } = render(<DataSyncStatus subject="doc" status={status('saved')} onRetry={jest.fn()} />);
    const still = container.textContent;
    rerender(<DataSyncStatus subject="doc" status={status('saved', { freshness: 'unknown', checking: true, readFailed: true })} onRetry={jest.fn()} />);
    expect(container.textContent).toBe(still);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS - 1); });
    rerender(<DataSyncStatus subject="doc" status={status('saved')} onRetry={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(container.textContent).toBe(still);
  });

  it('does not announce an unconfirmed copy while the app is still checking without a failure', () => {
    const { container } = render(<DataSyncStatus subject="doc" status={status('saved', { freshness: 'unknown' })} onRetry={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS * 3); });
    expect(container).toBeEmptyDOMElement();
  });

  it('says so once the device copy or a failed check lasts', () => {
    const retry = jest.fn();
    render(<DataSyncStatus subject="doc" status={status('saved', { freshness: 'cache', readFailed: true })} onRetry={retry} />);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(screen.getByText(en.dataSync.freshness.cache)).toBeInTheDocument();
    expect(screen.getByText(en.dataSync.readFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeInTheDocument();
  });
});


// What the person was shown goes into the technical report's path (owner, 2026-10-10).
it('puts a trouble the person was shown into the technical report, and nothing for a calm save', () => {
  // Earlier tests in this file leave their lines in the module's memory: count what this one adds.
  // Some of them run on a clock moved forward, so the newest line by time may not be ours.
  const lines = () => diagnosticEvents().filter(event => event.name === 'sync-trouble');
  const conflicts = () => lines().filter(event => event.data.code === 'conflict').length;
  const before = lines().length, conflictsBefore = conflicts();
  const { rerender } = render(<DataSyncStatus subject="doc" status={status('saved')} />);
  expect(lines()).toHaveLength(before);
  rerender(<DataSyncStatus subject="doc" status={status('conflict')} />);
  expect(lines()).toHaveLength(before + 1);
  expect(conflicts()).toBe(conflictsBefore + 1);
});
