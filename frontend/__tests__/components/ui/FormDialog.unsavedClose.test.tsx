import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import FormDialog from '@/components/ui/FormDialog';
import { historyStepHere } from '@/utils/historyStep';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));

/*
 * BUG-20261101-browser-back-closes-window-unasked, and its class: a window holding words not yet saved closed without a
 * question by the browser's Back — and in four forms by ✕ and Escape too; only Cancel asked. Closing a window with data is
 * the person's decision (the owner, 01.11): every way out asks first; a window with nothing typed closes at once.
 */
const LIST = '/sermons';
const here = () => `${window.location.pathname}${window.location.search}`;
const dialog = (props: Partial<React.ComponentProps<typeof FormDialog>>) => (
  <FormDialog title="Мысль" onClose={jest.fn()} {...props}><p>тело</p></FormDialog>
);

describe('a window with words not yet saved', () => {
  beforeEach(() => window.history.pushState(null, '', LIST));
  afterEach(async () => {
    cleanup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    document.documentElement.style.overflow = '';
  });

  it('asks before Escape takes it, and goes only when told to', async () => {
    const onClose = jest.fn();
    render(dialog({ onClose, unsaved: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common.discardChanges.confirm' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('asks before Back takes it: the page stays, and kept editing it asks again on the next Back', async () => {
    const onClose = jest.fn();
    render(dialog({ onClose, unsaved: true }));
    expect(historyStepHere()).not.toBeNull();
    act(() => window.history.back());
    expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
    expect(here()).toBe(LIST);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common.discardChanges.keep' }));
    await waitFor(() => expect(screen.queryByText('common.discardChanges.title')).not.toBeInTheDocument());
    await waitFor(() => expect(historyStepHere()).not.toBeNull());
    act(() => window.history.back());
    expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('with nothing typed, closes at once and adds no step to history', () => {
    const onClose = jest.fn();
    render(dialog({ onClose }));
    expect(historyStepHere()).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saved, takes its step back: Back afterwards goes where it went before the window', async () => {
    const { rerender } = render(dialog({ unsaved: true }));
    expect(historyStepHere()).not.toBeNull();
    rerender(dialog({ unsaved: false }));
    await waitFor(() => expect(historyStepHere()).toBeNull());
    expect(here()).toBe(LIST);
  });

  // Codex, 05.11: while a save is on its way nothing closes the window — not ✕, not Escape, and not Back either.
  it('while saving, Back neither asks nor closes it, and it still stands on a step', async () => {
    const onClose = jest.fn();
    render(dialog({ unsaved: true, closeDisabled: true, onClose }));
    act(() => window.history.back());
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(screen.queryByText('common.discardChanges.title')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(historyStepHere()).not.toBeNull();
  });
});
