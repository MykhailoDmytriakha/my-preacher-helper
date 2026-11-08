import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { usePrayerRequestsEngine } from '@/hooks/usePrayerRequestsEngine';
import { awaitWriteOperation } from '@/utils/recoverableWrite';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(), useDocumentActions: jest.fn(),
}));
jest.mock('@components/FocusRecorderButton', () => ({ FocusRecorderButton: () => null }));
const mockAcceptDictation = jest.fn().mockResolvedValue(undefined);
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: () => ({
  isProcessing: false, isRecording: false, accept: mockAcceptDictation, error: null,
}) }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const stored = { userId: 'u', title: 'Healing', status: 'active', updates: [], createdAt: 'c' };
const actions = { ready: true, captureActionTime: jest.fn(), commit: jest.fn(), create: jest.fn(), remove: jest.fn() };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function UpdateEditor({ close }: { close: () => void }) {
  const prayers = usePrayerRequestsEngine('u', 'p1', true);
  return <AddUpdateModal onClose={close} onSubmit={text => prayers.addUpdate('p1', text)} />;
}
function enterUpdate() {
  fireEvent.change(screen.getByPlaceholderText('prayer.update.placeholder'), { target: { value: 'Every update word stays' } });
  fireEvent.submit(screen.getByRole('button', { name: 'prayer.update.submit' }).closest('form')!);
}

beforeEach(() => {
  jest.clearAllMocks(); window.localStorage.clear();
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockReturnValue({ state: { documents: [], snapshots: [], complete: true,
    freshness: 'server', checking: false, version: 1, error: null }, loading: false, error: null, refresh: jest.fn() } as never);
});

describe('prayer local capture ownership', () => {
  it('keeps the update editor busy until actual local capture finishes', async () => {
    const capture = deferred(), close = jest.fn(); actions.commit.mockReturnValueOnce(capture.promise);
    render(<UpdateEditor close={close} />); enterUpdate();
    await act(async () => { await pause(); });
    expect(close).not.toHaveBeenCalled();
    expect(mockAcceptDictation).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('prayer.update.placeholder')).toHaveValue('Every update word stays');
    expect(screen.getByRole('button', { name: 'prayer.update.saving' })).toBeDisabled();
    await act(async () => { capture.resolve(); });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(mockAcceptDictation).toHaveBeenCalledTimes(1);
  });

  it('retains a rejected update and allows a deliberate retry after a delayed disk failure', async () => {
    const capture = deferred(), close = jest.fn(); actions.commit.mockReturnValueOnce(capture.promise);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<UpdateEditor close={close} />); enterUpdate();
      await act(async () => { await pause(); capture.reject(new Error('Disk full')); });
      expect(close).not.toHaveBeenCalled();
      expect(mockAcceptDictation).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('prayer.update.placeholder')).toHaveValue('Every update word stays');
      expect(screen.getByRole('button', { name: 'prayer.update.submit' })).toBeEnabled();
      actions.commit.mockResolvedValueOnce(undefined); enterUpdate();
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      expect(actions.commit).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it.each(['edit', 'answer'] as const)('keeps the %s input until its actual capture finishes', async kind => {
    const capture = deferred(), close = jest.fn();
    actions.commit.mockImplementation((_resource, update) => { update(stored); return capture.promise; });
    function Editor() {
      const prayers = usePrayerRequestsEngine('u', 'p1', true);
      return kind === 'edit'
        ? <CreatePrayerModal mode="edit" initialValues={{ title: 'Healing' }} onClose={close}
            onSubmit={payload => prayers.updatePrayer('p1', payload)} />
        : <MarkAnsweredModal onClose={close} onSubmit={answer => prayers.setStatus('p1', 'answered', answer)} />;
    }
    render(<Editor />);
    const input = screen.getByPlaceholderText(kind === 'edit' ? 'prayer.create.titlePlaceholder' : 'prayer.markAnswered.placeholder');
    fireEvent.change(input, { target: { value: 'Every prayer word stays' } });
    fireEvent.click(screen.getByRole('button', { name: kind === 'edit' ? 'prayer.edit.submit' : 'prayer.markAnswered.submit' }));
    await act(async () => { await pause(); });
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveValue('Every prayer word stays');
    await act(async () => { capture.resolve(); });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it.each(['edit', 'status', 'delete'] as const)('makes a duplicate %s await the same pending capture', async kind => {
    const capture = deferred();
    actions.commit.mockImplementation((_resource, update) => { update(stored); return capture.promise; });
    actions.remove.mockReturnValue(capture.promise);
    const hook = renderHook(() => usePrayerRequestsEngine('u', 'p1', true));
    const run = () => kind === 'edit' ? hook.result.current.updatePrayer('p1', { title: 'New title' })
      : kind === 'status' ? hook.result.current.setStatus('p1', 'not_answered') : hook.result.current.deletePrayer('p1');
    let secondFinished = false;
    let first!: ReturnType<typeof run>, second!: ReturnType<typeof run>;
    act(() => { first = run(); second = run(); });
    const waiting = awaitWriteOperation(second, () => undefined).then(() => { secondFinished = true; });
    await act(async () => { await pause(); });
    expect(secondFinished).toBe(false);
    expect(kind === 'delete' ? actions.remove : actions.commit).toHaveBeenCalledTimes(1);
    await act(async () => { capture.resolve(); await waiting; await awaitWriteOperation(first, () => undefined); });
    expect(secondFinished).toBe(true);
  });
  it('does not coalesce pending actions across an owner change', async () => {
    const firstCapture = deferred(), secondCapture = deferred();
    actions.remove.mockReturnValueOnce(firstCapture.promise).mockReturnValueOnce(secondCapture.promise);
    const hook = renderHook(({ owner }) => usePrayerRequestsEngine(owner, 'p1', true), { initialProps: { owner: 'u' } });
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = hook.result.current.deletePrayer('p1'); });
    hook.rerender({ owner: 'other-owner' });
    act(() => { second = hook.result.current.deletePrayer('p1'); });
    await act(async () => { await pause(); });
    expect(actions.remove).toHaveBeenCalledTimes(2);
    let finished = false;
    void second.then(() => { finished = true; });
    await act(async () => { firstCapture.resolve(); await first; });
    expect(finished).toBe(false);
    await act(async () => { secondCapture.resolve(); await second; });
    expect(finished).toBe(true);
  });

});
