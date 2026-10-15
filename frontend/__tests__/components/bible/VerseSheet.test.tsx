import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { VerseSheet } from '@/components/bible/VerseSheet';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useKeyboardShortcut } from '@hooks/useKeyboardShortcut';
import { fetchBookText } from '@/utils/bibleText';
import { verseCount } from '@/utils/versification';

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));

// Ruth with fewer verses than the real book: a row the passage names and the file lacks is simply not lit.
const ruth = { id: 'Ruth', chapters: [['¶Первый', 'Второй', 'Третий'], ['¶Глава два'], ['¶Глава три'], ['¶Глава четыре']] };
const lit = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll('[data-arrival="on"]')).map((row) => row.getAttribute('data-verse'));

beforeEach(() => {
  window.localStorage.setItem('bible:translation', 'rst');
  jest.mocked(fetchBookText).mockReset();
  jest.mocked(fetchBookText).mockResolvedValue(ruth as never);
});

describe('VerseSheet — the passage over the screen', () => {
  it('shows nothing while no reference is open', () => {
    render(<VerseSheet reference={null} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the words tapped as its title, the passage lit and its neighbours dark', async () => {
    render(<VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 2, toVerse: 3, label: 'Руфь 1:2–3' }} onClose={jest.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:2–3' });
    await waitFor(() => expect(lit(dialog)).toEqual(['1:2', '1:3']));
    expect(within(dialog).getByText('bible.translations.rst.name')).toBeInTheDocument();
    expect(fetchBookText).toHaveBeenCalledWith('Ruth', 'rst');
  });

  it('lights every verse of a chapter named whole', async () => {
    render(<VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, label: 'Руфь 1' }} onClose={jest.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1' });
    await waitFor(() => expect(lit(dialog)).toEqual(['1:1', '1:2', '1:3']));
  });

  it('reads the text in the Bible of the device and finds the passage there', async () => {
    window.localStorage.setItem('bible:translation', 'kjv');
    const psalms = { id: 'Psalms', chapters: Array.from({ length: 150 }, (_, index) => Array.from({ length: verseCount('kjv', 'Psalms', index + 1) }, (__, verse) => `Psalm ${index + 1}:${verse + 1}`)) };
    jest.mocked(fetchBookText).mockResolvedValue(psalms as never);
    render(<VerseSheet reference={{ bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12, label: 'Пс 50:12' }} onClose={jest.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Пс 50:12' });
    await waitFor(() => expect(lit(dialog)).toEqual(['51:10']));
    expect(fetchBookText).toHaveBeenCalledWith('Psalms', 'kjv');
  });

  it('closes by its button, by Escape and by a press beside it', async () => {
    const onClose = jest.fn();
    render(<VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' }} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'bible.sheet.close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    const beside = screen.getAllByRole('button', { name: 'bible.sheet.close', hidden: true }).find((button) => !dialog.contains(button));
    fireEvent.click(beside as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('keeps Tab inside the window: Shift+Tab from its first control does not reach the screen under it', async () => {
    render(
      <>
        <button type="button">Next block</button>
        <VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' }} onClose={jest.fn()} />
      </>
    );
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    const close = within(dialog).getByRole('button', { name: 'bible.sheet.close' });
    expect(close).toHaveFocus();
    // Round to the last control of the window — the text itself — and not out of it.
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(dialog.querySelector('[tabindex="0"]')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Next block' })).not.toHaveFocus();
  });

  it('leaves focus where the person put it when the screen under it renders again', async () => {
    // A meeting renders every second for its timer, with a new close callback each time.
    const reference = { bible: 'rst' as const, book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' };
    const { rerender } = render(<VerseSheet reference={reference} onClose={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    await waitFor(() => expect(lit(dialog)).toEqual(['1:1']));
    const text = dialog.querySelector<HTMLElement>('[tabindex="0"]') as HTMLElement;
    text.focus();
    rerender(<VerseSheet reference={reference} onClose={() => undefined} />);
    expect(text).toHaveFocus();
  });

  it('lets Escape close the window only — the page under it does not leave', async () => {
    // The preaching timer answers Escape by going to the sermon list (PreachingTimer, useKeyboardShortcut).
    const leave = jest.fn();
    const close = jest.fn();
    function PreachingPage() {
      useKeyboardShortcut({ onEscape: leave, onBackspace: leave });
      return <VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' }} onClose={close} />;
    }
    render(<PreachingPage />);
    await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();
  });

  it('gives the keyboard to a question asked over it', async () => {
    // The question comes later, as in life: the timer's ✕ pressed while the text is open.
    const page = (asking: boolean) => (
      <>
        <VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' }} onClose={jest.fn()} />
        <ConfirmModal isOpen={asking} onClose={jest.fn()} onConfirm={jest.fn()} title="End the sermon?" cancelText="Stay" />
      </>
    );
    const { rerender } = render(page(false));
    await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    rerender(page(true));
    const stay = screen.getByRole('button', { name: 'Stay' });
    stay.focus();
    fireEvent.keyDown(stay, { key: 'Tab' });
    expect(screen.getAllByRole('button', { name: 'bible.sheet.close' }).some((button) => button === document.activeElement)).toBe(false);
  });

  it('says the text could not be read and reads it again on request', async () => {
    jest.mocked(fetchBookText).mockRejectedValueOnce(new Error('offline'));
    render(<VerseSheet reference={{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 1, label: 'Руфь 1:1' }} onClose={jest.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Руфь 1:1' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'bible.retry' }));
    await waitFor(() => expect(lit(dialog)).toEqual(['1:1']));
  });
});
