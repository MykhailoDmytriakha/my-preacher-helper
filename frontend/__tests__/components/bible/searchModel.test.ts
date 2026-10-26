import fs from 'fs';
import path from 'path';

import { bookSequence, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { buildSearchModel, rowForEnter, type ModelInput, type ModelRow } from '@/components/bible/search/searchModel';
import { readLine } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

import type { SearchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import type { TFunction } from 'i18next';

/*
 * What the line says when not every book was searched (Codex review, 2026-10-23): the counts are
 * qualified, the steps stay, and «nowhere in the Bible» is never said.
 */
const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key)) as unknown as TFunction;
const order = bookSequence(SYNODAL_BOOKS);
const johnOnly = new BibleSearchIndex(order);
johnOnly.addBook(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/bible-text/rst/v1', `${bookSlug('John')}.json`), 'utf8')) as BookText);

function model(line: string, index: Partial<SearchIndexState>, offline: boolean) {
  const state = { index: johnOnly, indexed: 1, total: 66, loading: false, missing: 65, version: 1, ...index } as SearchIndexState;
  const reading = readLine(line, { bible: 'rst', books: SYNODAL_BOOKS });
  const answer = reading.kind === 'search' ? answerSearch(johnOnly, reading.query, SYNODAL_BOOKS) : null;
  const input: ModelInput = {
    reading, books: SYNODAL_BOOKS, answer, index: state, bible: 'rst', locale: 'ru', t, wide: true, asWords: false, bookReadAs: null,
    allBooks: false, fixChapters: false, opened: new Set(), offline, layoutFixed: null, limit: 40,
  };
  return buildSearchModel(input, () => null);
}

describe('a search over some of the books', () => {
  it('offline: says where it looked, keeps the step wider and never says «nowhere»', () => {
    const shown = model('Рим хлеб', {}, true);
    const fix = shown.rows.find((row) => row.type === 'fix');
    expect(fix).toMatchObject({ text: expect.stringContaining('bible.search.everywhereSaved') });
    expect(fix?.type === 'fix' && fix.actions.map((action) => action.label)).toEqual(['bible.search.searchBible']);
    expect(shown.offline).toContain('bible.search.offline');
    expect(JSON.stringify(shown)).not.toContain('bible.search.nowhere');
  });

  it('online with books that did not load: the same, in the words of a failed load', () => {
    const shown = model('Рим хлеб', {}, false);
    expect(shown.rows.find((row) => row.type === 'fix')).toMatchObject({ text: expect.stringContaining('bible.search.everywhereLoaded') });
    expect(shown.offline).toContain('bible.search.partial');
  });

  it('keeps «search as words» for a book whose name is a word', () => {
    const shown = model('плач скрежет', {}, true);
    const fix = shown.rows.find((row) => row.type === 'fix');
    expect(fix?.type === 'fix' && fix.actions[0].run).toEqual({ kind: 'asWords', on: true });
  });

  it('while books arrive: says it is still loading, and the wider counts wait', () => {
    const empty = model('Рим хлеб', { loading: true, missing: 0 }, false);
    expect(empty.rows).toEqual([expect.objectContaining({ type: 'more', text: expect.stringContaining('bible.search.stillLoadingTitle') })]);
    const found = model('Иоанна хлеб', { loading: true, missing: 0 }, false);
    expect(found.head).toMatchObject({ wider: [], where: expect.stringContaining('bible.search.stillLoading') });
  });
});

describe('a word being typed', () => {
  it('says the words were found by their beginning, and marks them in the verse', () => {
    const shown = model('Ин хле', { indexed: 66, missing: 0 }, false);
    expect(shown.head?.formsLabel).toBe('bible.search.begun{"words":"bible.search.quote{\\"text\\":\\"хле\\"}"}');
    expect(shown.head?.forms).toEqual(expect.arrayContaining(['хлеб', 'хлеба']));
    const verse = shown.rows.find((row) => row.type === 'verse');
    expect(verse?.type === 'verse' && verse.pieces.filter((piece) => piece.lit).map((piece) => piece.text.toLowerCase())).toEqual(
      expect.arrayContaining([expect.stringMatching(/^хлеб/)]),
    );
  });
});

describe('what Enter opens', () => {
  const verse = (key: string): ModelRow => ({ type: 'verse', key, ref: key, pieces: [], seen: false, run: { kind: 'write', line: key } });
  const rows: ModelRow[] = [{ type: 'head', key: 'h', title: 'h' }, verse('a'), verse('b'), { type: 'showMore', key: 'show-more', title: '', meta: '', run: { kind: 'more', limit: 80, next: 'c' } }];

  it('opens the row the arrows are on, even before the rows on screen caught up (Codex review r8)', () => {
    expect(rowForEnter(rows, 'b')?.key).toBe('b');
    expect(rowForEnter(rows, 'show-more')?.key).toBe('show-more');
  });

  it('else the first place, book or verse — never «Показать ещё» by default', () => {
    expect(rowForEnter(rows, null)?.key).toBe('a');
    expect(rowForEnter(rows, 'gone')?.key).toBe('a');
    expect(rowForEnter([rows[3]], null)).toBeNull();
  });
});
