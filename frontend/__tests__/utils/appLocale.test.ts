import { APP_LANGUAGE_HEADER, browserInterfaceLanguage, detectTextLocale, requestLanguage, resolveAppLocale } from '@/utils/appLocale';

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

// The owner, 2026-10-17: a note's old references are read in the Bible of its author's interface — the
// browser keeps that language in its cookie and says it to the server with each request.
describe('the interface language carried to the server', () => {
  afterEach(() => { document.cookie = 'lang=; max-age=0; path=/'; });

  it('is read off the browser’s language cookie, and is English without it — as the interface starts', () => {
    expect(browserInterfaceLanguage()).toBe('en');
    document.cookie = 'theme=dark; path=/';
    document.cookie = 'lang=uk; path=/';
    expect(browserInterfaceLanguage()).toBe('uk');
  });

  it('is what a request carried, or nothing when it carried none', () => {
    expect(requestLanguage({ headers: new Headers({ [APP_LANGUAGE_HEADER]: 'ru' }) })).toBe('ru');
    expect(requestLanguage({ headers: new Headers() })).toBeUndefined();
    expect(requestLanguage({})).toBeUndefined();
  });
});

