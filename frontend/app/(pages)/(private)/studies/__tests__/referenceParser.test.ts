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

  it('converts Psalm numbers from Septuagint (ru) to Hebrew storage', () => {
    const parsed = parseReferenceText('Пс 22 1', 'ru');
    expect(parsed).toEqual({
      book: 'Psalms',
      chapter: 23,
      fromVerse: 1,
    });
  });

  it('converts Psalm chapter range from Septuagint', () => {
    const parsed = parseReferenceText('Пс 22-24', 'ru');
    expect(parsed).toEqual({
      book: 'Psalms',
      chapter: 23,
      toChapter: 25,
    });
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

