import { ReaderShell } from '../../../test-utils/reader-shell';
import { act, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { arriveOnTrail, readPlaceTrail, resetPlaceTrailForTests, stepOnTrail } from '@/components/bible/placeTrailStore';
import { closeFound, showFound } from '@/components/bible/search/foundInBible';
import { bibleCrossRefsBase } from '@/utils/bibleCrossRefsCache';
import { crossReferenceLabel, crossReferencesAt, forgetLoadedCrossRefs, isMainReference, type CrossRefsBook } from '@/utils/crossReferences';

import { verseWords, type BookText } from '@/utils/bibleText';

const render = (ui: React.ReactNode, options?: Parameters<typeof renderUI>[1]) => renderUI(ui, { wrapper: ReaderShell, ...options });

// The reader's marks keep one form of the data engine per book; these tests mount no engine.
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));

/*
 * The trail of places in the Bible reader, on the real files of Ruth and its cross references: a link
 * followed within the book adds a link to the trail, the way back only lights the place left, a link of
 * the trail opens its place (the owner, 2026-10-20, case 2026-10-12-block-diagram, 2.12).
 */
const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const ruthSet: CrossRefsBook = publicFile(`${bibleCrossRefsBase.slice(1)}/ruth.json`);
const ruthText: BookText = publicFile('bible-text/rst/v1/ruth.json');

/** A verse of Ruth with a main link into another chapter of Ruth. */
const subject = (() => {
  for (let chapter = 1; chapter <= ruthText.chapters.length; chapter += 1) {
    for (let verse = 1; verse <= ruthText.chapters[chapter - 1].length; verse += 1) {
      const inside = crossReferencesAt(ruthSet, 'rst', { book: 'Ruth', chapter, verse })
        .find((reference) => isMainReference(reference) && reference.book === 'Ruth' && reference.chapter !== chapter);
      if (inside) return { chapter, verse, inside };
    }
  }
  throw new Error('No verse of Ruth links to another chapter of Ruth');
})();

/** A verse of Ruth with a main link to another verse of its own chapter. */
const withinChapter = (() => {
  for (let chapter = 1; chapter <= ruthText.chapters.length; chapter += 1) {
    for (let verse = 1; verse <= ruthText.chapters[chapter - 1].length; verse += 1) {
      const near = crossReferencesAt(ruthSet, 'rst', { book: 'Ruth', chapter, verse })
        .find((reference) => isMainReference(reference) && reference.book === 'Ruth' && reference.chapter === chapter);
      if (near) return { chapter, verse, near };
    }
  }
  throw new Error('No verse of Ruth links within its own chapter');
})();

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });

/** The screen's width: a `(min-width: …)` query holds from its width up; any other query does not. */
let screenWidth = 390;

beforeEach(() => {
  screenWidth = 390;
  window.matchMedia = jest.fn((query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= screenWidth, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
  closeFound();
  forgetLoadedCrossRefs();
  global.fetch = jest.fn(async (url: string) => answer(publicFile(url.slice(1)))) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

const renderRuth = () => render(
  <BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: subject.chapter, verse: subject.verse }} onOpenBook={jest.fn()} />
);

/** From the verse to its link within Ruth: the list, the link's card, "Open". */
const followTheLink = async () => {
  await userEvent.click(await screen.findByTestId(`cross-refs-${subject.chapter}:${subject.verse}`));
  const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
  await userEvent.click(within(list).getByText(crossReferenceLabel(subject.inside, 'rst', 'en')));
  await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
  await waitFor(() => expect(readPlaceTrail().links).toHaveLength(2));
};

const trailLinks = () => within(screen.getByRole('navigation', { name: 'bible.trail.title' })).getAllByRole('button');
/** The light's link — the one the way back counts from; shown lit only while its verse is on the screen. */
const lit = () => trailLinks().findIndex((link) => link.hasAttribute('data-trail-at'));
const shownLit = () => trailLinks().findIndex((link) => link.getAttribute('aria-current') === 'location');

/** Lays the rows of the ribbon out, 40 px each, `top` at the reading line, and scrolls the page there. */
function scrollTo(top: string) {
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const verse = this.dataset?.verse;
    if (!verse) return realRect.call(this);
    const order = Array.from(document.querySelectorAll<HTMLElement>('[data-verse]')).map((row) => row.dataset.verse);
    const y = 16 + (order.indexOf(verse) - order.indexOf(top)) * 40;
    return { top: y, bottom: y + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(window, 'scrollY', { value: 5000 + Math.random(), configurable: true });
  act(() => { window.dispatchEvent(new Event('scroll')); });
  return () => {
    Element.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  };
}

describe('the trail of places in the reader', () => {
  it('the book opened is the first link; a trail of one link has no button', async () => {
    renderRuth();
    await screen.findByTestId(`cross-refs-${subject.chapter}:${subject.verse}`);
    expect(readPlaceTrail().links).toEqual([{ book: 'Ruth', chapter: subject.chapter, verse: subject.verse, bible: 'rst' }]);
    expect(screen.queryByRole('button', { name: 'bible.trail.toggle' })).not.toBeInTheDocument();
  });

  it('a link followed within the book joins the trail; its header button opens a left drawer, newest first', async () => {
    renderRuth();
    await followTheLink();
    const toggle = await screen.findByRole('button', { name: 'bible.trail.toggle' });
    expect(toggle).toHaveTextContent('2');
    expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'bible.trail.title' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(trailLinks()).toHaveLength(2);
    expect(lit()).toBe(0);
    expect(readPlaceTrail().links[1]).toEqual(expect.objectContaining({ book: 'Ruth', chapter: subject.inside.chapter, verse: subject.inside.fromVerse }));

    const drawer = screen.getByRole('dialog', { name: 'bible.trail.title' });
    expect(within(drawer).getByRole('navigation').parentElement).toHaveClass('left-0', 'h-dvh', 'w-[min(300px,80vw)]');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('the drawer keeps keyboard focus inside and closes on its backdrop', async () => {
    renderRuth();
    await followTheLink();
    const toggle = screen.getByRole('button', { name: 'bible.trail.toggle' });
    expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(toggle);
    const drawer = screen.getByRole('dialog', { name: 'bible.trail.title' });
    expect(within(drawer).getByRole('switch', { name: 'bible.trail.verseStart' })).toBeInTheDocument();
    for (let press = 0; press < 7; press += 1) {
      await userEvent.tab();
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(screen.getByTestId('trail-drawer-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('the way back to the verse only lights its link: nothing is added', async () => {
    renderRuth();
    await followTheLink();
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    expect(readPlaceTrail().links).toHaveLength(2);
    expect(readPlaceTrail().at).toBe(0);
  });

  // The owner, 2026-10-20: "←" swapped between the last two places and never reached Zeph 3:10 on the trail.
  it('the way back goes left along the trail link by link, adding nothing, and the first link has none', async () => {
    arriveOnTrail({ book: 'Ruth', chapter: 1, verse: 1, bible: 'rst' });
    arriveOnTrail({ book: 'Ruth', chapter: 2, verse: 3, bible: 'rst' });
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 4, verse: 2 }} onOpenBook={jest.fn()} />);
    await waitFor(() => expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 2 })));
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 1 }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 0 }));
    expect(readPlaceTrail().links.map((link) => link.chapter)).toEqual([1, 2, 4]);
    expect(screen.queryByRole('button', { name: 'bible.backToLabel' })).not.toBeInTheDocument();
  });

  it('a link of the trail opens its place, and going there again and again adds nothing', async () => {
    renderRuth();
    await followTheLink();
    for (const index of [0, 1, 0, 1]) {
      await userEvent.click(screen.getByRole('button', { name: 'bible.trail.toggle' }));
      await userEvent.click(trailLinks()[1 - index]);
      await waitFor(() => expect(readPlaceTrail().at).toBe(index));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(readPlaceTrail().links).toHaveLength(2);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  // An independent review, 2026-10-20: a note → Ruth → Romans → "← Ruth" lost the way back to the note,
  // which lived only in the first entry's address.
  it('the way back from a link opened from a note goes to the note, also after another book and a step back', async () => {
    const push = jest.fn();
    const navigation = jest.requireMock<{ useRouter: () => unknown }>('next/navigation');
    const useRouter = jest.spyOn(navigation, 'useRouter').mockReturnValue({ push });
    try {
      const first = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} cameFrom="/studies/n1" onOpenBook={jest.fn()} />);
      await waitFor(() => expect(readPlaceTrail().links[0]).toEqual(expect.objectContaining({ book: 'Ruth', screen: '/studies/n1' })));
      first.unmount();
      // The next book opened, then the way back stepped onto Ruth again: its entry knows no note.
      arriveOnTrail({ book: 'Romans', chapter: 5, verse: 9, bible: 'rst' });
      stepOnTrail(0);
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} onOpenBook={jest.fn()} />);
      await waitFor(() => expect(readPlaceTrail().at).toBe(0));
      await userEvent.click(await screen.findByRole('button', { name: 'bible.backToLabel' }));
      expect(push).toHaveBeenCalledWith('/studies/n1');
      expect(readPlaceTrail().links).toHaveLength(2);
    } finally {
      useRouter.mockRestore();
    }
  });

  // The same review: after a link within the chapter, the minimap or a scroll into another chapter kept
  // "← <verse>" and took the person back there instead of along the trail.
  // Since 2026-10-27 the verse a link was opened from is a link of the trail itself: the way back reaches it
  // along the trail, whatever the reading did meanwhile.
  it('after a link within the chapter, reading into another chapter adds nothing and the way back still goes to the verse it was opened from', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: withinChapter.chapter, verse: withinChapter.verse }} onOpenBook={jest.fn()} />);
    await userEvent.click(await screen.findByTestId(`cross-refs-${withinChapter.chapter}:${withinChapter.verse}`));
    const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
    await userEvent.click(within(list).getByText(crossReferenceLabel(withinChapter.near, 'rst', 'en')));
    await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
    expect(await screen.findByRole('button', { name: 'bible.backToLabel' })).toBeInTheDocument();
    // A verse is a place of its own (the owner, 2026-10-27): the verse linked to joined the trail.
    expect(readPlaceTrail().links).toHaveLength(2);

    // The person reads on into the next chapter: the verse at the reading top is its first one.
    const other = withinChapter.chapter === ruthText.chapters.length ? 1 : withinChapter.chapter + 1;
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const verse = this.dataset?.verse;
      if (!verse) return realRect.call(this);
      const order = Array.from(document.querySelectorAll<HTMLElement>('[data-verse]')).map((row) => row.dataset.verse);
      const top = 16 + (order.indexOf(verse) - order.indexOf(`${other}:1`)) * 40;
      return { top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    try {
      Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      await waitFor(() => expect(readPlaceTrail().links).toHaveLength(2));
      await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
      const trail = readPlaceTrail();
      expect(trail.links[trail.at]).toEqual(expect.objectContaining({ chapter: withinChapter.chapter, verse: withinChapter.verse }));
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });
});

// The owner, 2026-10-27: reading writes nothing on the trail; a link is lit only while one stands on its verse;
// leaving, the verse one stopped at joins the trail.
describe('the trail follows acts and moves, never the reading', () => {
  it('a link is lit only while its verse is on the screen; scrolling adds nothing; leaving adds the verse stopped at', async () => {
    arriveOnTrail({ book: 'Ruth', chapter: 1, verse: 1, bible: 'rst' });
    arriveOnTrail({ book: 'Ruth', chapter: 2, verse: 3, bible: 'rst' });
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 4, verse: 2 }} onOpenBook={jest.fn()} />);
    await waitFor(() => expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 2 })));
    await userEvent.click(await screen.findByRole('button', { name: 'bible.trail.toggle' }));

    let restore = scrollTo('4:2');
    try {
      await waitFor(() => expect(shownLit()).toBe(0));
    } finally {
      restore();
    }
    restore = scrollTo('4:12');
    try {
      await waitFor(() => expect(shownLit()).toBe(-1));
      expect(readPlaceTrail().links.map((link) => `${link.chapter}:${link.verse}`)).toEqual(['1:1', '2:3', '4:2']);
      expect(lit()).toBe(0);
      await userEvent.click(trailLinks()[1]);
      await waitFor(() => expect(readPlaceTrail().links.map((link) => `${link.chapter}:${link.verse}`)).toEqual(['1:1', '2:3', '4:2', '4:12']));
      expect(readPlaceTrail().at).toBe(1);
    } finally {
      restore();
    }
  });

  // Codex review, 2026-10-27: an iPhone's installed app is only hidden, never closed — no pagehide comes.
  it('the app put away keeps the verse stopped at, as leaving does', async () => {
    arriveOnTrail({ book: 'Ruth', chapter: 1, verse: 1, bible: 'rst' });
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 4, verse: 2 }} onOpenBook={jest.fn()} />);
    await waitFor(() => expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 1 })));
    const restore = scrollTo('4:12');
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(readPlaceTrail().links.map((link) => `${link.chapter}:${link.verse}`)).toEqual(['1:1', '4:2', '4:12']);
      expect(readPlaceTrail().at).toBe(1);
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      restore();
    }
  });

  // Codex review, 2026-10-27: after a link within the chapter, an act on another verse left "← to the first verse"
  // standing, and the way back skipped the verse the link had led to.
  it('an act on a verse after a link within the chapter makes the way back go along the trail from it', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: withinChapter.chapter, verse: withinChapter.verse }} onOpenBook={jest.fn()} />);
    await userEvent.click(await screen.findByTestId(`cross-refs-${withinChapter.chapter}:${withinChapter.verse}`));
    const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
    await userEvent.click(within(list).getByText(crossReferenceLabel(withinChapter.near, 'rst', 'en')));
    await userEvent.click(screen.getByRole('button', { name: 'bible.crossRefs.open' }));
    await waitFor(() => expect(readPlaceTrail().links).toHaveLength(2));
    // Another verse's links opened: an act on it.
    const other = ruthText.chapters[withinChapter.chapter - 1].findIndex((_, index) => index + 1 !== withinChapter.verse && index + 1 !== withinChapter.near.fromVerse
      && document.querySelector(`[data-testid="cross-refs-${withinChapter.chapter}:${index + 1}"]`)) + 1;
    await userEvent.click(screen.getByTestId(`cross-refs-${withinChapter.chapter}:${other}`));
    await userEvent.keyboard('{Escape}');
    expect(readPlaceTrail().links).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    const trail = readPlaceTrail();
    expect(trail.links[trail.at]).toEqual(expect.objectContaining({ chapter: withinChapter.near.chapter, verse: withinChapter.near.fromVerse }));
  });
});

/** Ruth 1:1 → 2:3 → 4:2, the reader open at the last: three links, the last lit. */
const renderThreePlaces = async () => {
  arriveOnTrail({ book: 'Ruth', chapter: 1, verse: 1, bible: 'rst' });
  arriveOnTrail({ book: 'Ruth', chapter: 2, verse: 3, bible: 'rst' });
  const view = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 4, verse: 2 }} onOpenBook={jest.fn()} />);
  await waitFor(() => expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 2 })));
  await userEvent.click(screen.getByRole('button', { name: 'bible.trail.toggle' }));
  return { reader: view.container.querySelector('[data-reader-panes]'), trail: screen.getByRole('navigation', { name: 'bible.trail.title' }) };
};

// The owner, 2026-10-26 (canvas v67, row «История слева»): on a wide screen the trail moves into the empty
// margin left of the text, newest on top, and the verse's start comes only with the switch.
describe('the trail as a column on a wide screen', () => {
  it('from 1024 px the trail is a column left of the text, newest on top, the reader widened by it', async () => {
    screenWidth = 1680;
    const { reader, trail } = await renderThreePlaces();
    const links = within(trail).getAllByRole('button');
    expect(links.map((link) => link.textContent)).toEqual([expect.stringContaining('4:2'), expect.stringContaining('2:3'), expect.stringContaining('1:1')]);
    expect(links[0]).toHaveAttribute('data-trail-at');
    expect(trail.parentElement).toContainElement(reader?.querySelector('article') ?? null);
    expect(reader).toHaveClass('max-w-[1464px]');

    await userEvent.click(links[2]);
    expect(readPlaceTrail().at).toBe(0);
    expect(within(trail).getAllByRole('button')[2]).toHaveAttribute('data-trail-at');
  });

  // Codex review, 30.10: with the found verses in the column's place, the trail's button showed and hid a column not there.
  it('gives its place and its button to the found verses while they show; both come back when they close', async () => {
    screenWidth = 1680;
    await renderThreePlaces();
    act(() => showFound({ bible: 'rst', line: 'моавитянка', asWords: false }));
    expect(await screen.findByRole('navigation', { name: '«моавитянка»' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'bible.trail.title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bible.trail.toggle' })).not.toBeInTheDocument();
    // Each found verse of Ruth drawn is framed in the text; the one the reading stands at (4:2 → the last above it) thicker.
    const framed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-found]'));
    await waitFor(() => expect(framed().length).toBeGreaterThan(1), { timeout: 15000 });
    framed().forEach((row) => expect(row.textContent).toMatch(/оавитян/));
    expect(framed().filter((row) => row.dataset.found === 'at').map((row) => row.dataset.verse)).toEqual(['2:21']);

    act(() => closeFound());
    expect(screen.getByRole('navigation', { name: 'bible.trail.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bible.trail.toggle' })).toBeInTheDocument();
    expect(framed()).toHaveLength(0);
  }, 30000);

  // BUG-20261030-open-in-bible-shows-found-column: the blue «Открыть в Библии» opened the column too.
  it('opens a verse of the search window alone; only «Все N — в Библии» puts the found verses beside the text', async () => {
    screenWidth = 1680;
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={jest.fn()} />);
    const search = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'bible.search.openSearch' }));
      await userEvent.type(screen.getByRole('combobox'), 'моавитянка');
      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1), { timeout: 15000 });
    };
    await search();
    const [, second] = screen.getAllByRole('option');
    await userEvent.click(second);
    await userEvent.click(within(second).getByRole('button', { name: /bible\.search\.openInBible/, hidden: true }));
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
    expect(screen.queryByRole('navigation', { name: '«моавитянка»' })).not.toBeInTheDocument();

    await search();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.allInBible' }));
    expect(await screen.findByRole('navigation', { name: '«моавитянка»' })).toBeInTheDocument();
  }, 30000);

  // Codex review r3, 30.10: a verse of another search opened from the book window left the old search's column beside it.
  it('puts the found verses away when a verse of another search opens alone from the book window', async () => {
    screenWidth = 1680;
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={onOpenBook} />);
    act(() => showFound({ bible: 'rst', line: 'моавитянка', asWords: false }));
    expect(await screen.findByRole('navigation', { name: '«моавитянка»' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
    await userEvent.type(screen.getByRole('combobox'), '"хлеб жизни"');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2), { timeout: 15000 });
    const [, second] = screen.getAllByRole('option');
    await userEvent.click(second);
    await userEvent.click(within(second).getByRole('button', { name: /bible\.search\.openInBible/, hidden: true }));
    expect(onOpenBook).toHaveBeenCalledWith('john', expect.objectContaining({ chapter: 6, verse: 48 }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: '«моавитянка»' })).not.toBeInTheDocument());
  }, 30000);

  it('its switch puts the first words of each verse under the places, widens the column and is kept on the device', async () => {
    screenWidth = 1680;
    const { reader, trail } = await renderThreePlaces();
    const words = verseWords(ruthText.chapters[3][1]).trim();
    const verseStart = within(trail).getByRole('switch', { name: 'bible.trail.verseStart' });
    expect(verseStart).not.toBeChecked();
    expect(within(trail).getAllByRole('button')[0]).not.toHaveTextContent(words);

    await userEvent.click(verseStart);
    expect(verseStart).toBeChecked();
    await waitFor(() => expect(within(trail).getAllByRole('button')[0]).toHaveTextContent(words));
    expect(within(trail).getAllByRole('button')[1]).toHaveTextContent(verseWords(ruthText.chapters[1][2]).trim());
    expect(reader).toHaveClass('max-w-[1544px]');
    expect(JSON.parse(window.localStorage.getItem('bible:place-trail-prefs') ?? '{}')).toEqual(expect.objectContaining({ shown: true, verseStart: true }));
  });

  it('from 768 to 1024 px (an iPad standing) the trail stays a row under the book line, without the switch', async () => {
    screenWidth = 820;
    const { reader, trail } = await renderThreePlaces();
    expect(within(trail).getAllByRole('button').map((link) => link.textContent)).toEqual([expect.stringContaining('1:1'), expect.stringContaining('2:3'), expect.stringContaining('4:2')]);
    expect(within(trail).queryByRole('switch')).not.toBeInTheDocument();
    expect(reader).toHaveClass('max-w-7xl');
  });
});
