import { detectTextLocale, resolveAppLocale } from '@/utils/appLocale';

describe('resolveAppLocale', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['uk-UA', 'uk'],
    ['en-GB', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ])('reads %p as %s', (language, expected) => {
    expect(resolveAppLocale(language)).toBe(expected);
  });
});

describe('detectTextLocale', () => {
  it('reads Ukrainian by the letters only Ukrainian has', () => {
    expect(detectTextLocale('Віра, що несе друзів')).toBe('uk');
    expect(detectTextLocale('Євангеліє від Луки')).toBe('uk');
  });

  it('reads other Cyrillic as Russian', () => {
    expect(detectTextLocale('Вера, которая несёт')).toBe('ru');
  });

  it('reads Latin and empty text as English', () => {
    expect(detectTextLocale('Faith that carries')).toBe('en');
    expect(detectTextLocale('')).toBe('en');
    expect(detectTextLocale('Luke 5:17-26 — 4 men')).toBe('en');
  });

  it('lets one Ukrainian word decide a mixed text', () => {
    expect(detectTextLocale('# Заметка\n\nСлово "їжа" тут одно.')).toBe('uk');
  });
});
