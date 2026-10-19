import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';

import type { User } from 'firebase/auth';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(), useDocumentActions: jest.fn(),
}));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const stored = { userId: 'u1', name: 'Original template', structure: { introduction: [], main: [], conclusion: [] },
  rev: { template: 3 }, createdAt: 'c', updatedAt: 'u' };
const actions = { ready: true, commit: jest.fn(), create: jest.fn(), remove: jest.fn() };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount() { return render(<PlanTemplatesSection user={{ uid: 'u1' } as User} />); }
function rename() {
  fireEvent.click(screen.getByLabelText('common.edit'));
  fireEvent.change(screen.getByDisplayValue('Original template'), { target: { value: 'Renamed text stays' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
}
async function remove() {
  fireEvent.click(screen.getByLabelText('common.delete'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
}

beforeEach(() => {
  jest.clearAllMocks(); window.localStorage.clear();
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockReturnValue({ state: { documents: [
    { resource: { collection: 'planTemplates', id: 'tpl' }, value: stored },
  ], snapshots: [], complete: true, freshness: 'server', checking: false, version: 1, error: null },
    loading: false, error: null, refresh: jest.fn() } as never);
});

describe('explicit template local capture', () => {
  it('retains the rename input until the public capture resolves', async () => {
    const capture = deferred(); actions.commit.mockReturnValueOnce(capture.promise);
    mount(); rename();
    await act(async () => { await pause(); });
    expect(screen.getByDisplayValue('Renamed text stays')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByDisplayValue('Renamed text stays'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByDisplayValue('Renamed text stays'), { key: 'Escape' });
    expect(actions.commit).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('Renamed text stays')).toBeInTheDocument();
    await act(async () => { capture.resolve(); });
    await waitFor(() => expect(screen.queryByDisplayValue('Renamed text stays')).not.toBeInTheDocument());
  });

  it('keeps a rejected rename usable for a deliberate retry', async () => {
    const capture = deferred(); actions.commit.mockReturnValueOnce(capture.promise);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mount(); rename();
      await act(async () => { await pause(); capture.reject(new Error('Disk full')); });
      expect(screen.getByDisplayValue('Renamed text stays')).toBeEnabled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith('planTemplates.renameError');
      actions.commit.mockResolvedValueOnce(undefined);
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
      await waitFor(() => expect(screen.queryByDisplayValue('Renamed text stays')).not.toBeInTheDocument());
      expect(actions.commit).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it('retains the real deletion confirmation until capture resolves', async () => {
    const capture = deferred(); actions.remove.mockReturnValueOnce(capture.promise);
    mount(); await remove();
    await act(async () => { await pause(); });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'common.deleting' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.deleting' }));
    expect(actions.remove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { capture.resolve(); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps rejected deletion available for retry without hiding its template', async () => {
    const capture = deferred(); actions.remove.mockReturnValueOnce(capture.promise);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mount(); await remove();
      await act(async () => { await pause(); capture.reject(new Error('Disk full')); });
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'common.delete' })).toBeEnabled();
      expect(screen.getByText('Original template')).toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith('planTemplates.deleteError');
      actions.remove.mockResolvedValueOnce(undefined);
      fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(actions.remove).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it('does not report an old owner capture failure to the next owner', async () => {
    const capture = deferred(); actions.commit.mockReturnValueOnce(capture.promise);
    const view = mount(); rename();
    view.rerender(<PlanTemplatesSection user={{ uid: 'u2' } as User} />);
    await act(async () => { capture.reject(new Error('Old owner disk failure')); });
    expect(toast.error).not.toHaveBeenCalled();
  });


  it('retires the previous owner delete confirmation while capture is pending', async () => {
    const capture = deferred(); actions.remove.mockReturnValueOnce(capture.promise);
    const view = mount(); await remove();
    view.rerender(<PlanTemplatesSection user={{ uid: 'u2' } as User} />);
    await act(async () => { capture.resolve(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(actions.remove).toHaveBeenCalledTimes(1);
  });

  it('does not offer the previous owner rename input after identity changes', async () => {
    const capture = deferred(); actions.commit.mockReturnValueOnce(capture.promise);
    const view = mount(); rename();
    view.rerender(<PlanTemplatesSection user={{ uid: 'u2' } as User} />);
    await act(async () => { capture.resolve(); });
    expect(screen.queryByDisplayValue('Renamed text stays')).not.toBeInTheDocument();
    expect(actions.commit).toHaveBeenCalledTimes(1);
  });

});
