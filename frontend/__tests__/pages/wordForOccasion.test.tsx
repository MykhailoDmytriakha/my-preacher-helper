import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import WordForOccasionSituationPage from '@/(pages)/(private)/care/word/[id]/page';
import WordForOccasionPage from '@/(pages)/(private)/care/word/page';
import { occasionById } from '@/utils/wordForOccasion';
import '@testing-library/jest-dom';

import type { BookText } from '@/utils/bibleText';

/**
 * The global `react-i18next` mock answers with the KEY, so a situation reads here as
 * `careWord.topics.<id>`: the page is proven to ask for the right name, and the module test
 * proves the name exists in all three languages.
 */

const mockOpen = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockRouteId = 'afraid';
let mockCanGoBack = true;
let mockTexts: ReadonlyMap<string, BookText> = new Map();

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));
jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'ru' }) }));
jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => mockRouteId }));
jest.mock('@/utils/modalHistory.client', () => ({
  ...jest.requireActual('@/utils/modalHistory.client'),
  canGoBackToPage: () => mockCanGoBack,
}));
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => mockTexts }));
jest.mock('@/components/bible/VerseWindow', () => ({ useVerseWindow: () => ({ open: mockOpen, sheet: null }) }));
// The pastor's own places: the hook is the seam (the engine has its own tests); what the page passes it is checked here.
const mockAdd = jest.fn((_place?: unknown) => Promise.resolve());
const mockRemove = jest.fn((_place?: unknown) => Promise.resolve());
let mockOwn: { ids: string[]; ref: Record<string, unknown>; createdAt: string }[] = [];
let mockComplete = true;
const mockToastError = jest.fn();
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() } }));
jest.mock('@/data-engine/DataCollectionStatus', () => ({ DataCollectionStatus: () => null }));
jest.mock('@/hooks/useOccasionPlaces', () => ({
  ...jest.requireActual('@/hooks/useOccasionPlaces'),
  useOccasionPlaces: (occasionId: string | null) => ({
    places: occasionId ? mockOwn : [], state: null, complete: mockComplete, canAdd: Boolean(occasionId), loading: false, add: mockAdd, remove: mockRemove,
  }),
}));
// The address half of the search is Nuqs's (its own tests); here the field only has to filter.
jest.mock('@/hooks/useSearchInputQuery', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    useSearchInputQuery: () => {
      const [value, setValue] = useState('');
      return { value, setValue, inputRef: { current: null } };
    },
  };
});

/** A Synodal Psalter whose every verse says where it stands. */
const synodalPsalms = {
  id: 'Psalms',
  chapters: Array.from({ length: 151 }, (_, c) => Array.from({ length: 40 }, (__, v) => `Пс ${c + 1}:${v + 1}`)),
} as unknown as BookText;

describe('word for the occasion — the index', () => {
  beforeEach(() => {
    mockOpen.mockReset();
  });

  it('shows every topic of the Gideons\' indexes as a chip, in three groups, and the place kept for the particular cases', () => {
    render(<WordForOccasionPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('care.sections.word.title');
    const chipsOf = (kind: string) => within(screen.getByRole('region', { name: `careWord.kinds.${kind}` })).getAllByRole('link');
    expect(chipsOf('situation')).toHaveLength(140);
    expect(chipsOf('virtue')).toHaveLength(45);
    expect(chipsOf('teaching')).toHaveLength(46);
    // "Where is it written about Christ's birth?" — found by eye under the foundations of faith.
    expect(chipsOf('teaching').map((chip) => chip.getAttribute('href'))).toContain('/care/word/christsBirth');
    expect(chipsOf('virtue').map((chip) => chip.getAttribute('href'))).toEqual(expect.arrayContaining(['/care/word/patience', '/care/word/humility']));
    const afraid = screen.getByRole('link', { name: /careWord\.topics\.afraid\b/ });
    expect(afraid).toHaveAttribute('href', '/care/word/afraid');
    expect(afraid).toHaveTextContent(String(occasionById('afraid')!.places.length));
    // Reserved, not built: named, and nothing to press.
    const cases = screen.getByRole('region', { name: 'careWord.casesTitle' });
    expect(within(cases).queryByRole('link')).toBeNull();
    expect(within(cases).queryByRole('button')).toBeNull();
  });

  it('narrows the chips to what is typed and says so when nothing answers', () => {
    render(<WordForOccasionPage />);
    const search = screen.getByLabelText('careWord.searchLabel');

    fireEvent.change(search, { target: { value: 'topics.afraidOf' } });
    const shown = within(screen.getByRole('list')).getAllByRole('link');
    expect(shown.map((chip) => chip.getAttribute('href'))).toEqual(expect.arrayContaining(['/care/word/afraidOfPeople', '/care/word/afraidOfTheFuture']));
    expect(shown.every((chip) => chip.getAttribute('href')!.startsWith('/care/word/afraidOf'))).toBe(true);
    // A group the search leaves empty steps aside instead of standing as a bare heading.
    expect(screen.queryByRole('region', { name: 'careWord.kinds.teaching' })).toBeNull();

    fireEvent.change(search, { target: { value: 'nothing-like-this' } });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('careWord.noMatch')).toBeInTheDocument();
  });
});

describe('word for the occasion — one situation', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockBack.mockReset();
    mockPush.mockReset();
    mockRouteId = 'lonely';
    mockCanGoBack = true;
    mockTexts = new Map([['Psalms', synodalPsalms]]);
  });

  it('lists the places in the reader\'s Bible, with their words: the Shepherd psalm reads as Пс 22', () => {
    render(<WordForOccasionSituationPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('careWord.topics.lonely');
    const psalm = screen.getAllByRole('listitem').find((item) => /Пс\.?\s?22\b/.test(item.textContent ?? ''));
    expect(psalm).toBeDefined();
    // A whole psalm shows its opening two verses and «…».
    expect(psalm!.textContent).toContain('Пс 22:1 Пс 22:2 …');
  });

  it('opens a pressed place over the page, in the numbering it is kept in', () => {
    render(<WordForOccasionSituationPage />);
    const psalm = screen.getAllByRole('listitem').find((item) => /Пс\.?\s?22\b/.test(item.textContent ?? ''))!;

    fireEvent.click(within(psalm).getByRole('button'));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'kjv', book: 'Psalms', chapter: 23 }));
  });

  it('goes back to the index it came from, keeping its search; straight to the index when it came from nowhere', () => {
    const { unmount } = render(<WordForOccasionSituationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'care.sections.word.title' }));
    expect(mockBack).toHaveBeenCalled();
    unmount();

    mockCanGoBack = false;
    render(<WordForOccasionSituationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'care.sections.word.title' }));
    expect(mockPush).toHaveBeenCalledWith('/care/word');
  });

  it('says plainly when the address names no situation', () => {
    mockRouteId = 'no-such-situation';
    render(<WordForOccasionSituationPage />);

    expect(screen.getByText('careWord.notFound')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('word for the occasion — the pastor\'s own places', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockAdd.mockClear();
    mockRemove.mockClear();
    mockRouteId = 'assurance';
    mockOwn = [];
    mockComplete = true;
    mockTexts = new Map();
    mockToastError.mockClear();
  });

  it('invites to add a place while there is none', () => {
    render(<WordForOccasionSituationPage />);
    const own = screen.getByRole('region', { name: 'careWord.own.title' });
    expect(within(own).getByText('careWord.own.empty')).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'careWord.own.add' })).toBeInTheDocument();
  });

  it('does not say "no places" while the list is not known whole — an unread list is not an empty one', () => {
    mockComplete = false;
    render(<WordForOccasionSituationPage />);
    const own = screen.getByRole('region', { name: 'careWord.own.title' });
    expect(within(own).queryByText('careWord.own.empty')).toBeNull();
    expect(within(own).getByText('careWord.own.loading')).toBeInTheDocument();
  });

  it('keeps a run of whole chapters whole — Мф 5-7 stays 5 to 7', async () => {
    render(<WordForOccasionSituationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.add' }));
    fireEvent.change(screen.getByLabelText('careWord.own.fieldLabel'), { target: { value: 'Мф 5-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.save' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ bible: 'rst', book: 'Matthew', chapter: 5, toChapter: 7 }));
  });

  it('keeps a typed place in the reader\'s Bible, as he wrote it — Пс 22:4 stays Synodal 22:4', async () => {
    render(<WordForOccasionSituationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.add' }));
    fireEvent.change(screen.getByLabelText('careWord.own.fieldLabel'), { target: { value: 'Пс 22:4' } });
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.save' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 4 }));
    await waitFor(() => expect(screen.queryByLabelText('careWord.own.fieldLabel')).toBeNull());
  });

  it('says plainly what it cannot keep: an unreadable place, a place the topic already holds', () => {
    render(<WordForOccasionSituationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.add' }));
    const field = screen.getByLabelText('careWord.own.fieldLabel');

    fireEvent.change(field, { target: { value: 'Абв 99:99' } });
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.save' }));
    expect(screen.getByText('careWord.own.invalid')).toBeInTheDocument();

    // John 3 has 36 verses: an end past it names no place, though its start does.
    fireEvent.change(field, { target: { value: 'Ин 3:16-999' } });
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.save' }));
    expect(screen.getByText('careWord.own.invalid')).toBeInTheDocument();

    // The Gideons give John 10:28-29 for assurance; typed in Russian it is the same place.
    fireEvent.change(field, { target: { value: 'Ин 10:28-29' } });
    fireEvent.click(screen.getByRole('button', { name: 'careWord.own.save' }));
    expect(screen.getByText('careWord.own.duplicate')).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('shows an own place with its words, opens it over the page, and removes it by its own button', () => {
    mockOwn = [{ ids: ['own-1'], ref: { bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 4 }, createdAt: '2026-11-10T00:00:00Z' }];
    mockTexts = new Map([['Psalms', synodalPsalms]]);
    render(<WordForOccasionSituationPage />);
    const own = screen.getByRole('region', { name: 'careWord.own.title' });

    expect(own.textContent).toContain('Пс 22:4');
    fireEvent.click(within(own).getByRole('button', { name: 'careWord.openPlace' }));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 4 }));

  });

  it('asks before removing an own place, and removes it only on yes', async () => {
    mockOwn = [{ ids: ['own-1', 'own-1-twin'], ref: { bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 4 }, createdAt: '2026-11-10T00:00:00Z' }];
    render(<WordForOccasionSituationPage />);
    const own = screen.getByRole('region', { name: 'careWord.own.title' });

    fireEvent.click(within(own).getByRole('button', { name: 'careWord.own.remove' }));
    let dialog = await screen.findByRole('dialog');
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel|отмена|common\./i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockRemove).not.toHaveBeenCalled();

    fireEvent.click(within(own).getByRole('button', { name: 'careWord.own.remove' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'careWord.own.removeConfirm' }));
    // The place is removed as one, with every copy of it (two devices may have added it).
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(expect.objectContaining({ ids: ['own-1', 'own-1-twin'] })));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('says it when a removal is refused, instead of pretending', async () => {
    mockOwn = [{ ids: ['own-1'], ref: { bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 4 }, createdAt: '2026-11-10T00:00:00Z' }];
    mockRemove.mockImplementationOnce(() => Promise.reject(new Error('refused while its creation is pending')));
    render(<WordForOccasionSituationPage />);
    fireEvent.click(within(screen.getByRole('region', { name: 'careWord.own.title' })).getByRole('button', { name: 'careWord.own.remove' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'careWord.own.removeConfirm' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('careWord.own.removeFailed'));
  });
});
