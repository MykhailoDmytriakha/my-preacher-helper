import { prepareWordForms } from '../../../test-utils/bibleWordForms';

prepareWordForms(["ru", "uk"]);

import fs from 'fs';
import path from 'path';

import { bookSequence, PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { readLine } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { wordsOfText } from '@/utils/bibleSearch/words';
import { bookSlug, type BookText } from '@/utils/bibleText';

/** The whole Synodal text from the files the app serves: the numbers below are the real ones. */
function indexOf(bible: 'rst' | 'kjv' | 'ubio'): BibleSearchIndex {
  const books = bible === 'rst' ? SYNODAL_BOOKS : PROTESTANT_BOOKS;
  const order = bookSequence(books);
  const index = new BibleSearchIndex(order);
  for (const bookId of order) {
    const file = path.join(__dirname, '../../../public/bible-text', bible, 'v1', `${bookSlug(bookId)}.json`);
    index.addBook(JSON.parse(fs.readFileSync(file, 'utf8')) as BookText);
  }
  return index;
}

const rst = indexOf('rst');
const ru = { bible: 'rst' as const, books: SYNODAL_BOOKS };

const answer = (line: string, asWords = false) => {
  const reading = readLine(line, { ...ru, asWords });
  if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
  return answerSearch(rst, reading.query, SYNODAL_BOOKS);
};
const places = (line: string) => answer(line).hits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse}`);

describe('search over the Synodal text', () => {
  it.each([
    ['Иоанна хлеб', 21],
    // 9 of «вера» and Rom 4:24 «верующим в Того, Кто воскресил» — its kin, since 2026-10-27.
    ['Рим 4 вера', 10],
    ['Римлянам четыре веры', 10],
    ['Ин 6:25-59 хлеб', 11],
    ['НЗ благодать', 122],
    ['Евангелия хлеб', 80],
    ['"хлеб жизни"', 2],
    ['благодат*', 132],
    ['Ил_я', 61],
    ['пастырь мой', 7],
    ['1 Кор 13 любовь', 6],
  ])('«%s» finds %i verses', (line, count) => {
    expect(answer(line).hits).toHaveLength(count);
  });

  it('finds the forms of a word: «вера» — веры, вере, веру', () => {
    expect(answer('Рим 4 вера').forms).toEqual(expect.arrayContaining(['вере', 'вера', 'веры', 'веру']));
    expect(answer('1 Кор 13 любовь').forms).toEqual(expect.arrayContaining(['любовь', 'любви']));
  });

  it.each([
    ['НЗ любовь', 'любить'],
    ['грех', 'грешник'],
    ['ВЗ бог', 'божий'],
    ['НЗ спасение', 'спасти'],
    ['молитва', 'молиться'],
    ['крест', 'крещение'],
    ['ложь', 'лжец'],
    ['правда', 'праведный'],
    ['царство', 'царь'],
    ['святость', 'святой'],
    ['дело', 'делать'],
  ])('widens %s to the verified family word %s', (line, word) => {
    const result = answer(line);
    expect(result.matchers[0].test(word)).toBe(true);
    expect(result.kin).not.toBeNull();
  });

  it('keeps a verse about loving in the related group after verses with forms of love', () => {
    const result = answer('НЗ любовь');
    expect(result.kin?.own).toBeGreaterThan(0);
    expect(result.hits.slice(result.kin?.own ?? result.hits.length)).toEqual(
      expect.arrayContaining([expect.objectContaining({ book: '1 John', chapter: 4, verse: 19 })]),
    );
  });

  it('keeps the historical spelling of grace among its own forms', () => {
    const result = answer('НЗ благодать');
    expect(result.forms).toContain('благодатию');
    expect(result.hits.slice(0, result.kin?.own ?? result.hits.length))
      .toEqual(expect.arrayContaining([expect.objectContaining({ book: 'Acts', chapter: 15, verse: 11 })]));
  });

  it.each([
    ['весь', 'весить'],
    ['суд', 'сосуд'],
    ['бог', 'богач'],
    ['душ', 'душить'],
    ['рад', 'лихорадка'],
  ])('does not add %s and %s to the same family', (term, other) => {
    expect(answer(term, true).matchers[0].test(other)).toBe(false);
  });

  it('does not put verses about the surroundings in the cross family', () => {
    expect(places('крест')).not.toContain('Job 37:22');
    expect(answer('крест').matchers[0].test('окрест')).toBe(false);
    expect(answer('окрест').matchers[0].test('крест')).toBe(false);
    expect(places('"окрест"')).toContain('Job 37:22');
  });

  it('does not turn a betrayal search into a search for giving', () => {
    const result = answer('Иуда предал', true);
    expect(result.matchers[1].test('дал')).toBe(false);
    expect(result.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ book: 'Matthew', chapter: 10, verse: 4 }),
    ]));
  });

  it('does not widen a weight search to forms of all or to very', () => {
    const result = answer('вес');
    expect(result.forms).toContain('вес');
    expect(result.matchers[0].test('весь')).toBe(false);
    expect(result.matchers[0].test('весьма')).toBe(false);
  });

  it.each([
    ['рай', 'раю'],
    ['ад', 'ада'],
    ['сказал', 'сказав'],
  ])('retains %s and its form %s in the same result group', (line, form) => {
    const result = answer(line);
    const own = result.hits.slice(0, result.kin?.own ?? result.hits.length);
    expect(own.some(hit => {
      const words = wordsOfText(hit.text);
      return words.includes(form) && !words.includes(line);
    })).toBe(true);
  });

  it('finds the ordinary noun from an attested dictionary form absent from the translation', () => {
    const hits = places('раем');
    expect(hits).toContain('Luke 23:43');
    expect(hits).not.toContain('Ezekiel 27:22');
  });

  it('does not turn a hell search into a match for the name Ada', () => {
    expect(places('ад')).not.toContain('Genesis 4:19');
    expect(places('"Ада"')).toContain('Genesis 4:19');
  });

  it('keeps the capitalized ordinary noun and excludes an unrelated abbreviated reading', () => {
    expect(places('аде')).toContain('Isaiah 14:9');
    expect(answer('имя').forms).toContain('имени');
    expect(answer('имя').forms).not.toContain('им');
  });

  it('does not treat a known short word as a prefix while other books are loading', () => {
    const index = new BibleSearchIndex(bookSequence(SYNODAL_BOOKS));
    const file = path.join(__dirname, '../../../public/bible-text/rst/v1', 'genesis.json');
    index.addBook(JSON.parse(fs.readFileSync(file, 'utf8')) as BookText);
    const reading = readLine('Быт ад', ru);
    if (reading.kind !== 'search') throw new Error('Expected a scoped word search');
    const result = answerSearch(index, reading.query, SYNODAL_BOOKS);
    expect(result.hits).toHaveLength(0);
    expect(result.begun).toEqual([]);
  });

  it('keeps comfort before the related verb forms in a group of books', () => {
    const result = answer('Пророки утешение');
    expect(result.kin?.own).toBe(4);
    expect(result.kin?.forms).toContain('утешит');
    expect(result.hits.slice(4)).toEqual(expect.arrayContaining([
      expect.objectContaining({ book: 'Isaiah', chapter: 51, verse: 3 }),
    ]));
  });

  it('the phrase is found where its words stand together', () => {
    expect(places('"хлеб жизни"')).toEqual(['John 6:35', 'John 6:48']);
  });

  it('the wider steps carry their counts and the line that searches there', () => {
    // With its kin since 2026-10-27 («верный», «верующий», «верен»): 36 · 240 · 248 of «вера» itself.
    expect(answer('Рим 4 вера').wider).toEqual([
      { kind: 'book', count: 51, line: 'Рим вера' },
      { kind: 'testament', testament: 'new', count: answer('НЗ вера').hits.length, line: 'НЗ вера' },
      { kind: 'bible', count: answer('вера').hits.length, line: 'вера' },
    ]);
    expect(answer('Ин 6:25-59 хлеб').wider[0]).toEqual({ kind: 'chapter', chapter: 6, count: 17, line: 'Ин 6 хлеб' });
  });

  it('keeps conjugated faith relatives, while a doorpost is not a form of faith', () => {
    expect(places('вера')).toEqual(expect.arrayContaining(['Acts 9:26', 'Acts 26:26', 'Acts 27:25', '1 Corinthians 11:18', 'Job 29:24']));
    expect(places('вера')).not.toContain('Ezekiel 43:8');
    expect(answer('вера').forms).not.toEqual(expect.arrayContaining(['верю', 'веря', 'верей']));
    expect(answer('вера').kin?.forms).toEqual(expect.arrayContaining(['верю', 'веря', 'верят']));
  });

  it('nothing in the place it looked, and how much everywhere', () => {
    const none = answer('Рим хлеб');
    expect(none.hits).toHaveLength(0);
    expect(none.everywhere).toBeGreaterThan(0);
    expect(none.everywhere).toBe(answer('хлеб').hits.length);
  });

  // BUG-20261027-search-related-words: «Прит свет» found 3 verses and not «светильник».
  it('a word whole brings its kin after its own verses: «Прит свет» — 3 of «свет», then 7 of «светильник», «светлый»…', () => {
    const light = answer('Прит свет');
    expect(light.hits).toHaveLength(10);
    expect(light.kin).toEqual({ own: 3, forms: expect.arrayContaining(['светильник', 'светило', 'светлый']) });
    expect(light.forms).toEqual(['свет']);
    expect(places('Прит свет').slice(0, 3)).toEqual(['Proverbs 6:23', 'Proverbs 13:9', 'Proverbs 29:13']);
    // The verses of the word itself come first, and every word of the stem is marked.
    expect(light.matchers[0].test('светильник')).toBe(true);
    // Any form keeps the same kin (Codex review, 2026-10-27: «Прит светом» found 3).
    expect(answer('Прит светом').hits).toHaveLength(10);
  });

  // BUG-20261027-search-related-words: «дух» did not find «духовный», «душ» not «душевный» — a stem of three letters
  // brought no kin at all. Its kin are the words a word-forming suffix makes of it; any word it begins is too often another.
  it('verified families preserve «дух» and «мир» and reject «мирра»', () => {
    expect(answer('дух').kin?.forms).toEqual(expect.arrayContaining(['духовный', 'духовное']));
    expect(answer('душа').kin?.forms).toEqual(expect.arrayContaining(['душевный']));
    expect(answer('душ').kin?.forms).toEqual(expect.arrayContaining(['душевный']));
    expect(answer('мир').kin?.forms).toEqual(expect.arrayContaining(['мирный', expect.stringMatching(/^мирск/)]));
    expect(answer('мир').kin?.forms).not.toContain('мирра');
    expect(answer('вера').kin?.forms).toEqual(expect.arrayContaining(['верный', 'верность']));
    expect(answer('вера').kin?.forms).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(верблюд|верх|верев|верш)/)]));
    // The owner, 2026-10-27: «корин суд» found no «судилище». A verb's and its noun's suffix begins with «и», «у», «ь».
    expect(answer('суд', true).kin?.forms).toEqual(expect.arrayContaining(['судить', 'судилище', 'судьею']));
    expect(answer('небо').kin?.forms).toEqual(expect.arrayContaining(['небесный']));
    // Codex class hunt, 2026-10-27: «верен» and «радости» were not reached by «-ость» and the list without «-ен-».
    expect(answer('НЗ вера').kin?.forms).toEqual(expect.arrayContaining(['верен']));
    expect(answer('НЗ рад').kin?.forms).toEqual(expect.arrayContaining(['радости']));
    expect(answer('мол').kin?.forms ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^молок/)]));
    expect(answer('гора').kin?.forms ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^город/)]));
    expect(answer('Прит бог').kin).toEqual({ own: 5, forms: ['божия'] });
    expect(answer('Прит свет*').kin).toBeNull();
    expect(answer('Прит свет*').hits).toHaveLength(10);
  });

  // BUG-20261027-search-related-words: «вы духо испр» found Gal 6:1 by «духе» — «духо» was read as «дух» in its forms
  // (its last letter cut as an ending), not as the beginning of «духовные» the person was typing.
  it('letters the Bible has not as a word begin one: «духо» finds «духовные» first, the forms of «дух» after', () => {
    const typed = answer('духо');
    expect(typed.begun).toEqual(['духо']);
    expect(typed.forms[0]).toMatch(/^духо/);
    expect(typed.kin?.forms).toEqual(expect.arrayContaining(['дух', 'духа']));
    expect(typed.matchers[0].test('бездушным')).toBe(false);
    const line = answer('вы духо испр');
    expect(places('вы духо испр')).toEqual(['Galatians 6:1']);
    expect(line.matchers.some((matcher) => matcher.test('духовные'))).toBe(true);
    // A word the Bible has stays itself: «мир» is not the beginning of «мирра».
    expect(answer('мир').begun).toEqual([]);
  });

  // BUG-20261027-search-two-books-reads-a-book-as-a-word: «Притчи Екклесиаст свет» read the second book as a word and found 0.
  it.each(['Прит Еккл свет', 'Притчи Екклесиаст свет', 'Прит и Еккл свет', 'Прит, Еккл свет'])('«%s» searches both books', (line) => {
    const both = answer(line);
    expect(both.hits).toHaveLength(14);
    expect(new Set(both.hits.map((hit) => hit.book))).toEqual(new Set(['Proverbs', 'Ecclesiastes']));
  });

  // Codex review, 2026-10-27: after the quotes were taken out, the book after them joined the books.
  it('a phrase in quotes ends the books: «Мф "Иисус" Иоанн» searches both words in Matthew', () => {
    const reading = readLine('Мф "Иисус" Иоанн', ru);
    expect(reading.kind === 'search' && reading.query.scope).toMatchObject({ kind: 'book', bookId: 'Matthew' });
    expect(answer('Мф "Иисус" Иоанн').hits).toHaveLength(7);
  });

  // Codex review, 2026-10-27: a second word that is itself searched hid the kin of the first from their line («Однокоренные:  · 4»).
  it('names the kin of each word: in «Прит свет светильник» «светильник» stands for «свет» too', () => {
    const both = answer('Прит свет светильник');
    expect(both.kin?.own).toBe(2);
    expect(both.kin?.forms).toContain('светильник');
  });

  it('a book whose name is an everyday word is no second book: «Прит плач» searches «плач» in Proverbs', () => {
    const reading = readLine('Прит плач', ru);
    expect(reading.kind === 'search' && reading.query.scope).toMatchObject({ kind: 'book', bookId: 'Proverbs' });
    expect(reading.kind === 'search' && reading.query.terms).toEqual(['плач']);
  });

  it('a book read as a word: «плач скрежет» as words', () => {
    const inLamentations = answer('плач скрежет');
    expect(inLamentations.kin).toEqual({ own: 0, forms: ['скрежещут'] });
    expect(places('плач скрежет')).toEqual(['Lamentations 2:16']);
    expect(answer('плач скрежет', true).hits).toHaveLength(7);
  });

  it('a word the Bible does not have is read as the beginning of one: «НЗ оде» while «одежда» is typed', () => {
    const typing = answer('НЗ оде');
    expect(typing.begun).toEqual(['оде']);
    expect(typing.hits.length).toBeGreaterThan(93);
    expect(typing.forms).toEqual(expect.arrayContaining(['одежды', 'одежду']));
    // Each step of typing finds, and the finished word is searched in its forms again.
    expect(answer('НЗ од').hits.length).toBeGreaterThan(0);
    expect(answer('НЗ одеж').begun).toEqual(['одеж']);
    expect(answer('НЗ одежд').begun).toEqual([]);
    expect(answer('НЗ одежд').hits).toHaveLength(93);
    // A word the Bible has keeps to its forms: «мир» does not turn into «мирра».
    expect(answer('мир').begun).toEqual([]);
    expect(answer('мир').forms).not.toContain('мирра');
  });

  it('the beginning of a word marks what it found in the verse', () => {
    const typing = answer('НЗ оде');
    expect(typing.matchers.some((matcher) => matcher.test('одеяние'))).toBe(true);
    expect(answer('НЗ ыыы').hits).toHaveLength(0);
  });

  it('results come in the order of the Bible being read', () => {
    const books = Array.from(new Set(answer('НЗ благодать').hits.map((hit) => hit.book)));
    // The Synodal puts James–Jude right after Acts.
    expect(books.indexOf('James')).toBeLessThan(books.indexOf('Romans'));
  });
});

describe('search over the King James text', () => {
  const kjv = indexOf('kjv');
  const en = { bible: 'kjv' as const, books: PROTESTANT_BOOKS };
  const find = (line: string) => {
    const reading = readLine(line, en);
    if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
    return answerSearch(kjv, reading.query, PROTESTANT_BOOKS);
  };

  it('finds English forms: «love» — loveth, loved', () => {
    // The King James says «charity» in 1 Corinthians 13; «love» fills 1 John 4.
    expect(find('1 John 4 love').hits.length).toBeGreaterThan(5);
    expect(find('John love').forms).toEqual(expect.arrayContaining(['love', 'loveth', 'loved']));
  });

  it('finds saved for salvation but excludes the ointment sense of salve', () => {
    const result = find('salvation');
    expect(result.kin?.forms).toContain('saved');
    expect(result.matchers[0].test('salve')).toBe(false);
  });

  it('keeps weight as a relative of weigh', () => {
    expect(find('weigh').kin?.forms).toContain('weight');
  });

  it('reads the parts in English', () => {
    expect(find('Gospels bread').hits.every((hit) => ['Matthew', 'Mark', 'Luke', 'John'].includes(hit.book))).toBe(true);
    expect(find('"bread of life"').hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('search over the Ohienko text', () => {
  const ubio = indexOf('ubio');
  const uk = { bible: 'ubio' as const, books: PROTESTANT_BOOKS };
  const find = (line: string) => {
    const reading = readLine(line, uk);
    if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
    return answerSearch(ubio, reading.query, PROTESTANT_BOOKS);
  };

  it('includes sinner in the related group for sin in Ohienko', () => {
    const result = find('гріх');
    expect(result.forms).toContain('гріх');
    expect(result.matchers[0].test('грішник')).toBe(true);
    expect(result.kin).not.toBeNull();
  });

  it('knows a book by its name without «Від»: «Івана хліб»', () => {
    expect(find('Івана хліб').hits).toHaveLength(21);
    expect(readLine('Івана три шістнадцять', uk)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
  });

  it('finds words printed with stress marks: «пастир» in «Па́стир»', () => {
    const shepherd = find('мій пастир').hits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse}`);
    expect(shepherd).toContain('Psalms 22:1');
  });

  it('one letter: «Іл_я» finds both spellings', () => {
    expect(find('Іл_я').forms).toEqual(expect.arrayContaining(['ілля', 'ілія']));
  });
});
