import { PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { readLine } from '@/utils/bibleSearch/query';
import { fitsPattern, matcherOf } from '@/utils/bibleSearch/wordForms';

/*
 * What a hurried, pasted or odd line must not break (Codex review of the search line, 2026-10-23):
 * a passage that never ends, a chapter zero, a pattern of thirty stars, two forms of one word.
 */
const ru = { bible: 'rst' as const, books: SYNODAL_BOOKS };
const en = { bible: 'kjv' as const, books: PROTESTANT_BOOKS };

describe('a line that asks too much', () => {
  it('ends a passage at the chapter\'s last verse', () => {
    expect(readLine('Ин 3:16-1000000000', ru)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16, toVerse: 36 });
    expect(readLine('3:16-1000000000', { ...ru, hereBook: 'John' })).toMatchObject({ kind: 'place', chapter: 3, verse: 16, toVerse: 36 });
  });

  it('keeps a searched passage inside its chapter', () => {
    const reading = readLine('Ин 6:25-1000 хлеб', ru);
    expect(reading.kind === 'search' && reading.query.scope).toMatchObject({ kind: 'book', chapter: 6, fromVerse: 25, toVerse: 71 });
  });

  it('says a chapter or verse zero is not there', () => {
    expect(readLine('0:5', { ...ru, hereBook: 'John' })).toMatchObject({ kind: 'badChapter', chapter: 0 });
    expect(readLine('3:0', { ...ru, hereBook: 'John' })).toMatchObject({ kind: 'badVerse', verse: 0 });
    expect(readLine('Рим 0 вера', ru)).toMatchObject({ kind: 'scopeBadChapter', chapter: 0 });
  });

  it('reads odd lines without breaking', () => {
    for (const line of [':', '-', '::', '""', '"', '*', '_', '* _', '12345678901234567890', 'Ин :', 'Ин 3:', '«', 'ё', ' '.repeat(50)]) {
      expect(() => readLine(line, ru)).not.toThrow();
    }
  });
});

describe('a name that holds little words', () => {
  it('keeps the «of» of «Song of Solomon»', () => {
    expect(readLine('Song of Solomon 3:1', en)).toMatchObject({ kind: 'place', bookId: 'Song of Solomon', chapter: 3, verse: 1 });
    const reading = readLine('Song of Solomon love', en);
    expect(reading.kind === 'search' && reading.query).toMatchObject({ scope: { kind: 'book', bookId: 'Song of Solomon' }, terms: ['love'] });
  });

  it('passes over only the words that lead in', () => {
    expect(readLine('открой Евангелие от Иоанна 3:16', ru)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
    expect(readLine('show me John 3:16', en)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
  });
});

describe('patterns', () => {
  it('* is any letters, _ one letter', () => {
    expect(fitsPattern('благодать', 'благодат*')).toBe(true);
    expect(fitsPattern('благодат', 'благодат*')).toBe(true);
    expect(fitsPattern('илия', 'ил_я')).toBe(true);
    expect(fitsPattern('илья', 'ил_я')).toBe(true);
    expect(fitsPattern('ия', 'ил_я')).toBe(false);
    expect(fitsPattern('свет', '*е*')).toBe(true);
    expect(fitsPattern('свет', '*ю*')).toBe(false);
  });

  it('a pasted pattern of thirty stars stays quick', () => {
    const matcher = matcherOf(`бл${'*'.repeat(30)}ъ`, 'ru');
    const words = Array.from({ length: 50000 }, (_, i) => `бл${'а'.repeat(i % 25)}б`);
    const started = Date.now();
    words.forEach((word) => matcher.test(word));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('two forms of one word are one search', () => {
  it('«любовь» and «любовью» find the same forms, «любви» among them', () => {
    const a = matcherOf('любовь', 'ru');
    const b = matcherOf('любовью', 'ru');
    expect(a.key).toBe(b.key);
    expect(['любви', 'любовь', 'любовью'].every(a.test)).toBe(true);
    expect(['любви', 'любовь', 'любовью'].every(b.test)).toBe(true);
  });

  it('a vowel put back: «отца» finds «отец», «сердца» finds «сердец»', () => {
    expect(matcherOf('отца', 'ru').test('отец')).toBe(true);
    expect(matcherOf('сердца', 'ru').test('сердец')).toBe(true);
  });
});

describe('a place checked as written, and quotes as search', () => {
  it('«Ин 3:0» has no verse 0 — it does not open 3:1', () => {
    expect(readLine('Ин 3:0', ru)).toMatchObject({ kind: 'badVerse', chapter: 3, verse: 0 });
  });

  it('«"плач"» is the word, not the book', () => {
    const reading = readLine('"плач"', ru);
    expect(reading.kind === 'search' && reading.query).toMatchObject({ scope: null, phrases: [['плач']] });
  });
});
