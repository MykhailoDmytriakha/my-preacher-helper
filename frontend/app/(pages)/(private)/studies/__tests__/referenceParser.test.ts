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

  it('returns null for malformed references', () => {
    expect(parseReferenceText('евр')).toBeNull();
    expect(parseReferenceText('Hebrews two nine')).toBeNull();
  });
});
