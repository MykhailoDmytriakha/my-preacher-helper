import { getBookByName, getLocalizedAbbrev } from '../bibleData';

describe('bibleData helpers', () => {
  it('resolves books by localized names and abbreviations', () => {
    expect(getBookByName('Исход', 'ru')?.id).toBe('Exodus');
    expect(getBookByName('1Кор', 'ru')?.id).toBe('1 Corinthians');
    expect(getLocalizedAbbrev('Isaiah', 'uk')).toBe('Іс');
  });
});

