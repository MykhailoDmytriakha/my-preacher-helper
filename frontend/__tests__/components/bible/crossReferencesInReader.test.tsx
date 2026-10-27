import { ReaderShell } from '../../../test-utils/reader-shell';
import { act, fireEvent, render as renderUI, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { readCrossReferencePrefs, resetCrossReferencePrefsForTests, saveCrossReferencePrefs, useCrossReferencePrefs } from '@/components/bible/crossReferencePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { useBookCrossRefs } from '@/components/bible/useBookCrossRefs';
import { restingScrollTop } from '@/components/bible/verseSheetGeometry';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { TextScaleProvider } from '@/providers/TextScaleProvider';
import { diagnosticEvents } from '@/utils/appDiagnostics';
import { bibleCrossRefsBase } from '@/utils/bibleCrossRefsCache';
import { coversChapter, crossReferenceLabel, crossReferencesAt, forgetLoadedCrossRefs, isMainReference, type CrossReference, type CrossRefsBook } from '@/utils/crossReferences';

import { bookSlug, verseWords, type BookText } from '@/utils/bibleText';

const render = (ui: React.ReactNode, options?: Parameters<typeof renderUI>[1]) => renderUI(ui, { wrapper: ReaderShell, ...options });

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
  resetPlaceTrailForTests();
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

  // The owner's iPad, 2026-10-16: a main link's verse was cut after two lines.
  it('shows a main link\'s verse whole, never cut after two lines', async () => {
    renderRuth();
    const dialog = await openLinksOfSubject();
    const row = within(dialog).getByText(label(subject.main[0])).closest('button') as HTMLElement;
    expect(row.querySelector('.line-clamp-2')).toBeNull();
  });

  it('the rest of a verse\'s links: a switch beside the open row shows them as verses with their text, the same choice as in the "T" menu', async () => {
    const others = subject.all.filter((reference) => !isMainReference(reference));
    expect(others.length).toBeGreaterThan(0);
    renderRuth();
    const dialog = await openLinksOfSubject();
    expect(within(dialog).queryByRole('switch', { name: 'bible.crossRefs.othersAsVerses' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'bible.crossRefs.othersSection' }));
    const asVerses = within(dialog).getByRole('switch', { name: 'bible.crossRefs.othersAsVerses' });
    expect(asVerses).not.toBeChecked();
    // Only the references: each a chip named by its place.
    const first = [...others].sort((a, b) => (a.book === b.book ? a.chapter - b.chapter || a.fromVerse - b.fromVerse : 0))[0];
    expect(within(dialog).getByRole('button', { name: label(first) })).toBeInTheDocument();

    await userEvent.click(asVerses);
    expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    // As verses: each with its text, once its book has come.
    const verses = publicFile(`bible-text/rst/v1/${bookSlug(others[0].book)}.json`).chapters[others[0].chapter - 1] as string[];
    const start = verseWords(verses[others[0].fromVerse - 1]).split(' ').slice(0, 4).join(' ');
    expect(await within(dialog).findByText((text) => text.startsWith(start))).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: label(first) })).not.toBeInTheDocument();
  });

  // The owner's iPad, 2026-10-16: a small switch laid over the row's own button; a finger a few pixels
  // off it folded the rest instead ("it blinks back and forth, then switches on the second time").
  it('the rest\'s switch stands beside the row\'s button, never over or inside it, and a tap on it never folds the rest', async () => {
    renderRuth();
    const dialog = await openLinksOfSubject();
    const row = within(dialog).getByRole('button', { name: 'bible.crossRefs.othersSection' });
    await userEvent.click(row);
    const asVerses = within(dialog).getByRole('switch', { name: 'bible.crossRefs.othersAsVerses' });
    expect(row.contains(asVerses)).toBe(false);
    expect(asVerses.contains(row)).toBe(false);
    expect(asVerses.parentElement).toBe(row.parentElement);
    expect(getComputedStyle(asVerses).position).not.toBe('absolute');
    await userEvent.click(asVerses);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    // The change and where it came from reach the technical details a feedback report sends.
    expect(diagnosticEvents().some((event) => event.name === 'setting' && event.data.source === 'window'
      && event.data.code === 'crossRefs-othersAsVerses' && event.data.result === 'on')).toBe(true);
  });

  // The owner's iPad, 2026-10-16: a link opened in place of the list, and going back the list started over.
  it('a link opens over the list as a cascade; closed, the list is found exactly as it was', async () => {
    renderRuth();
    const list = await openLinksOfSubject();
    await userEvent.click(within(list).getByRole('button', { name: 'bible.crossRefs.othersSection' }));
    list.scrollTop = 240;
    await userEvent.click(within(list).getByText(label(subject.outside)));
    const windows = screen.getAllByRole('dialog');
    expect(windows).toHaveLength(2);
    const link = screen.getByRole('dialog', { name: label(subject.outside) });
    expect(link).not.toBe(list);
    expect(list).toBeInTheDocument();
    // Escape closes the window on top only.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: label(subject.outside) })).not.toBeInTheDocument();
    const same = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
    expect(same).toBe(list);
    expect(same.scrollTop).toBe(240);
    expect(within(same).getByRole('button', { name: 'bible.crossRefs.othersSection' })).toHaveAttribute('aria-expanded', 'true');
    // Its own ✕ too.
    await userEvent.click(within(same).getByText(label(subject.outside)));
    const again = screen.getByRole('dialog', { name: label(subject.outside) });
    await userEvent.click(within(again).getByRole('button', { name: 'common.close' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  // The owner, 2026-10-17 and 2026-10-19: a link opened its verse alone, and where the context was not
  // remembered the verse gave no details. It opens in its whole chapter — that chapter only, and seen so.
  it('a link opens in its whole chapter: named above, its end below, the passage lit among its neighbours', async () => {
    renderRuth();
    const list = await openLinksOfSubject();
    await userEvent.click(within(list).getByText(label(subject.outside)));
    const link = screen.getByRole('dialog', { name: label(subject.outside) });
    const { book, chapter, fromVerse, toVerse } = subject.outside;
    const verses = (publicFile(`bible-text/rst/v1/${bookSlug(book)}.json`) as BookText).chapters[chapter - 1];
    const psalm = book === 'Psalms';
    await waitFor(() => expect(within(link).getByText(psalm ? 'bible.crossRefs.psalmEnd' : 'bible.crossRefs.chapterEnd')).toBeInTheDocument());
    expect(within(link).getAllByText(psalm ? 'bible.psalm' : 'bible.crossRefs.chapterOfBook').length).toBeGreaterThan(0);
    const words = (raw: string) => verseWords(raw).slice(0, 30);
    expect(link.textContent).toContain(words(verses[0]));
    expect(link.textContent).toContain(words(verses[verses.length - 1]));
    const lit = Array.from(link.querySelectorAll('[data-arrival="on"]'));
    expect(lit).toHaveLength(coversChapter(subject.outside, 'rst') ? 0 : toVerse - fromVerse + 1);
    if (lit.length > 0) expect(lit[0].textContent).toContain(words(verses[fromVerse - 1]));
    // Rows of another place are never taken for the verse being read or for a verse to mark.
    expect(link.querySelector('[data-verse], [data-verse-text]')).toBeNull();
  });

  it('a link to a whole chapter lights nothing: the chapter is the passage', async () => {
    const found = (() => {
      for (let chapter = 1; chapter <= ruthText.chapters.length; chapter += 1) {
        for (let verse = 1; verse <= ruthText.chapters[chapter - 1].length; verse += 1) {
          const references = crossReferencesAt(ruthSet, 'rst', { book: 'Ruth', chapter, verse });
          const reference = references.find((candidate) => candidate.book !== 'Psalms' && coversChapter(candidate, 'rst'));
          if (reference) return { chapter, verse, reference, main: references.some(isMainReference) };
        }
      }
      throw new Error('No link of Ruth names a whole chapter');
    })();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: found.chapter, verse: found.verse }} onOpenBook={jest.fn()} />);
    const opener = found.main ? await screen.findByTestId(`cross-refs-${found.chapter}:${found.verse}`) : (await screen.findAllByRole('button', { name: 'bible.crossRefs.verseRefs' }))
      .find((button) => button.closest('[data-verse]')?.getAttribute('data-verse') === `${found.chapter}:${found.verse}`) as HTMLElement;
    await userEvent.click(opener);
    const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
    if (isMainReference(found.reference)) {
      await userEvent.click(within(list).getByText(label(found.reference)));
    } else {
      if (found.main) await userEvent.click(within(list).getByRole('button', { name: 'bible.crossRefs.othersSection' }));
      await userEvent.click(within(list).getByRole('button', { name: label(found.reference) }));
    }
    const link = screen.getByRole('dialog', { name: label(found.reference) });
    await waitFor(() => expect(within(link).getByText('bible.crossRefs.chapterEnd')).toBeInTheDocument());
    expect(within(link).getByText(/bible\.crossRefs\.scopeLinkChapter/)).toBeInTheDocument();
    expect(link.querySelectorAll('[data-arrival="on"]')).toHaveLength(0);
  });

  // A tablet turned, a window made lower: the card's pane changes height, and the passage must not slip
  // out of it unannounced (an independent review, 2026-10-20).
  it('the pane changing height: the passage comes back to the middle, or "back to the verse" shows once the person has scrolled', async () => {
    const watched = new Map<Element, () => void>();
    const shared = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element) { watched.set(target, this.callback); }
      unobserve() {}
      disconnect() {}
    };
    try {
      renderRuth();
      const list = await openLinksOfSubject();
      await userEvent.click(within(list).getByText(label(subject.outside)));
      const link = screen.getByRole('dialog', { name: label(subject.outside) });
      await waitFor(() => expect(within(link).getByText('bible.crossRefs.chapterEnd')).toBeInTheDocument());
      const pane = link.querySelector<HTMLElement>('div[tabindex="0"]') as HTMLElement;
      const lit = Array.from(link.querySelectorAll<HTMLElement>('[data-arrival="on"]'));
      expect(lit.length).toBeGreaterThan(0);
      // The passage stands 1000–1100 px down its chapter; the pane is 600 px high, then 300.
      let height = 600;
      let top = pane.scrollTop;
      Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => height });
      Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 3000 });
      Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
      for (const row of lit) row.getBoundingClientRect = () => ({ top: 1000 - top, bottom: 1100 - top }) as DOMRect;
      const resized = () => act(() => watched.get(pane)?.());

      // Not scrolled: it comes back to the middle of the new height.
      resized();
      expect(top).toBe(restingScrollTop({ top: 1000, bottom: 1100 }, 600, 3000));

      // Scrolled, the passage still in sight; the pane made lower puts it below — the way back shows.
      top = 650;
      fireEvent.scroll(pane);
      expect(within(link).queryByText('bible.sheet.backToPassage')).not.toBeInTheDocument();
      height = 300;
      resized();
      expect(within(link).getByText('bible.sheet.backToPassage')).toBeInTheDocument();
    } finally {
      globalThis.ResizeObserver = shared;
    }
  });

  // The owner, 2026-10-19: "5 independent sources" read as nothing; the main and the rest already say it.
  it('says nowhere how many sources give a link', async () => {
    renderRuth();
    const list = await openLinksOfSubject();
    await userEvent.click(within(list).getByRole('button', { name: 'bible.crossRefs.othersSection' }));
    await userEvent.click(within(list).getByRole('switch', { name: 'bible.crossRefs.othersAsVerses' }));
    await userEvent.click(within(list).getByText(label(subject.main[0])));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.queryByText(/bible\.crossRefs\.sources/)).not.toBeInTheDocument();
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
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: false, mode: 'main', othersAsVerses: false });
    saveCrossReferencePrefs({ inWindow: true });
    resetCrossReferencePrefsForTests();
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: true, mode: 'main', othersAsVerses: false });
    window.localStorage.setItem('bible:cross-references', '{not json');
    resetCrossReferencePrefsForTests();
    expect(readCrossReferencePrefs()).toEqual({ show: true, inWindow: false, mode: 'main', othersAsVerses: false });
  });

  // The owner's iPad, 2026-10-17: "on" was saved three times in a row without an error, never "off",
  // and each time the switch went back to off a moment later. Storage that reads back an old value
  // must not take the choice off the screen.
  it('keeps a choice drawn as saved even when browser storage reads back the old one', () => {
    const { result, rerender } = renderHook(() => useCrossReferencePrefs());
    expect(result.current.othersAsVerses).toBe(false);
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    try {
      act(() => saveCrossReferencePrefs({ othersAsVerses: true }, 'window'));
      expect(result.current.othersAsVerses).toBe(true);
      rerender();
      expect(result.current.othersAsVerses).toBe(true);
      expect(readCrossReferencePrefs().othersAsVerses).toBe(true);
    } finally {
      getItem.mockRestore();
    }
    expect(diagnosticEvents().at(-1)?.data).toEqual({ source: 'window', code: 'crossRefs-othersAsVerses', result: 'on-not-read-back' });
  });

  it('takes a choice another tab of the app made', () => {
    const { result } = renderHook(() => useCrossReferencePrefs());
    act(() => saveCrossReferencePrefs({ othersAsVerses: true }, 'window'));
    // Another tab's record carries the moment of its action, later than this page's save.
    const other = JSON.stringify({ show: true, inWindow: false, mode: 'all', othersAsVerses: false, __savedAt: Date.now() + 1000 });
    act(() => {
      window.localStorage.setItem('bible:cross-references', other);
      window.dispatchEvent(new StorageEvent('storage', { key: 'bible:cross-references', newValue: other, storageArea: window.localStorage }));
    });
    expect(result.current).toEqual({ show: true, inWindow: false, mode: 'all', othersAsVerses: false });
  });

  // The owner, 2026-10-20: the "T" is about the text; the Bible's settings moved to Settings → Bible, and
  // the "T" leads there in one tap.
  it('the reader\'s "T" holds the text size and the way to Settings → Bible, not the Bible\'s settings', async () => {
    render(
      <TextScaleProvider>
        <BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: subject.chapter, verse: subject.verse }} onOpenBook={jest.fn()} />
      </TextScaleProvider>
    );
    await screen.findByTestId(`cross-refs-${key}`);
    await userEvent.click(await screen.findByLabelText('Text size'));
    const menu = screen.getByRole('group', { name: 'Text size' });
    expect(within(menu).getByRole('slider', { name: 'Text size slider' })).toBeInTheDocument();
    expect(within(menu).queryByTestId('cross-reference-settings')).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'bible.settingsLink' })).toHaveAttribute('href', '/settings/bible');
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
