import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookList } from '@/components/bible/BibleBookList';
import { arriveOnTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { placeIn } from '@/utils/versification';

/*
 * The list of books: in place of "Continue" the trail of places, the place the person stopped lit; a link
 * opens its place in the Bible being read. A device with no trail yet keeps "Continue" (the owner,
 * 2026-10-20, case 2026-10-12-block-diagram, 2.14).
 */
beforeEach(() => {
  window.matchMedia = jest.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.localStorage.clear();
  resetPlaceTrailForTests();
});

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

  it('keeps "Continue" on a device with no trail yet', async () => {
    const onOpen = jest.fn();
    render(<BibleBookList bible="rst" lastPlace={lastPlace} onOpen={onOpen} onChangeBible={jest.fn()} />);

    expect(screen.queryByRole('navigation', { name: 'bible.trail.title' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.continueReading' }));
    expect(onOpen).toHaveBeenCalledWith('matthew', { chapter: 1, verse: 2 });
  });
});
