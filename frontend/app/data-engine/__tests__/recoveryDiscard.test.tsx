import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '../../../locales/en/translation.json';
import { DataSyncStatus, type DataSyncStatusProps, type RecoveryChoice } from '../DataSyncStatus';
import type { SyncPhase, SyncStatus } from '../status';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  if (['dataSync.discardRecovery', 'common.discardText.confirm', 'common.discardText.keep'].includes(key)) return key;
  const dictionary = jest.requireActual('../../../locales/en/translation.json');
  return key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key;
} }) }));

const status = (phase: SyncPhase, extras: Partial<SyncStatus> = {}): SyncStatus => ({
  phase,
  freshness: 'server',
  checking: false,
  readFailed: false,
  hasForeignChange: false,
  canSave: false,
  canRemove: false,
  canAcceptRemote: false,
  canKeepLocal: false,
  ...extras,
});
const confirmName = 'common.discardText.confirm';
const cancelName = 'common.discardText.keep';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

function viewFor(choice: RecoveryChoice, options: { subject?: unknown; onDiscardRecovery?: DataSyncStatusProps['onDiscardRecovery'] } = {}) {
  return render(<DataSyncStatus
    subject={options.subject ?? 'document-1'}
    status={status('draft')}
    recoveryChoices={[choice]}
    onDiscardRecovery={options.onDiscardRecovery ?? (async action => action())}
  />);
}

function chooseCopy() {
  fireEvent.change(screen.getByLabelText(en.dataSync.recoveryLabel), { target: { value: 'copy-1' } });
}

async function openDiscardQuestion() {
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.discardRecovery' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

describe('selected recovery copy discard', () => {
  it('shows the action for the selected copy and Cancel preserves it without calling storage', async () => {
    const discard = jest.fn().mockResolvedValue(undefined);
    const wrap = jest.fn(async (action: () => Promise<void>) => action());
    viewFor({ id: 'copy-1', title: 'Saved sermon', preview: 'Opening words', discard }, { onDiscardRecovery: wrap });

    chooseCopy();
    expect(screen.getByText('Opening words')).toBeInTheDocument();
    await openDiscardQuestion();
    fireEvent.click(screen.getByRole('button', { name: cancelName }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(wrap).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(screen.getByText('Opening words')).toBeInTheDocument();
  });

  it('confirms once through the identity-fenced wrapper using the selected copy callback', async () => {
    const discard = jest.fn().mockResolvedValue(undefined);
    const wrap = jest.fn(async (action: () => Promise<void>) => action());
    viewFor({ id: 'copy-1', title: 'Saved sermon', preview: 'Opening words', discard }, { onDiscardRecovery: wrap });

    chooseCopy();
    await openDiscardQuestion();
    fireEvent.click(screen.getByRole('button', { name: confirmName }));

    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1));
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(wrap.mock.calls[0][0]).toEqual(expect.any(Function));
  });

  it.each([
    ['the selected copy changes', { id: 'copy-1', title: 'New saved sermon', preview: 'Changed words' }],
    ['the selected copy identity changes', { id: 'copy-2', title: 'Another sermon', preview: 'Other words' }],
  ])('withdraws the open question when %s', async (_label, replacement) => {
    const firstDiscard = jest.fn().mockResolvedValue(undefined);
    const replacementDiscard = jest.fn().mockResolvedValue(undefined);
    const first = { id: 'copy-1', title: 'Saved sermon', preview: 'Opening words', discard: firstDiscard };
    const { rerender } = viewFor(first);
    chooseCopy();
    await openDiscardQuestion();

    rerender(<DataSyncStatus subject="document-1" status={status('draft')} recoveryChoices={[{ ...replacement, discard: replacementDiscard }]} onDiscardRecovery={async action => action()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(firstDiscard).not.toHaveBeenCalled();
    expect(replacementDiscard).not.toHaveBeenCalled();
  });

  it('withdraws the question when its subject changes before confirmation', async () => {
    const discard = jest.fn().mockResolvedValue(undefined);
    const { rerender } = viewFor({ id: 'copy-1', title: 'Saved sermon', discard });
    chooseCopy();
    await openDiscardQuestion();

    rerender(<DataSyncStatus subject="document-2" status={status('draft')} recoveryChoices={[{ id: 'copy-1', title: 'Saved sermon', discard }]} onDiscardRecovery={async action => action()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
  });

  it('locks the confirmed action while it is pending so repeated clicks cannot discard twice', async () => {
    const pending = deferred();
    const discard = jest.fn(() => pending.promise);
    viewFor({ id: 'copy-1', title: 'Saved sermon', discard });
    chooseCopy();
    await openDiscardQuestion();
    const confirm = screen.getByRole('button', { name: confirmName });

    await act(async () => { fireEvent.click(confirm); });
    expect(discard).toHaveBeenCalledTimes(1);
    const discardButton = screen.getByRole('button', { name: 'dataSync.discardRecovery' });
    expect(discardButton).toBeDisabled();
    fireEvent.click(discardButton);
    expect(discard).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(); await pending.promise; });
  });
});
