import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { BookNavigator, BookOnList } from '@/components/bible/BiblePicker';
import { BIBLE_ASSET_NETWORK_FAILURE_HEADER } from '@/utils/bibleAssetResponse';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerReachable } from '@/utils/connectivity';

import type { ReactNode } from 'react';

jest.mock('@/components/bible/search/BibleSearch', () => ({
  BibleSearch: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { text?: string }) => options?.text ?? key,
  }),
}));

const ruth = { id: 'Ruth', chapters: [['Ruth chapter begins', 'Ruth verse preview'], ['Second chapter'], ['Third chapter'], ['Fourth chapter']] };
const path = '/bible-text/kjv/v1/ruth.json';
const originalFetch = global.fetch;

beforeEach(() => {
  __resetConnectivityForTests();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe.each(['book list', 'reader navigator'] as const)('Bible picker from the %s', (entry) => {
  it('fills the chapter and verse previews after an isolated file failure in the open picker', async () => {
    const fetchBook = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { [BIBLE_ASSET_NETWORK_FAILURE_HEADER]: '1' } }))
      .mockImplementation((url: string) => {
        expect(url).toBe(path);
        return Promise.resolve(new Response(JSON.stringify(ruth)));
      });
    global.fetch = fetchBook as unknown as typeof fetch;
    const onOpen = jest.fn();
    render(entry === 'book list'
      ? <BookOnList bookId="Ruth" bible="kjv" locale="en" wide onOpen={onOpen} />
      : <BookNavigator start="books" bookId="Genesis" bible="kjv" currentChapter={1} currentVerse={1} text={null} locale="en" wide
          anchorRef={{ current: null }} onClose={jest.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ruth' }));
    const chapters = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
    const first = within(chapters).getAllByRole('button', { name: 'bible.chapter' })[0];
    fireEvent.mouseEnter(first);
    expect(within(chapters).queryByText(/Ruth chapter begins/)).toBeNull();
    await waitFor(() => expect(fetchBook).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getConnectivityStatus()).toBe(false));

    act(() => reportServerReachable());
    await within(chapters).findByText(/Ruth chapter begins/);
    fireEvent.click(first);
    const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
    const second = within(verses).getAllByRole('button', { name: 'bible.verseNumber' })[1];
    fireEvent.mouseEnter(second);
    expect(within(verses).getByText(/Ruth verse preview/)).toBeInTheDocument();
    fireEvent.click(second);
    expect(onOpen).toHaveBeenCalledWith('Ruth', { chapter: 1, verse: 2, toVerse: 2 });
    expect(fetchBook).toHaveBeenCalledTimes(2);
  });
});
