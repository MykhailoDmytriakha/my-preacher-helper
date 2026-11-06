import { enUS, ru, uk } from 'date-fns/locale';

import { APP_LANGUAGE_HEADER, browserInterfaceLanguage, detectTextLocale, formatDay, formatDayTime, requestLanguage, resolveAppLocale } from '@/utils/appLocale';

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

describe('a day as a person reads it', () => {
  // BUG-20261102-dates-in-browser-language: a Russian interface on an English browser showed «7/26/2026» on Studies'
  // cards — the browser's own date speaks the browser's language, not the interface's.
  const day = new Date(2026, 6, 26, 15, 4);

  it('says the day in the interface language, whatever the browser speaks', () => {
    expect(formatDay(day, ru)).toBe('26 июл. 2026');
    expect(formatDay(day, uk)).toBe('26 лип. 2026');
    expect(formatDay(day, enUS)).toBe('26 Jul 2026');
    expect(formatDay(day.toISOString(), ru)).toBe('26 июл. 2026');
  });

  it('reads a bare day as that day where the person is, not as UTC midnight', () => {
    // West of Greenwich, «2026-07-26» read as an instant is the evening of the 25th: a series starting on the 26th
    // showed the 25th in Seattle.
    expect(formatDay('2026-07-26', enUS)).toBe('26 Jul 2026');
  });

  it('says the time on the language\'s own clock', () => {
    expect(formatDayTime(day, ru)).toBe('26 июл. 2026, 15:04');
    expect(formatDayTime(day, enUS)).toBe('26 Jul 2026, 3:04 PM');
  });

  it('says nothing for a date that is not one, instead of «Invalid Date»', () => {
    expect(formatDay('', ru)).toBe('');
    expect(formatDayTime('not a date', enUS)).toBe('');
  });
});
