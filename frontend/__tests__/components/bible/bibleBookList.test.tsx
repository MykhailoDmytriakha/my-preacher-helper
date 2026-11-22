import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookList } from '@/components/bible/BibleBookList';
import { arriveOnTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { BOOK_PART_TONES } from '@/utils/themeColors';
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
    // Nothing is read on the list: the place stopped at is the light's link, drawn like every other.
    expect(within(trail).getByRole('button', { name: label('Joshua', 2, 11) })).toHaveAttribute('data-trail-at');
    expect(trail.querySelector('[aria-current]')).toBeNull();
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

  // The owner, 2026-11-21 (canvas «Библия — группы книг», board «Итог»): the parts of a group stand apart by colour.
  it('colours the books of a split group by part, Philemon among the letters from prison, and leaves a whole group plain', () => {
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    const paul = screen.getByRole('heading', { name: 'bible.groups.paulineEpistles' }).parentElement as HTMLElement;
    const books = within(paul).getAllByRole('button').map((button) => button.textContent);
    expect(books.indexOf('Philemon')).toBe(books.indexOf('Colossians') + 1);
    expect(within(paul).getByRole('button', { name: 'Romans' })).toHaveClass(...BOOK_PART_TONES[0].chip.split(' '));
    expect(within(paul).getByRole('button', { name: 'Philemon' })).toHaveClass(...BOOK_PART_TONES[1].chip.split(' '));
    expect(within(paul).getByRole('button', { name: 'Hebrews' })).toHaveClass(...BOOK_PART_TONES[4].chip.split(' '));
    // Colour is for the eye; a screen reader hears each part as a list under its name.
    const prison = within(paul).getByRole('list', { name: 'bible.bookParts.prisonEpistles.name' });
    expect(within(prison).getAllByRole('button').map((button) => button.textContent)).toEqual(['Ephesians', 'Philippians', 'Colossians', 'Philemon']);
    // A part is kept whole — a wrapping box of its own, not books poured into one flow — and parts stand further
    // apart than books, as on the canvas board (owner, 2026-11-21: «сделай как на Canvas»).
    expect(prison).toHaveClass('flex', 'flex-wrap', 'gap-1.5');
    expect(prison).not.toHaveClass('contents');
    expect(prison.parentElement).toHaveClass('flex', 'flex-wrap', 'gap-x-3', 'gap-y-1.5');
    // Lines are the owner's: 1 John begins a line, Jude goes on after 3 John.
    const list = (name: string) => screen.getByRole('list', { name: `bible.bookParts.${name}.name` });
    expect(list('john').parentElement).toBe(list('jude').parentElement);
    expect(list('james').parentElement).toBe(list('peter').parentElement);
    expect(list('john').parentElement).not.toBe(list('james').parentElement);

  });

  it('lights a book whose window is open in its part\'s colour, and a book of a whole group in the indigo', async () => {
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    const philemon = screen.getByRole('button', { name: 'Philemon' });
    // A hold rises in the part's colour too.
    fireEvent(philemon, Object.defineProperties(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 }), { pointerType: { value: 'touch' }, pointerId: { value: 1 } }));
    expect(philemon.querySelector('span[aria-hidden="true"]')).toHaveClass(BOOK_PART_TONES[1].fill, 'h-full');
    fireEvent(philemon, Object.defineProperties(new MouseEvent('pointercancel', { bubbles: true, cancelable: true }), { pointerType: { value: 'touch' }, pointerId: { value: 1 } }));
    await userEvent.click(philemon);
    expect(philemon).toHaveClass(...BOOK_PART_TONES[1].selected.split(' '));
    await userEvent.keyboard('{Escape}');
    expect(philemon).toHaveClass(...BOOK_PART_TONES[1].chip.split(' '));

    const genesis = screen.getByRole('button', { name: 'Genesis' });
    await userEvent.click(genesis);
    expect(genesis).toHaveClass('bg-indigo-50');
    await userEvent.keyboard('{Escape}');
  });

  it('leaves a whole group plain', () => {
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    const law = screen.getByRole('heading', { name: 'bible.groups.law' }).parentElement as HTMLElement;
    expect(within(law).getByRole('button', { name: 'Genesis' })).toHaveClass('bg-white');
    expect(within(law).getByRole('button', { name: 'Genesis' })).not.toHaveClass('bg-blue-100');
  });

  it('tells how to remember a Testament\'s order of books in a window from «?», closed by its ✕ and by Escape', async () => {
    render(<BibleBookList bible="rst" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'bible.bookGroupsHelp.title.new' }));
    const memo = screen.getByRole('dialog', { name: 'bible.bookGroupsHelp.title.new' });
    // The groups in the order this Bible prints them; a split group with its parts, each beside its colour.
    expect(within(memo).getAllByText(/^\d+\. bible\.groups\./).map((step) => step.textContent)).toEqual([
      '1. bible.groups.gospels', '2. bible.groups.acts', '3. bible.groups.generalEpistles', '4. bible.groups.paulineEpistles', '5. bible.groups.revelation',
    ]);
    const prison = within(memo).getByText('bible.bookParts.prisonEpistles.name').closest('li') as HTMLElement;
    expect(prison).toHaveTextContent('bible.bookParts.prisonEpistles.memo');
    expect(prison.querySelector('[aria-hidden="true"]')).toHaveClass(...BOOK_PART_TONES[1].swatch.split(' '));

    await userEvent.click(within(memo).getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bible.bookGroupsHelp.title.new' })).toHaveFocus();

    const old = screen.getByRole('button', { name: 'bible.bookGroupsHelp.title.old' });
    await userEvent.click(old);
    expect(old).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'bible.bookGroupsHelp.title.old' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(old).toHaveFocus();

    // A press beside the window closes it too, and the focus comes back to «?» even when the press gave «?» no
    // focus (Safari): it is opened here from a focus elsewhere.
    screen.getByRole('button', { name: 'Genesis' }).focus();
    fireEvent.click(old);
    expect(screen.getByRole('dialog', { name: 'bible.bookGroupsHelp.title.old' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.closePicker' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(old).toHaveFocus();
  });

  it('numbers the memo in the order of the Bible read: King James puts Paul\'s letters before the general ones', async () => {
    render(<BibleBookList bible="kjv" lastPlace={null} onOpen={jest.fn()} onChangeBible={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'bible.bookGroupsHelp.title.new' }));
    const memo = screen.getByRole('dialog', { name: 'bible.bookGroupsHelp.title.new' });
    expect(within(memo).getAllByText(/^\d+\. bible\.groups\./).map((step) => step.textContent)).toEqual([
      '1. bible.groups.gospels', '2. bible.groups.acts', '3. bible.groups.paulineEpistles', '4. bible.groups.generalEpistles', '5. bible.groups.revelation',
    ]);
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
    expect(links[0]).toHaveAttribute('data-trail-at');
    expect(trail.querySelector('[aria-current]')).toBeNull();
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
