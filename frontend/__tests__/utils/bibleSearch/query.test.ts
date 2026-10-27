import { SYNODAL_BOOKS, PROTESTANT_BOOKS } from '@/components/bible/bookOrder';
import { readBooksBegun, readLine, readPlace, readSearch, booksBeginningWith } from '@/utils/bibleSearch/query';

const ru = { bible: 'rst' as const, books: SYNODAL_BOOKS };
const en = { bible: 'kjv' as const, books: PROTESTANT_BOOKS };

// BUG-20261026-search-book-prefix-place: «иса 3416» searched the words «Исаия» while «кол 418» opened Col 4:18. A book
// is typed in a hurry by its first letters and dictated in another case («Исаии», «Иеремии»); with the place's numbers
// after it, a word that points to one book is that book.
describe('readLine — a book by the beginning or a form of its name, with the place after it', () => {
  it.each([
    ['иса 3416', { kind: 'choices', bookId: 'Isaiah', choices: [{ chapter: 34, verse: 16 }] }],
    ['иса 34:16', { kind: 'place', bookId: 'Isaiah', chapter: 34, verse: 16 }],
    ['исаии 34 16', { kind: 'place', bookId: 'Isaiah', chapter: 34, verse: 16 }],
    ['исаии 3416', { kind: 'choices', bookId: 'Isaiah', choices: [{ chapter: 34, verse: 16 }] }],
    ['исаию 34', { kind: 'place', bookId: 'Isaiah', chapter: 34, verse: null }],
    ['иеремии 29 11', { kind: 'place', bookId: 'Jeremiah', chapter: 29, verse: 11 }],
    ['иезекииля 36 26', { kind: 'place', bookId: 'Ezekiel', chapter: 36, verse: 26 }],
    ['даниила 3 1', { kind: 'place', bookId: 'Daniel', chapter: 3, verse: 1 }],
    ['осии 6 4', { kind: 'place', bookId: 'Hosea', chapter: 6, verse: 4 }],
    ['мат 5 3', { kind: 'place', bookId: 'Matthew', chapter: 5, verse: 3 }],
    ['1 иоан 3 16', { kind: 'place', bookId: '1 John', chapter: 3, verse: 16 }],
    ['1 коринф 13', { kind: 'place', bookId: '1 Corinthians', chapter: 13, verse: null }],
    ['4 царст 5', { kind: 'place', bookId: '2 Kings', chapter: 5, verse: null }],
  ])('«%s» is that book’s place', (line, expected) => {
    expect(readLine(line, ru)).toMatchObject(expected);
  });

  it('stays a search when the letters begin several books, or words follow instead of numbers', () => {
    expect(readLine('ио 3:16', ru).kind).toBe('search');
    expect(readLine('иса пророк', ru).kind).toBe('search');
    expect(readLine('иса 34 пророк', ru).kind).toBe('search');
    // A numbered book needs its number; a word of a name that is not the word calling the book is not the book.
    expect(readLine('коринф 13', ru).kind).toBe('search');
    expect(readLine('закона 5', ru).kind).toBe('search');
    expect(readLine('кол 418', ru)).toMatchObject({ kind: 'choices', bookId: 'Colossians', choices: [{ chapter: 4, verse: 18 }] });
  });

  // Codex, 2026-10-26: the general word forms read everyday words before a number as books.
  it.each(['суда 5', 'луком 5', 'марки 5', 'marking 5', 'acting 5', 'judged 5'])('«%s» is a word, not a book in another case', (line) => {
    expect(readLine(line, ru).kind).toBe('search');
    expect(readLine(line, en).kind).toBe('search');
  });

  it('a dictated form alone searches its words and offers the book, as its first letters do', () => {
    expect(readLine('исаии', ru)).toMatchObject({ kind: 'search', prefixBooks: ['Isaiah'] });
    expect(readLine('иеремии', ru)).toMatchObject({ kind: 'search', prefixBooks: expect.arrayContaining(['Jeremiah']) });
  });
});

describe('readLine — a place', () => {
  it.each([
    ['Ин 3:16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Иоанна 3 16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Иоанна три шестнадцать', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Евангелие от Иоанна 3:16', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Иоанна 3 глава 16 стих', { bookId: 'John', chapter: 3, verse: 16 }],
    ['Иоанна третья глава шестнадцатый стих', { bookId: 'John', chapter: 3, verse: 16 }],
    ['псалом двадцать второй', { bookId: 'Psalms', chapter: 22, verse: null }],
    ['двадцать второй псалом', { bookId: 'Psalms', chapter: 22, verse: null }],
    ['Пс 118:176', { bookId: 'Psalms', chapter: 118, verse: 176 }],
    ['1 Кор 13', { bookId: '1 Corinthians', chapter: 13, verse: null }],
    ['первое послание к Коринфянам 13', { bookId: '1 Corinthians', chapter: 13, verse: null }],
    ['Иуд 3', { bookId: 'Jude', chapter: 1, verse: 3 }],
  ])('%s', (line, expected) => {
    expect(readLine(line, ru)).toMatchObject({ kind: 'place', ...expected });
  });

  it('keeps a passage: «Рим 8:28-39» lights to 39', () => {
    expect(readLine('Рим 8:28-39', ru)).toMatchObject({ kind: 'place', bookId: 'Romans', chapter: 8, verse: 28, toVerse: 39 });
  });

  it('reads English the same way', () => {
    expect(readLine('John three sixteen', en)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
  });

  it('a book alone is the book', () => {
    expect(readLine('Рим', ru)).toEqual({ kind: 'book', bookId: 'Romans' });
  });

  it('digits run together offer the places they can be', () => {
    expect(readLine('Иоанна 316', ru)).toMatchObject({ kind: 'choices', bookId: 'John', choices: [{ chapter: 3, verse: 16 }] });
  });

  it('a chapter the book does not have', () => {
    expect(readLine('Мф 33', ru)).toMatchObject({ kind: 'badChapter', bookId: 'Matthew', chapter: 33 });
  });

  it('a verse the chapter does not have', () => {
    expect(readLine('Ин 3:99', ru)).toMatchObject({ kind: 'badVerse', bookId: 'John', chapter: 3, verse: 99 });
  });

  it('«8:28» is a place in the book being read, and needs a book elsewhere', () => {
    expect(readLine('8:28', { ...ru, hereBook: 'Romans' })).toMatchObject({ kind: 'place', bookId: 'Romans', chapter: 8, verse: 28, relative: true });
    expect(readLine('8:28', ru)).toEqual({ kind: 'needBook' });
  });

  it('the beginning of a name is not a book', () => {
    expect(readPlace('Ио', ru)).toBeNull();
    expect(booksBeginningWith('Ио', ['ru'])).toEqual(expect.arrayContaining(['John', '1 John']));
  });
});

describe('readLine — a search', () => {
  const search = (line: string, context = ru) => {
    const reading = readLine(line, context);
    if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
    return reading.query;
  };

  it.each([
    ['Иоанна хлеб', 'John'],
    ['Ин хлеб', 'John'],
    ['Евангелие от Иоанна хлеб', 'John'],
    ['Римлянам благодать', 'Romans'],
  ])('%s — in a book', (line, bookId) => {
    expect(search(line)).toMatchObject({ scope: { kind: 'book', bookId, chapter: null }, terms: [expect.any(String)] });
  });

  it.each([
    ['Рим 4 вера', 4, ['вера']],
    ['Римлянам четыре веры', 4, ['веры']],
    ['Римлянам глава 4 вера', 4, ['вера']],
  ])('%s — in a chapter', (line, chapter, terms) => {
    expect(search(line)).toMatchObject({ scope: { kind: 'book', bookId: 'Romans', chapter }, terms });
  });

  it('a passage', () => {
    expect(search('Ин 6:25-59 хлеб')).toMatchObject({ scope: { kind: 'book', bookId: 'John', chapter: 6, fromVerse: 25, toVerse: 59 }, terms: ['хлеб'] });
  });

  it.each([
    ['НЗ благодать', 'new'],
    ['Новый Завет благодать', 'new'],
    ['в Новом Завете благодать', 'new'],
    ['ВЗ утешение', 'old'],
    ['Евангелия хлеб', 'gospels'],
    ['Пророки утешение', 'prophets'],
    ['Послания любовь', 'epistles'],
  ])('%s — in a part of the Bible', (line, part) => {
    expect(search(line).scope).toMatchObject({ kind: 'part', part });
  });

  it('the parts hold their books', () => {
    const gospels = search('Евангелия хлеб').scope;
    expect(gospels?.kind === 'part' && gospels.bookIds).toEqual(['Matthew', 'Mark', 'Luke', 'John']);
    const nt = search('НЗ благодать').scope;
    expect(nt?.kind === 'part' && nt.bookIds.length).toBe(27);
  });

  it('words in quotes are a phrase; signs stay in a word', () => {
    expect(search('"хлеб жизни"')).toMatchObject({ scope: null, terms: [], phrases: [['хлеб', 'жизни']] });
    expect(search('«хлеб жизни»')).toMatchObject({ phrases: [['хлеб', 'жизни']] });
    expect(search('благодат*').terms).toEqual(['благодат*']);
    expect(search('Ил_я').terms).toEqual(['ил_я']);
  });

  it('numbers said among plain words stay words', () => {
    expect(search('семь хлебов').terms).toEqual(['семь', 'хлебов']);
  });

  it('a book name that is an everyday word is read as the book and says so', () => {
    expect(search('плач скрежет').scope).toMatchObject({ kind: 'book', bookId: 'Lamentations', wordLike: true, said: 'плач' });
    expect(readSearch('плач скрежет', { ...ru, asWords: true })).toMatchObject({ scope: null, terms: ['плач', 'скрежет'] });
  });

  it('the words without the scope, as a line to widen with', () => {
    expect(search('Рим 4 вера').text).toBe('вера');
    expect(search('Ин "хлеб жизни"').text).toBe('"хлеб жизни"');
  });

  it('several books named and no words yet list those books', () => {
    expect(readLine('Прит Еккл', ru)).toMatchObject({ kind: 'books', scope: { kind: 'books', bookIds: ['Proverbs', 'Ecclesiastes'] } });
    // A book named again is a word: «Иоанн» after «Ин» is searched (Codex review r2, 2026-10-27).
    expect(readSearch('Мф Ин Иоанн', ru)).toMatchObject({ scope: { kind: 'books', bookIds: ['Matthew', 'John'] }, terms: ['иоанн'] });
  });

  it('a part alone lists its books; a chapter the book lacks keeps the words', () => {
    expect(readLine('Пророки', ru)).toMatchObject({ kind: 'part', scope: { part: 'prophets' } });
    expect(readLine('Рим 40 вера', ru)).toMatchObject({ kind: 'scopeBadChapter', bookId: 'Romans', chapter: 40 });
  });

  it('a pattern of one letter is too short', () => {
    expect(readLine('б*', ru).kind).toBe('tooShort');
  });

  it('plain words with no book', () => {
    expect(search('пастырь мой')).toMatchObject({ scope: null, terms: ['пастырь', 'мой'] });
    expect(search('в начале было слово').terms).toEqual(['начале', 'было', 'слово']);
  });
});

// BUG-20261027-search-related-words: «корин душ» searched the city Corinth; «коринфянам душ» found nothing — a book's
// first letters, or a numbered book's name without its number, were never its books when a word followed.
describe('the books a line may begin with though it names none exactly', () => {
  it.each([
    ['корин душ', { line: '1Кор 2Кор душ', bookIds: ['1 Corinthians', '2 Corinthians'], said: 'корин' }],
    ['коринфянам душ', { line: '1Кор 2Кор душ', bookIds: ['1 Corinthians', '2 Corinthians'], said: 'коринфянам' }],
    ['Прит Екклес свет', { line: 'Притч Еккл свет', bookIds: ['Proverbs', 'Ecclesiastes'], said: 'екклес' }],
    // A name is a word too: which it is, the verses found say (`chooseReading`).
    ['петр сказал', { line: '1Пет 2Пет сказал', bookIds: ['1 Peter', '2 Peter'], said: 'петр' }],
  ])('«%s» may be read with its books', (line, begun) => {
    expect(readBooksBegun(line, 'rst')).toMatchObject(begun);
  });

  it('says whether only a place follows, and the line with the letters as words', () => {
    expect(readBooksBegun('корин 13:4', 'rst')).toMatchObject({ line: '1Кор 2Кор 13:4', place: true, asWords: 'корин* 13:4' });
    expect(readBooksBegun('Мф корин свет', 'rst')).toMatchObject({ place: false, asWords: 'мф корин* свет' });
    // «в» is no number: «Иисус в» is not a place.
    expect(readBooksBegun('Иисус в', 'rst')).toMatchObject({ place: false });
    expect(readBooksBegun('корин "любовь долготерпит"', 'rst')).toMatchObject({ line: '1Кор 2Кор "любовь долготерпит"', place: false });
  });

  it.each([
    ['Прит свет', 'the books are named exactly'],
    ['корин', 'nothing follows the letters: a name still being typed'],
    ['царст небесн', 'the letters begin two names — Samuel and Kings are both «Царств»'],
    ['свет корин', 'a name stands first'],
  ])('«%s» is not: %s', (line) => {
    expect(readBooksBegun(line, 'rst')).toBeNull();
  });
});

