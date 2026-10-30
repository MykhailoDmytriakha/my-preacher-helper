import fs from 'fs';
import path from 'path';

import { renderHook } from '@testing-library/react';

import { booksOf, bookSequence } from '@/components/bible/bookOrder';
import { buildSearchModel } from '@/components/bible/search/searchModel';
import { useFoundVerses } from '@/components/bible/search/useFoundVerses';
import { answeringOf, chooseReading } from '@/utils/bibleSearch/lineChoice';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { useSearchIndex } from '@/utils/bibleSearch/searchIndexStore';

import type { SearchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import type { BookText } from '@/utils/bibleText';
import type { TFunction } from 'i18next';

jest.mock('@/utils/bibleSearch/searchIndexStore', () => ({ useSearchIndex: jest.fn() }));

const books = booksOf('kjv');
const order = bookSequence(books);
const text = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/bible-text/kjv/v1/ephesians.json'), 'utf8')) as BookText;
const index = new BibleSearchIndex(order);
index.addBook(text);
const state: SearchIndexState = { index, indexed: 1, total: order.length, loading: false, missing: order.length - 1, version: 1 };
const t = ((key: string) => key) as TFunction;

beforeEach(() => {
  jest.mocked(useSearchIndex).mockReturnValue(state);
});

describe('the search window and the found column share phrase semantics', () => {
  it.each(['Eph "by gra', 'Eph "by grace"', 'Eph gra'])('keeps the same hits and highlighted words for %s', (line) => {
    const choice = chooseReading(line, { bible: 'kjv', books, asWords: false }, answeringOf(index, 1, books));
    const model = buildSearchModel({
      ...choice, books, index: state, bible: 'kjv', locale: 'en', t, wide: true,
      asWords: false, bookReadAs: null, allBooks: false, fixChapters: false,
      opened: new Set(), limit: 100, offline: false,
    }, (book, chapter, verse) => index.verseText(book, chapter, verse));
    const { result } = renderHook(() => useFoundVerses({ bible: 'kjv', line, asWords: false }, 'kjv'));
    const found = result.current;
    expect(found).not.toBeNull();
    const rows = model.rows.filter((row) => row.type === 'verse');
    expect(rows.length).toBeGreaterThan(0);
    expect(found?.windowOrder).toEqual(rows.map((row) => row.key));
    for (const verse of found?.verses ?? []) {
      const row = rows.find((each) => each.key === verse.key);
      expect(found?.piecesOf(verse.text)).toEqual(row?.pieces);
    }
    const savedByGrace = found?.verses.find((verse) => verse.key === 'Ephesians 2:8');
    expect(savedByGrace).toBeDefined();
    const lit = found?.piecesOf(savedByGrace!.text).filter((piece) => piece.lit).map((piece) => piece.text.toLowerCase());
    expect(lit).toEqual(line.includes('"') ? ['by', 'grace'] : ['grace']);
  });

  it('does not complete an explicitly closed partial word', () => {
    const { result } = renderHook(() => useFoundVerses({ bible: 'kjv', line: 'Eph "by gra"', asWords: false }, 'kjv'));
    expect(result.current?.verses).toEqual([]);
  });

  it('keeps the column dormant when the reader uses another Bible or the search is closed', () => {
    const { result, rerender } = renderHook(({ bible }: { bible: 'kjv' | 'rst' }) =>
      useFoundVerses({ bible: 'kjv', line: 'Eph "by gra', asWords: false }, bible), { initialProps: { bible: 'rst' } });
    expect(result.current).toBeNull();
    expect(jest.mocked(useSearchIndex).mock.lastCall?.[2]).toBe(false);
    rerender({ bible: 'kjv' });
    expect(result.current?.verses.some((verse) => verse.key === 'Ephesians 2:8')).toBe(true);
    const closed = renderHook(() => useFoundVerses(null, 'kjv'));
    expect(closed.result.current).toBeNull();
    expect(jest.mocked(useSearchIndex).mock.lastCall?.[2]).toBe(false);
  });
});
