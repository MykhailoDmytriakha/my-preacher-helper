import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import TagsSection from '@/components/settings/TagsSection';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';

import type { User } from 'firebase/auth';
import '@testing-library/jest-dom';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const user = { uid: 'tag-owner' } as User;
const actions = {
  ready: true, submit: jest.fn(), create: jest.fn(), remove: jest.fn(), commit: jest.fn(), resolve: jest.fn(),
};
const makeRows = (owner = user.uid) => [{
  resource: { collection: 'tags', id: 'hope' },
  value: { userId: owner, name: 'Hope', color: '#112233', required: false },
}];
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function collection(owner = user.uid) {
  jest.mocked(useDataCollection).mockReturnValue({
    state: { snapshots: [], documents: makeRows(owner), complete: true, freshness: 'server', checking: false, version: 1, error: null },
    loading: false, error: null, refresh: jest.fn(),
  } as never);
}
async function timerTurn() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function openColor() {
  fireEvent.click(await screen.findByTestId('tag-color-preview'));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('#000000'), { target: { value: '#EF5777' } });
  return dialog;
}

describe('tag settings local capture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useDocumentActions).mockReturnValue(actions as never);
    collection();
    actions.create.mockResolvedValue(undefined);
    actions.remove.mockResolvedValue(undefined);
    actions.commit.mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('keeps the selected color through pending capture and refusal, then retries once', async () => {
    const capture = deferred();
    actions.commit.mockReturnValueOnce(capture.promise);
    render(<TagsSection user={user} />);
    const dialog = await openColor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));
    await timerTurn();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByPlaceholderText('#000000')).toHaveValue('#EF5777');
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));
    expect(actions.commit).toHaveBeenCalledTimes(1);
    await act(async () => { capture.reject(new Error('Device storage refused capture')); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByPlaceholderText('#000000')).toHaveValue('#EF5777');
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeEnabled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(actions.commit).toHaveBeenCalledTimes(2);
  });

  it('keeps deletion confirmation through pending capture and refusal, then retries once', async () => {
    const capture = deferred();
    actions.remove.mockReturnValueOnce(capture.promise);
    render(<TagsSection user={user} />);
    fireEvent.click(await screen.findByRole('button', { name: 'settings.deleteTag Hope' }));
    const dialog = screen.getByRole('dialog');
    const deleteButton = within(dialog).getByRole('button', { name: 'common.delete' });
    fireEvent.click(deleteButton);
    await timerTurn();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(deleteButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(deleteButton);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(actions.remove).toHaveBeenCalledTimes(1);
    await act(async () => { capture.reject(new Error('Device storage refused capture')); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByRole('button', { name: 'common.delete' })).toBeEnabled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(actions.remove).toHaveBeenCalledTimes(2);
  });

  it('does not let an earlier owner completion close or unlock a later owner color picker', async () => {
    const first = deferred(), second = deferred();
    actions.commit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<TagsSection user={user} />);
    const original = await openColor();
    fireEvent.click(within(original).getByRole('button', { name: 'common.save' }));
    collection('next-owner');
    view.rerender(<TagsSection user={{ uid: 'next-owner' } as User} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const current = await openColor();
    fireEvent.click(within(current).getByRole('button', { name: 'common.save' }));
    await act(async () => { first.resolve(); });
    expect(screen.getByRole('dialog')).toBe(current);
    expect(within(current).getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(actions.commit).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
