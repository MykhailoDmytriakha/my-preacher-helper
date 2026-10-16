import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { CrossReferenceSettings } from '@/components/bible/CrossReferenceSettings';
import { readCrossReferencePrefs, resetCrossReferencePrefsForTests, saveCrossReferencePrefs } from '@/components/bible/crossReferencePrefs';
import { useBookCrossRefs } from '@/components/bible/useBookCrossRefs';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { TextScaleProvider } from '@/providers/TextScaleProvider';
import { bibleCrossRefsBase } from '@/utils/bibleCrossRefsCache';
import { crossReferenceLabel, crossReferencesAt, forgetLoadedCrossRefs, isMainReference, type CrossReference, type CrossRefsBook } from '@/utils/crossReferences';

import type { BookText } from '@/utils/bibleText';

// The reader's marks keep one form of the data engine per book; these tests mount no engine.
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));

/*
 * Cross references in the Bible reader, on the real files: the Synodal text of Ruth (four chapters,
 * small enough to draw whole) and its set built from the fourteen MyBible modules.
 */
const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const ruthSet: CrossRefsBook = publicFile(`${bibleCrossRefsBase.slice(1)}/ruth.json`);
const ruthText: BookText = publicFile('bible-text/rst/v1/ruth.json');

/** The first verse of Ruth with main links both within the book and into another one. */
const subject = (() => {
  for (let chapter = 1; chapter <= ruthText.chapters.length; chapter += 1) {
    for (let verse = 1; verse <= ruthText.chapters[chapter - 1].length; verse += 1) {
      const all = crossReferencesAt(ruthSet, 'rst', { book: 'Ruth', chapter, verse });
      const main = all.filter(isMainReference);
      const inside = main.find((reference) => reference.book === 'Ruth');
      const outside = main.find((reference) => reference.book !== 'Ruth');
      if (inside && outside) return { chapter, verse, all, main, inside, outside };
    }
  }
  throw new Error('No verse of Ruth links both within and without');
})();
const key = `${subject.chapter}:${subject.verse}`;
const label = (reference: CrossReference) => crossReferenceLabel(reference, 'rst', 'en');

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });

/** Serves the Bible text and the set from `public/`, as the app does; keeps the set's requests. */
let setRequests: string[] = [];
beforeEach(() => {
  window.matchMedia = jest.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  forgetLoadedCrossRefs();
  setRequests = [];
  global.fetch = jest.fn(async (url: string) => {
    if (url.startsWith('/bible-crossrefs/')) setRequests.push(url);
    return answer(publicFile(url.slice(1)));
  }) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

const renderRuth = (onOpenBook = jest.fn()) => {
  render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: subject.chapter, verse: subject.verse }} onOpenBook={onOpenBook} />);
  return onOpenBook;
};

const openLinksOfSubject = async () => {
  await userEvent.click(await screen.findByTestId(`cross-refs-${key}`));
  return screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
};

describe('cross references in the Bible reader', () => {
  it('puts beside a verse the number of its main links, and the chip opens them', async () => {
    renderRuth();
    expect(await screen.findByTestId(`cross-refs-${key}`)).toHaveTextContent(String(subject.main.length));
    expect(setRequests).toEqual([`${bibleCrossRefsBase}/ruth.json`]);
    const dialog = await openLinksOfSubject();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(subject.main.length);
    expect(within(dialog).getByText(label(subject.main[0]))).toBeInTheDocument();
  });

  it('a link into another book: its text first, then "Open" asks for that book at the passage, with the verse it came from as the way back', async () => {
    const onOpenBook = renderRuth();
    const dialog = await openLinksOfSubject();
    await userEvent.click(within(dialog).getByText(label(subject.outside)));
    expect(screen.getByRole('heading', { name: label(subject.outside) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
    await waitFor(() => expect(onOpenBook).toHaveBeenCalled());
    expect(onOpenBook).toHaveBeenCalledWith(
      subject.outside.book.toLowerCase().replace(/\s+/g, '-'),
      { chapter: subject.outside.chapter, verse: subject.outside.fromVerse, toVerse: subject.outside.toVerse },
      { slug: 'ruth', chapter: subject.chapter, verse: subject.verse, bible: 'rst' }
    );
  });

  it('a link within the book jumps there, lights it, and the way back returns to the verse it came from', async () => {
    const onOpenBook = renderRuth();
    const dialog = await openLinksOfSubject();
    await userEvent.click(within(dialog).getByText(label(subject.inside)));
    const scroll = jest.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    // The jump comes only after the window is gone: on iOS the window pins the page and, released,
    // puts the scroll back — a jump made under it was undone (review finding, 2026-10-16).
    let windowOpenAtJump: boolean | null = null;
    scroll.mockImplementationOnce(() => { windowOpenAtJump = document.querySelector('[role="dialog"]') !== null; });
    await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(windowOpenAtJump).toBe(false);

    expect(onOpenBook).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const row = document.querySelector(`[data-verse="${subject.inside.chapter}:${subject.inside.fromVerse}"]`);
    expect(scroll.mock.contexts[0]).toBe(subject.inside.fromVerse > 1 ? row : document.querySelector(`[data-chapter="${subject.inside.chapter}"]`));
    expect(row).toHaveAttribute('data-arrival', 'on');

    scroll.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    const home = subject.verse > 1 ? document.querySelector(`[data-verse="${key}"]`) : document.querySelector(`[data-chapter="${subject.chapter}"]`);
    expect(scroll.mock.contexts[0]).toBe(home);
    expect(screen.queryByRole('button', { name: 'bible.backToLabel' })).not.toBeInTheDocument();
  });

  it('"all" counts every link of a verse', async () => {
    saveCrossReferencePrefs({ mode: 'all' });
    renderRuth();
    expect(await screen.findByTestId(`cross-refs-${key}`)).toHaveTextContent(String(subject.all.length));
  });

  it('turned off, the text reads as before and the set is not even fetched', async () => {
    saveCrossReferencePrefs({ show: false });
    renderRuth();
    const firstWords = ruthText.chapters[0][0].replace(/^¶/, '').split(' ').slice(0, 3).join(' ');
    expect(await screen.findByText(new RegExp(firstWords))).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByTestId(`cross-refs-${key}`)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'bible.crossRefs.verseRefs' })).toHaveLength(0);
    expect(setRequests).toEqual([]);
  });

  it('a passage window shows them only when asked for in windows too', async () => {
    const { result, rerender } = renderHook(() => useBookCrossRefs('Ruth', 'rst', ruthText, 'window'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(result.current.ribbon).toBeUndefined();
    expect(setRequests).toEqual([]);

    act(() => saveCrossReferencePrefs({ inWindow: true }));
    rerender();
    await waitFor(() => expect(result.current.ribbon?.counts.get(key)).toEqual({ main: subject.main.length, total: subject.all.length }));
  });
});

describe('the cross-reference settings', () => {
  it('keeps the choice on the device and reads a broken record as the defaults', () => {
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: false, mode: 'main' });
    saveCrossReferencePrefs({ inWindow: true });
    resetCrossReferencePrefsForTests();
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: true, mode: 'main' });
    window.localStorage.setItem('bible:cross-references', '{not json');
    resetCrossReferencePrefsForTests();
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: false, mode: 'main' });
  });

  it('lives under the text size in the "T" menu; off, its two sub-rows rest', async () => {
    render(
      <TextScaleProvider>
        <FloatingTextScaleControls>
          <CrossReferenceSettings />
        </FloatingTextScaleControls>
      </TextScaleProvider>
    );
    await userEvent.click(await screen.findByLabelText('Text size'));
    const menu = screen.getByRole('dialog', { name: 'Text size' });
    expect(within(menu).getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
    const settings = within(menu).getByTestId('cross-reference-settings');
    const [show, inWindow] = within(settings).getAllByRole('switch');
    expect(show).toBeChecked();
    expect(inWindow).not.toBeChecked();

    await userEvent.click(within(settings).getByRole('button', { name: 'bible.crossRefs.all' }));
    expect(readCrossReferencePrefs().mode).toBe('all');
    await userEvent.click(show);
    expect(readCrossReferencePrefs().show).toBe(false);
    expect(inWindow).toBeDisabled();
    expect(within(settings).getByRole('button', { name: 'bible.crossRefs.main' })).toBeDisabled();
  });

  it('without settings of its own a screen keeps the bare size capsule', async () => {
    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );
    await userEvent.click(await screen.findByLabelText('Text size'));
    expect(screen.queryByTestId('cross-reference-settings')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Text size' })).toHaveClass('rounded-full');
  });
});
