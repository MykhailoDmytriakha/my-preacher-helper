import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { ScripturePreviewSheet } from '@/components/bible/ScripturePreviewSheet';
import { useScriptureUsage } from '@/hooks/useScriptureUsage';
import { fetchBookText } from '@/utils/bibleText';

jest.mock('@/hooks/useScriptureUsage', () => ({ useScriptureUsage: jest.fn() }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));
jest.mock('@/components/ui/FoldableMarkdown', () => ({ FoldableMarkdown: ({ content }: { content: string }) => <article>{content}</article> }));

const reference = { bible: 'kjv' as const, book: 'Ruth', chapter: 1, fromVerse: 2 };
const retry = jest.fn();
beforeEach(() => {
  localStorage.setItem('bible:translation', 'kjv');
  jest.mocked(fetchBookText).mockResolvedValue({ id: 'Ruth', chapters: [['Before', 'Chosen verse', 'After']] });
  jest.mocked(useScriptureUsage).mockReturnValue({ results: [], complete: true, loading: false, error: false, retry });
});

describe('the reading preview over a study note', () => {
  it('uses the existing reader with context and keeps its passage and scroll position while viewing notes', async () => {
    render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    await screen.findByText('Chosen verse');
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.getByText('Chosen verse').closest('[data-verse]')).toHaveAttribute('data-arrival', 'on');
    const reader = screen.getByRole('tabpanel');
    // Shift+Tab from the window's first control wraps to the reader: the way to the Bible, then Close, lead it.
    const first = within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.sheet.openInBible' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(reader).toHaveFocus();
    reader.scrollTop = 230;
    fireEvent.click(screen.getByRole('tab', { name: /bible.preview.myNotes/ }));
    expect(reader).toHaveAttribute('inert');
    expect(reader).toHaveClass('invisible');
    fireEvent.click(screen.getByRole('tab', { name: 'bible.sheet.text' }));
    expect(screen.getByRole('tabpanel')).toBe(reader);
    expect(reader.scrollTop).toBe(230);
    expect(reader).not.toHaveAttribute('inert');
    expect(fetchBookText).toHaveBeenCalledTimes(1);
    expect(useScriptureUsage).toHaveBeenLastCalledWith(reference, 'current', 'en');
  });

  it('says on the tab how many notes are found, also when the list may be incomplete', async () => {
    const found = { id: 'n', kind: 'note' as const, title: 'Related note', href: '/studies/n', reference, match: 'same' as const, excerpt: 'Mention.', content: 'Mention.' };
    const count = () => screen.queryByTestId('related-count')?.textContent ?? null;
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [found], complete: false, loading: false, error: false, retry });
    const { rerender } = render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    await screen.findByText('Chosen verse');
    expect(within(screen.getByRole('tab', { name: /bible.preview.myNotes/ })).getByTestId('related-count')).toHaveTextContent('1');
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [], complete: true, loading: false, error: false, retry });
    rerender(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    expect(count()).toBe('0');
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [], complete: false, loading: true, error: false, retry });
    rerender(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    expect(count()).toBeNull();
  });

  it('keeps unknown and failed searches apart from a confirmed empty result', async () => {
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [], complete: false, loading: false, error: true, retry });
    render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /bible.preview.myNotes/ }));
    expect(screen.getByText('bible.preview.notesError')).toBeVisible();
    expect(screen.getByText('bible.preview.partialNotes')).toBeVisible();
    expect(screen.queryByText('bible.preview.emptyNotes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bible.retry' }));
    expect(retry).toHaveBeenCalled();
    await screen.findByText('Chosen verse');
  });

  it('reads the whole note and returns either to the list or the same place in the Bible', async () => {
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [{ id: 'n', kind: 'note', title: 'Related note', href: '/studies/n', reference, match: 'same', excerpt: 'The exact mention.', content: 'The exact mention. The rest of the full note.' }], complete: true, loading: false, error: false, retry });
    const close = jest.fn();
    render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={close} />);
    await screen.findByText('Chosen verse');
    const reader = screen.getByRole('tabpanel');
    reader.scrollTop = 150;
    fireEvent.click(screen.getByRole('tab', { name: /bible.preview.myNotes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Related note/ }));
    const detail = screen.getByRole('dialog', { name: 'Related note' });
    expect(within(detail).getByText('The exact mention. The rest of the full note.')).toBeVisible();
    // In the installed app a new tab leaves it (Safari keeps its own sign-in): the note opens here.
    const open = within(detail).getByRole('link', { name: 'bible.preview.openNote' });
    expect(open).toHaveAttribute('href', '/studies/n');
    expect(open).not.toHaveAttribute('target');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Related note' })).not.toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /bible.preview.myNotes/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Related note/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bible.preview.backToVerse' }));
    expect(screen.queryByRole('dialog', { name: 'Related note' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'bible.sheet.text' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBe(reader);
    expect(reader.scrollTop).toBe(150);
    expect(close).not.toHaveBeenCalled();
  });

  it('opens a long note at the place that names the passage', async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = jest.fn(function (this: Element) { scrolled.push(this); });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const content = `Opening paragraph.\n\nSecond section. Here Ruth 1:2 is read.`;
    jest.mocked(useScriptureUsage).mockReturnValue({ results: [{ id: 'n', kind: 'note', title: 'Long note', href: '/studies/n', reference, match: 'text', excerpt: 'Here Ruth 1:2 is read.', content, mention: 'Ruth 1:2' }], complete: true, loading: false, error: false, retry });
    render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
    await screen.findByText('Chosen verse');
    fireEvent.click(screen.getByRole('tab', { name: /bible.preview.myNotes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Long note/ }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
    expect(scrolled.at(-1)?.textContent).toContain('Ruth 1:2');
    expect(within(screen.getByRole('dialog', { name: 'Long note' })).getByText(/Here Ruth 1:2 is read/)).toBeVisible();
  });

  it('centres the words themselves, not their whole paragraph, where the browser can measure them', async () => {
    const scrollIntoView = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    // The preview sheet scrolls (600 tall, 4000 of content) and the words sit at 1900.
    const isPreview = (element: Element) => element.getAttribute('aria-labelledby') !== null && element.textContent?.includes('At its end');
    const measured = {
      scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
      clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
      getBoundingClientRect: Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect'),
    };
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return isPreview(this) ? 4000 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isPreview(this) ? 600 : 0; } });
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', { configurable: true, value(this: Element) { return isPreview(this) ? rect(100, 600) : rect(0, 0); } });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(1900, 20) });
    try {
      const content = `${'A long paragraph. '.repeat(200)}At its end Ruth 1:2 is read.`;
      jest.mocked(useScriptureUsage).mockReturnValue({ results: [{ id: 'n', kind: 'note', title: 'Long note', href: '/studies/n', reference, match: 'text', excerpt: '…', content, mention: 'Ruth 1:2' }], complete: true, loading: false, error: false, retry });
      render(<ScripturePreviewSheet reference={reference} currentNoteId="current" onClose={jest.fn()} />);
      await screen.findByText('Chosen verse');
      fireEvent.click(screen.getByRole('tab', { name: /bible.preview.myNotes/ }));
      fireEvent.click(screen.getByRole('button', { name: /Long note/ }));
      const sheet = screen.getByRole('dialog', { name: 'Long note' });
      // 1900 - 100 brings the words to the top; half of the room left (600 - 20) / 2 centres them.
      await waitFor(() => expect(sheet.scrollTop).toBe(1510));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Object.entries(measured).forEach(([key, descriptor]) => {
        const owner = key === 'getBoundingClientRect' ? Element.prototype : HTMLElement.prototype;
        if (descriptor) Object.defineProperty(owner, key, descriptor); else delete (owner as unknown as Record<string, unknown>)[key];
      });
      delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });
});
