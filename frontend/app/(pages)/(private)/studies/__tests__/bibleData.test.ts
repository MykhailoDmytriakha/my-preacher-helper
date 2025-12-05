import {
  convertPsalmNumber,
  getBookByName,
  getLocalizedAbbrev,
  psalmHebrewToSeptuagint,
  psalmSeptuagintToHebrew,
} from '../bibleData';

describe('bibleData helpers', () => {
  it('resolves books by localized names and abbreviations', () => {
    expect(getBookByName('Исход', 'ru')?.id).toBe('Exodus');
    expect(getBookByName('1Кор', 'ru')?.id).toBe('1 Corinthians');
    expect(getLocalizedAbbrev('Isaiah', 'uk')).toBe('Іс');
  });

  it('converts Psalm numbers between Hebrew and Septuagint with boundaries intact', () => {
    expect(psalmHebrewToSeptuagint(23)).toBe(22);
    expect(psalmSeptuagintToHebrew(22)).toBe(23);
    expect(convertPsalmNumber(9, 'en', 'ru')).toBe(9); // Below offset threshold
    expect(convertPsalmNumber(148, 'ru', 'en')).toBe(148); // Above offset threshold
  });
});

