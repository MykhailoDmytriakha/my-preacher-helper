import { parseReferenceText } from '../referenceParser';

describe('referenceParser', () => {
  const aliasCases: Array<[string, string]> = [
    ['быт 1 1', 'Genesis'],
    ['исх 3 2', 'Exodus'],
    ['лев 5 6', 'Leviticus'],
    ['2 коринфянам 13 11', '2 Corinthians'],
    ['евангелие от матфея 5 3', 'Matthew'],
    ['откровение 22 21', 'Revelation'],
    ['песнь песней 1 1', 'Song of Solomon'],
    ['иуда 1 3', 'Jude'],
  ];

  it.each(aliasCases)('parses %s as %s', (input, expectedBook) => {
    const parsed = parseReferenceText(input);
    expect(parsed).toEqual({
      book: expectedBook,
      chapter: Number(input.split(' ').slice(-2)[0]),
      fromVerse: Number(input.split(' ').slice(-1)[0]),
    });
  });

  it('preserves verse ranges', () => {
    const parsed = parseReferenceText('Hebrews 2 9 11');
    expect(parsed).toEqual({
      book: 'Hebrews',
      chapter: 2,
      fromVerse: 9,
      toVerse: 11,
    });
  });

  it('supports hyphen ranges', () => {
    const parsed = parseReferenceText('евр 4 5-6');
    expect(parsed).toEqual({
      book: 'Hebrews',
      chapter: 4,
      fromVerse: 5,
      toVerse: 6,
    });
  });

  it('parses en dash ranges with colon separators', () => {
    expect(parseReferenceText('Исх 20:8–10')).toEqual({
      book: 'Exodus',
      chapter: 20,
      fromVerse: 8,
      toVerse: 10,
    });
    expect(parseReferenceText('1 Тим 2:9–10')).toEqual({
      book: '1 Timothy',
      chapter: 2,
      fromVerse: 9,
      toVerse: 10,
    });
  });

  it('returns null for truly malformed references', () => {
    // Non-numeric chapter/verse still returns null
    expect(parseReferenceText('Hebrews two nine')).toBeNull();
    // Unknown book name
    expect(parseReferenceText('unknownbook 1 1')).toBeNull();
    // Empty string
    expect(parseReferenceText('')).toBeNull();
  });

  // New tests for flexible reference types

  it('parses book-only references', () => {
    expect(parseReferenceText('евр')).toEqual({ book: 'Hebrews' });
    expect(parseReferenceText('Ezekiel')).toEqual({ book: 'Ezekiel' });
    expect(parseReferenceText('Иезекииль')).toEqual({ book: 'Ezekiel' });
  });

  it('parses chapter-only references', () => {
    expect(parseReferenceText('Romans 8')).toEqual({
      book: 'Romans',
      chapter: 8,
    });
    expect(parseReferenceText('Рим 8')).toEqual({
      book: 'Romans',
      chapter: 8,
    });
  });

  it('parses chapter range references', () => {
    expect(parseReferenceText('Matthew 5-7')).toEqual({
      book: 'Matthew',
      chapter: 5,
      toChapter: 7,
    });
    expect(parseReferenceText('Мф 5-7')).toEqual({
      book: 'Matthew',
      chapter: 5,
      toChapter: 7,
    });
  });

  // The numbers stay as written: the Bible they belong to is stored beside them by the caller,
  // and the numbering module shows them in another Bible (BUG-20261012-psalm-verse-numbering-not-mapped:
  // moving the chapter here by one, the verse left as typed, put "Пс 50:12" on the wrong verse).
  it('keeps Psalm numbers as written', () => {
    expect(parseReferenceText('Пс 22 1')).toEqual({ book: 'Psalms', chapter: 22, fromVerse: 1 });
    expect(parseReferenceText('Пс 50:12')).toEqual({ book: 'Psalms', chapter: 50, fromVerse: 12 });
  });

  it('keeps a Psalm chapter range as written', () => {
    expect(parseReferenceText('Пс 22-24')).toEqual({ book: 'Psalms', chapter: 22, toChapter: 24 });
  });

  it('resolves English abbreviations through bible data lookup', () => {
    const parsed = parseReferenceText('Gen 1 1');
    expect(parsed).toEqual({
      book: 'Genesis',
      chapter: 1,
      fromVerse: 1,
    });
  });
});
