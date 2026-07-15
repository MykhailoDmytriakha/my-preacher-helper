import en from '../../locales/en/graceVerses.json';
import ru from '../../locales/ru/graceVerses.json';
import uk from '../../locales/uk/graceVerses.json';
import enTranslation from '../../locales/en/translation.json';
import ruTranslation from '../../locales/ru/translation.json';
import ukTranslation from '../../locales/uk/translation.json';

describe('grace verses locale parity', () => {
  it('has the same non-empty verse count in all three locales without placeholders', () => {
    const locales = [en, ru, uk];
    expect(new Set(locales.map((locale) => locale.verses.length))).toEqual(new Set([4]));

    locales.forEach((locale) => {
      locale.verses.forEach((verse) => {
        expect(verse.trim()).not.toBe('');
        expect(verse).not.toMatch(/\{\{|\}\}/);
      });
    });
  });

  it('keeps the grace-band copy keys in parity across translation locales', () => {
    const expectedKeys = Object.keys(enTranslation.usageGrace).sort();
    expect(Object.keys(ruTranslation.usageGrace).sort()).toEqual(expectedKeys);
    expect(Object.keys(ukTranslation.usageGrace).sort()).toEqual(expectedKeys);
    expect(Object.keys(ruTranslation.usageGrace.metrics).sort()).toEqual(
      Object.keys(enTranslation.usageGrace.metrics).sort()
    );
    expect(Object.keys(ukTranslation.usageGrace.metrics).sort()).toEqual(
      Object.keys(enTranslation.usageGrace.metrics).sort()
    );
  });
});
