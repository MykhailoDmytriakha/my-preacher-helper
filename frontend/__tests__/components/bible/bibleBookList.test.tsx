import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookList } from '@/components/bible/BibleBookList';
import { arriveOnTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { placeIn, verseCount } from '@/utils/versification';

/*
 * The list of books: in place of "Continue" the trail of places, the place the person stopped lit; a link
 * opens its place in the Bible being read. A device with no trail yet keeps "Continue" (the owner,
 * 2026-10-20, case 2026-10-12-block-diagram, 2.14).
 */
/** The screen's width: a `(min-width: …)` query holds from its width up; any other query does not. */
let screenWidth = 390;

beforeEach(() => {
  screenWidth = 390;
  window.matchMedia = jest.fn((query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= screenWidth, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.localStorage.clear();
  resetPlaceTrailForTests();
  // The window asks for the book's text, for how chapters begin; none is served here.
  global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
});

/** A finger held half a second, then lifted. jsdom has no PointerEvent: a mouse event under its name (`marks.test.tsx`). */
async function hold(target: Element) {
  const pointer = (type: 'pointerdown' | 'pointerup') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 });
    Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } });
    fireEvent(target, event);
  };
  pointer('pointerdown');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 30)); });
  pointer('pointerup');
}
const tile = (window_: HTMLElement, number: string) => within(window_).getByText(number, { selector: 'span' }).closest('button') as HTMLElement;

const label = (book: string, chapter: number, verse: number) => `${getLocalizedAbbrev(book, 'en')} ${chapter}:${verse}`;
const lastPlace = { slug: 'matthew', chapter: 1, verse: 2, bible: 'rst' as const };

describe('BibleBookList', () => {
  it('shows the trail in place of "Continue", the place the person stopped lit, and a link opens its place', async () => {
    arriveOnTrail({ book: 'Isaiah', chapter: 19, verse: 1, bible: 'rst' });
    arriveOnTrail({ book: 'Exodus', chapter: 12, verse: 12, bible: 'rst' });
    arriveOnTrail({ book: 'Joshua', chapter: 2, verse: 11, bible: 'rst' });
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={lastPlace} onOpen={onOpen} onChangeBible={jest.fn()} />);

    const trail = screen.getByRole('navigation', { name: 'bible.trail.title' });
    const links = within(trail).getAllByRole('button').map((button) => button.textContent);
    expect(links).toEqual([label('Isaiah', 19, 1), label('Exodus', 12, 12), label('Joshua', 2, 11)]);
    expect(within(trail).getByRole('button', { name: label('Joshua', 2, 11) })).toHaveAttribute('aria-current', 'location');
    expect(screen.queryByRole('button', { name: 'bible.continueReading' })).not.toBeInTheDocument();

    await userEvent.click(within(trail).getByRole('button', { name: label('Exodus', 12, 12) }));
    expect(onOpen).toHaveBeenCalledWith('exodus', { chapter: 12, verse: 12 });
  });

  it('says a link kept in another Bible in the numbering of the Bible being read, and opens it there', async () => {
    arriveOnTrail({ book: 'Psalms', chapter: 23, verse: 1, bible: 'kjv' });
    const inSynodal = placeIn('rst', 'kjv', { book: 'Psalms', chapter: 23, verse: 1 });
    expect(inSynodal?.chapter).toBe(22);
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={onOpen} onChangeBible={jest.fn()} />);

    const trail = screen.getByRole('navigation', { name: 'bible.trail.title' });
    await userEvent.click(within(trail).getByRole('button', { name: label('Psalms', 22, inSynodal!.verse) }));
    expect(onOpen).toHaveBeenCalledWith('psalms', { chapter: 22, verse: inSynodal!.verse });
  });

  // The owner, 2026-10-23: a book on this list works as one in the reader's window — a press goes a step on, a hold opens.
  it('opens a book\'s chapters in a window when pressed, a chapter\'s verses next, and a verse there, lit', async () => {
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={onOpen} onChangeBible={jest.fn()} />);
    expect(screen.getByText('bible.holdBookHint')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Romans' }));
    const chapters = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
    expect(within(chapters).getAllByRole('button', { name: 'bible.chapter' })).toHaveLength(16);
    expect(onOpen).not.toHaveBeenCalled();

    await userEvent.click(tile(chapters, '8'));
    const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
    expect(within(verses).getAllByRole('button', { name: 'bible.verseNumber' })).toHaveLength(verseCount('rst', 'Romans', 8));
    await userEvent.click(tile(verses, '28'));
    expect(onOpen).toHaveBeenCalledWith('romans', { chapter: 8, verse: 28, toVerse: 28 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a book held at its start, and a chapter held in its window at that chapter\'s start', async () => {
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={onOpen} onChangeBible={jest.fn()} />);

    await hold(screen.getByRole('button', { name: 'Genesis' }));
    expect(onOpen).toHaveBeenLastCalledWith('genesis', { chapter: 1, verse: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Romans' }));
    await hold(tile(screen.getByRole('dialog'), '5'));
    expect(onOpen).toHaveBeenLastCalledWith('romans', { chapter: 5, verse: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fills where the person stopped when that book is pressed, and shows a book of one chapter at its verses', async () => {
    render(<BibleBookList bible="rst" lastPlace={lastPlace} onOpen={jest.fn()} onChangeBible={jest.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Matthew' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { current: true })).toHaveTextContent('1');
    await userEvent.click(tile(screen.getByRole('dialog'), '1'));
    expect(within(screen.getByRole('dialog', { name: 'bible.chooseVerse' })).getByRole('button', { current: true })).toHaveTextContent('2');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Jude' }));
    expect(screen.getByRole('dialog', { name: 'bible.chooseVerse' })).toBeInTheDocument();
  });

  it('closes a book\'s window on Escape, and leaves «Как искать» open over the line alone', async () => {
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.help' }));
    expect(screen.getByText('bible.search.sections.where')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Romans' }));
    expect(screen.getByRole('dialog', { name: 'bible.chooseChapter' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('bible.search.sections.where')).toBeInTheDocument();
  });

  it('keeps "Continue" on a device with no trail yet', async () => {
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={lastPlace} onOpen={onOpen} onChangeBible={jest.fn()} />);

    expect(screen.queryByRole('navigation', { name: 'bible.trail.title' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.continueReading' }));
    expect(onOpen).toHaveBeenCalledWith('matthew', { chapter: 1, verse: 2 });
  });
});

// The owner, 2026-10-26: as in the reader, on a wide screen the trail stands as a column in the empty margin,
// left of the Testaments, newest on top.
describe('BibleBookList — the trail as a column on a wide screen', () => {
  const threePlaces = () => {
    arriveOnTrail({ book: 'Isaiah', chapter: 19, verse: 1, bible: 'rst' });
    arriveOnTrail({ book: 'Exodus', chapter: 12, verse: 12, bible: 'rst' });
    arriveOnTrail({ book: 'Joshua', chapter: 2, verse: 11, bible: 'rst' });
  };

  it('from 1024 px stands left of the Testaments, newest on top, the page widened by it, and a link opens its place', async () => {
    screenWidth = 1680;
    threePlaces();
    const onOpen = jest.fn();
    const { container } = render(<BibleBookList bible="rst" lastPlace={lastPlace} onOpen={onOpen} onChangeBible={jest.fn()} />);

    const trail = screen.getByRole('navigation', { name: 'bible.trail.title' });
    const links = within(trail).getAllByRole('button');
    expect(links.map((link) => link.textContent)).toEqual([label('Joshua', 2, 11), label('Exodus', 12, 12), label('Isaiah', 19, 1)]);
    expect(links[0]).toHaveAttribute('aria-current', 'location');
    expect(container.firstElementChild).toHaveClass('max-w-[1464px]');
    // The column and the Testaments share one row: the column is not a band above them.
    expect(trail.parentElement?.parentElement).toContainElement(screen.getByRole('region', { name: 'bible.oldTestament' }));

    await userEvent.click(links[1]);
    expect(onOpen).toHaveBeenCalledWith('exodus', { chapter: 12, verse: 12 });
  });

  it('its switch is kept on the device and widens the page; the places stay when their texts cannot be had', async () => {
    screenWidth = 1680;
    threePlaces();
    const { container } = render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    const trail = screen.getByRole('navigation', { name: 'bible.trail.title' });
    const verseStart = within(trail).getByRole('switch', { name: 'bible.trail.verseStart' });
    expect(verseStart).not.toBeChecked();

    await userEvent.click(verseStart);
    expect(verseStart).toBeChecked();
    expect(container.firstElementChild).toHaveClass('max-w-[1544px]');
    expect(within(trail).getAllByRole('button')).toHaveLength(3);
    expect(JSON.parse(window.localStorage.getItem('bible:place-trail-prefs') ?? '{}')).toEqual(expect.objectContaining({ verseStart: true }));
  });

  it('below 1024 px (an iPad standing) stays the row above the Testaments, without the switch', () => {
    screenWidth = 820;
    threePlaces();
    const { container } = render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    const trail = screen.getByRole('navigation', { name: 'bible.trail.title' });
    expect(within(trail).getAllByRole('button').map((link) => link.textContent)).toEqual([label('Isaiah', 19, 1), label('Exodus', 12, 12), label('Joshua', 2, 11)]);
    expect(within(trail).queryByRole('switch')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('max-w-7xl');
  });
});
