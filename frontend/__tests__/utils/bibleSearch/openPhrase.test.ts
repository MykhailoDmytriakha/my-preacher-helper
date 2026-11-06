import { prepareWordForms } from '../../../test-utils/bibleWordForms';

prepareWordForms(["ru", "uk"]);

import fs from 'node:fs';
import path from 'node:path';

import { bookSequence, PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { buildSearchModel, type ModelInput } from '@/components/bible/search/searchModel';
import { readSearch } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { TFunction } from 'i18next';

// Actual app corpus and public search/model APIs: no substitute phrase matcher or forged result.
const fixture = (bible: BibleId) => {
  const books = bible === 'rst' ? SYNODAL_BOOKS : PROTESTANT_BOOKS;
  const order = bookSequence(books);
  const index = new BibleSearchIndex(order);
  const texts = new Map<string, BookText>();
  for (const book of order) {
    const text = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/bible-text', bible, 'v1', `${bookSlug(book)}.json`), 'utf8')) as BookText;
    texts.set(book, text);
    index.addBook(text);
  }
  return { bible, books, order, index, texts };
};
const rst = fixture('rst');
const kjv = fixture('kjv');
const ubio = fixture('ubio');
type Fixture = ReturnType<typeof fixture>;
const search = (line: string, corpus = rst) => {
  const query = readSearch(line, { bible: corpus.bible, books: corpus.books });
  return { query, answer: answerSearch(corpus.index, query, corpus.books) };
};
const places = (line: string, corpus = rst) => search(line, corpus).answer.hits.map(hit => `${hit.book} ${hit.chapter}:${hit.verse}`);
const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key)) as unknown as TFunction;
const shown = (line: string, corpus: Fixture = rst) => {
  const { query, answer } = search(line, corpus);
  const input: ModelInput = {
    reading: { kind: 'search', query, prefixBooks: [] }, answer, books: corpus.books,
    index: { index: corpus.index, indexed: corpus.order.length, total: corpus.order.length, loading: false, missing: 0, version: 1, wordFormsReady: true, wordFormsError: null },
    bible: corpus.bible, locale: (corpus.bible === 'rst' ? 'ru' : corpus.bible === 'ubio' ? 'uk' : 'en') as AppLocale,
    t, wide: true, asWords: false, bookReadAs: null, allBooks: false, fixChapters: false, opened: new Set(),
    offline: false, layoutFixed: null, limit: 100, booksBegun: null,
  };
  return buildSearchModel(input, (book, chapter, verse) => corpus.index.verseText(book, chapter, verse));
};

// BUG-20261027-search-open-phrase-last-word: typing a quoted phrase must not wait for its final word to finish.
describe('an unfinished quoted phrase in the actual Bible text', () => {
  it.each(['Гал "вы духо', 'Гал "вы дух', 'Гал «вы духо', 'Гал "вы, духо', 'Гал "вы духо '])('finds the completed final word while typing %s', (line) => {
    expect(places(line)).toContain('Galatians 6:1');
  });

  it.each(['Гал "вы духо"', 'Гал "вы дух"', 'Гал «вы духо»', 'Гал "вы духо*"'])('keeps a closed partial phrase exact: %s', (line) => {
    expect(places(line)).toHaveLength(0);
  });

  it('retains the closed complete phrase and its actual corpus wording', () => {
    const answer = search('Гал "вы духовные"').answer;
    expect(answer.hits).toEqual(expect.arrayContaining([expect.objectContaining({ book: 'Galatians', chapter: 6, verse: 1, text: expect.stringContaining('вы, духовные, исправляйте') })]));
  });

  it('keeps preceding words literal and ordered', () => {
    expect(places('Гал "в духо')).not.toContain('Galatians 6:1');
    expect(places('Гал "духовные вы')).not.toContain('Galatians 6:1');
  });

  it('combines ordinary terms with one unfinished quoted phrase', () => {
    expect(places('Гал исправляйте "вы духо')).toContain('Galatians 6:1');
  });

  it('keeps a closed phrase exact while another phrase is unfinished', () => {
    expect(places('Гал "Братия" "вы духо')).toContain('Galatians 6:1');
    expect(places('Гал "вы духо" "брати')).not.toContain('Galatians 6:1');
  });

  it.each(['"', '""', '«»'])('does not turn an empty phrase into every verse: %s', (line) => {
    expect(places(line)).toHaveLength(0);
  });

  it('finds the English final word in its actual KJV phrase', () => {
    expect(places('Gal "ye which are spiri', kjv)).toContain('Galatians 6:1');
  });

  it('finds the Ukrainian final word in its actual Ohienko phrase', () => {
    expect(places('Гал "то ви духов', ubio)).toContain('Galatians 6:1');
  });

  it('renders and highlights the actual closed complete phrase as a positive model control', () => {
    const model = shown('Гал "вы духовные"');
    const row = model.rows.find(each => each.type === 'verse' && each.run.kind === 'open' && each.run.target.bookId === 'Galatians' && each.run.target.chapter === 6 && each.run.target.verse === 1);
    expect(row).toBeDefined();
    if (row?.type !== 'verse') throw new Error('The closed complete phrase must show its real target');
    expect(row.pieces).toEqual(expect.arrayContaining([{ text: 'духовные', lit: true }]));
    expect(model.head?.formsLabel).toBe('bible.search.phrase');
  });

  it('highlights the whole matched final word and does not label the unfinished phrase exact', () => {
    const model = shown('Гал "вы духо');
    const row = model.rows.find(each => each.type === 'verse' && each.run.kind === 'open' && each.run.target.bookId === 'Galatians' && each.run.target.chapter === 6 && each.run.target.verse === 1);
    expect(row).toBeDefined();
    if (row?.type !== 'verse') throw new Error('The matching Galatians verse must be shown');
    expect(row.pieces).toEqual(expect.arrayContaining([{ text: 'духовные', lit: true }]));
    expect(model.head?.formsLabel).not.toBe('bible.search.phrase');
  });

  it('widens the same unfinished phrase through the actual public model action', () => {
    const model = shown('Исх "в начале сотво');
    const fix = model.rows.find(each => each.type === 'fix');
    expect(fix?.type).toBe('fix');
    if (fix?.type !== 'fix') throw new Error('The scoped search must explain its wider results');
    const run = fix.actions.find(action => action.label === 'bible.search.searchBible')?.run;
    expect(run).toBeDefined();
    if (run?.kind !== 'write') throw new Error('The actual wider action must write its search line');
    const wider = search(run.line);
    expect(wider.query.scope).toBeNull();
    expect(wider.answer.hits).toEqual(expect.arrayContaining([expect.objectContaining({ book: 'Genesis', chapter: 1, verse: 1 })]));
  });

  it('includes a book added after an earlier empty prefix lookup', () => {
    const index = new BibleSearchIndex(['Genesis', 'Galatians']);
    index.addBook(rst.texts.get('Genesis')!);
    const query = readSearch('Гал "вы духо', { bible: 'rst', books: SYNODAL_BOOKS });
    expect(answerSearch(index, query, SYNODAL_BOOKS).hits).toHaveLength(0);
    index.addBook(rst.texts.get('Galatians')!);
    expect(answerSearch(index, query, SYNODAL_BOOKS).hits).toEqual(expect.arrayContaining([expect.objectContaining({ book: 'Galatians', chapter: 6, verse: 1 })]));
  });
});
