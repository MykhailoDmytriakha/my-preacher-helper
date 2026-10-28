import { getBookIds, getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';

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

  // BUG-20261015-joshua-short-form-not-read: "Нав. 2:18" sat as text in a sermon plan.
  it('reads Joshua by its Synodal short form "Нав."', () => {
    expect(parseReferenceText('Нав. 2:18', { locale: 'ru' })).toEqual({ book: 'Joshua', chapter: 2, fromVerse: 18 });
    expect(parseReferenceText('Нав 6:20')).toEqual({ book: 'Joshua', chapter: 6, fromVerse: 20 });
  });

  it('reads a Psalm named by the word people say, "Псалом 22"', () => {
    expect(parseReferenceText('Псалом 22')).toEqual({ book: 'Psalms', chapter: 22 });
    expect(parseReferenceText('псалом 90:1', { locale: 'uk' })).toEqual({ book: 'Psalms', chapter: 90, fromVerse: 1 });
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

/**
 * BUG-20261015-spaced-numbered-abbreviation-not-read: a person writes "1 Ин 4:8" as readily as
 * "1Ин 4:8", "1Иоанна" as "1 Иоанна", "И.Нав" with its dot — 53 of these forms read as nothing.
 * And "1Цар" is 1 Samuel in Russian but 1 Kings in Ukrainian: the language it is written in decides.
 */
describe('a book as people write it', () => {
  const locales = ['ru', 'uk', 'en'] as const;
  const writtenForms = (word: string) => new Set([word, word.replace(/^(\d)\s+/, '$1'), word.replace(/^(\d)(?=\S)/, '$1 ')]);

  it.each(locales)('reads every book of the Bible by its %s name and abbreviation, with or without the space after its number', (locale) => {
    const misread: string[] = [];
    for (const id of getBookIds()) {
      for (const word of [getLocalizedAbbrev(id, locale), getLocalizedBookName(id, locale)]) {
        for (const form of writtenForms(word)) {
          const parsed = parseReferenceText(`${form} 1:1`, { locale });
          if (parsed?.book !== id) misread.push(`"${form}" → ${parsed?.book ?? 'nothing'} (${id})`);
        }
      }
    }
    expect(misread).toEqual([]);
  });

  it('reads an abbreviation two languages share in the language it is written in', () => {
    expect(parseReferenceText('1 Цар 1:1', { locale: 'uk' })?.book).toBe('1 Kings');
    expect(parseReferenceText('2Цар 3:4', { locale: 'uk' })?.book).toBe('2 Kings');
    expect(parseReferenceText('1 Цар 1:1', { locale: 'ru' })?.book).toBe('1 Samuel');
    // With no language given, the Russian reading stays, as before.
    expect(parseReferenceText('1 Цар 1:1')?.book).toBe('1 Samuel');
  });

  it('reads with every language when the one given is none of the three', () => {
    expect(parseReferenceText('1 Ин 4:8', { locale: 'ru-RU' as never })?.book).toBe('1 John');
  });

  it('reads the spaced and dotted forms with no language given too', () => {
    expect(parseReferenceText('1 Ин 4:8')).toEqual({ book: '1 John', chapter: 4, fromVerse: 8 });
    expect(parseReferenceText('1 Ів 4:8')?.book).toBe('1 John');
    expect(parseReferenceText('И.Нав 1:9')).toEqual({ book: 'Joshua', chapter: 1, fromVerse: 9 });
    expect(parseReferenceText('1 Kgs 19:12')?.book).toBe('1 Kings');
  });
});

/*
 * A book as Ukrainian preachers write it (case 2026-10-12-block-diagram, L4): the titles of Огієнко's Bible and the
 * abbreviations of Ukrainian church usage, as the Ukrainian Wikipedia lists them («Книги Біблії», «Скорочені назви книг
 * Біблії», read 2026-10-27) — «1 М.» and «1 Мойс.» for the books of Moses, «Мр.», «Пр.», «Фил.», «1 Петр.», «Об.» —
 * with the apostrophe typed any of the three ways a Ukrainian keyboard gives it.
 */
describe('a book as Ukrainian preachers write it', () => {
  const ukrainian: Array<[string, string]> = [
    ['1 М.', 'Genesis'], ['1 Мойс.', 'Genesis'], ['1 Мойсеєва', 'Genesis'], ['Бут.', 'Genesis'], ['Буття', 'Genesis'],
    ['2 М.', 'Exodus'], ['2 Мойс.', 'Exodus'], ['Вих.', 'Exodus'], ['Вихід', 'Exodus'],
    ['3 М.', 'Leviticus'], ['3 Мойс.', 'Leviticus'], ['Лев.', 'Leviticus'],
    ['4 М.', 'Numbers'], ['4 Мойс.', 'Numbers'], ['Чис.', 'Numbers'], ['Числ.', 'Numbers'],
    ['5 М.', 'Deuteronomy'], ['5 Мойс.', 'Deuteronomy'], ['Повт.', 'Deuteronomy'], ['Повторення Закону', 'Deuteronomy'],
    ['Єг.', 'Joshua'], ['Ісус Навин', 'Joshua'], ['Нав.', 'Joshua'],
    ['Суд.', 'Judges'], ['Суддів', 'Judges'],
    ['Рут', 'Ruth'],
    ['1 Сам.', '1 Samuel'], ['1 Самуїлова', '1 Samuel'], ['2 Сам.', '2 Samuel'],
    ['1 Цар.', '1 Kings'], ['1 Царів', '1 Kings'], ['2 Цар.', '2 Kings'],
    ['1 Хр.', '1 Chronicles'], ['1 Хроніки', '1 Chronicles'], ['2 Хр.', '2 Chronicles'],
    ['Езд.', 'Ezra'], ['Ездри', 'Ezra'], ['Неем.', 'Nehemiah'], ['Неемія', 'Nehemiah'], ['Ест.', 'Esther'], ['Естер', 'Esther'],
    ['Йов', 'Job'], ['Пс.', 'Psalms'], ['Псалми', 'Psalms'],
    ['Пр.', 'Proverbs'], ['Приповісті', 'Proverbs'], ['Приповістей', 'Proverbs'],
    ['Екл.', 'Ecclesiastes'], ['Екклезіяст', 'Ecclesiastes'], ['Проповідник', 'Ecclesiastes'],
    ['Пісн.', 'Song of Solomon'], ['Пісня над піснями', 'Song of Solomon'],
    ['Іс.', 'Isaiah'], ['Ісая', 'Isaiah'], ['Єр.', 'Jeremiah'], ['Єремія', 'Jeremiah'], ['Плач Єремії', 'Lamentations'],
    ['Єз.', 'Ezekiel'], ['Єзекіїль', 'Ezekiel'], ['Дан.', 'Daniel'], ['Даниїл', 'Daniel'],
    ['Ос.', 'Hosea'], ['Осія', 'Hosea'], ['Йоіл', 'Joel'], ['Йоїл', 'Joel'], ['Ам.', 'Amos'], ['Овд.', 'Obadiah'], ['Овдій', 'Obadiah'],
    ['Йона', 'Jonah'], ['Мих.', 'Micah'], ['Михей', 'Micah'], ['Наум', 'Nahum'], ['Ав.', 'Habakkuk'], ['Авакум', 'Habakkuk'],
    ['Соф.', 'Zephaniah'], ['Софонія', 'Zephaniah'], ['Ог.', 'Haggai'], ['Огій', 'Haggai'], ['Зах.', 'Zechariah'], ['Захарія', 'Zechariah'],
    ['Мал.', 'Malachi'], ['Малахія', 'Malachi'],
    ['Мт.', 'Matthew'], ['Від Матвія', 'Matthew'], ['Матвія', 'Matthew'],
    ['Мр.', 'Mark'], ['Мк.', 'Mark'], ['Від Марка', 'Mark'],
    ['Лк.', 'Luke'], ['Від Луки', 'Luke'],
    ['Ів.', 'John'], ['Ін.', 'John'], ['Від Івана', 'John'],
    ['Дії', 'Acts'], ['Дії апостолів', 'Acts'],
    ['Рим.', 'Romans'], ['До римлян', 'Romans'], ['Римлян', 'Romans'],
    ['1 Кор.', '1 Corinthians'], ['1 Коринтян', '1 Corinthians'], ['2 Кор.', '2 Corinthians'],
    ['Гал.', 'Galatians'], ['Галатів', 'Galatians'], ['Еф.', 'Ephesians'], ['Ефесян', 'Ephesians'],
    ['Фил.', 'Philippians'], ['Філ.', 'Philippians'], ['Флп.', 'Philippians'],
    ["Филип'ян", 'Philippians'], ['Филип’ян', 'Philippians'], ['Филипʼян', 'Philippians'], ["До филип'ян", 'Philippians'],
    ['Кол.', 'Colossians'], ['Колосян', 'Colossians'],
    ['1 Сол.', '1 Thessalonians'], ['1 Солунян', '1 Thessalonians'], ['2 Сол.', '2 Thessalonians'],
    ['1 Тим.', '1 Timothy'], ['1 Тимофія', '1 Timothy'], ['2 Тим.', '2 Timothy'],
    ['Тит.', 'Titus'], ['Тита', 'Titus'], ['Филим.', 'Philemon'], ['Флм.', 'Philemon'], ['Филимона', 'Philemon'],
    ['Євр.', 'Hebrews'], ['Євреїв', 'Hebrews'], ['Як.', 'James'], ['Якова', 'James'],
    ['1 Петр.', '1 Peter'], ['1 Пет.', '1 Peter'], ['1 Петра', '1 Peter'], ['2 Петр.', '2 Peter'],
    ['1 Ів.', '1 John'], ['1 Івана', '1 John'], ['2 Ів.', '2 John'], ['3 Ів.', '3 John'],
    ['Юд.', 'Jude'], ['Юди', 'Jude'],
    ['Об.', 'Revelation'], ['Одкр.', 'Revelation'], ['Апок.', 'Revelation'],
    ["Об'явлення", 'Revelation'], ['Об’явлення', 'Revelation'], ['Обʼявлення', 'Revelation'],
    // Codex review 2026-10-27: forms of other Ukrainian editions, and the apostrophe left out.
    ['Іс. Нав.', 'Joshua'], ['1 Ін.', '1 John'], ['2 Ін.', '2 John'], ['3 Ін.', '3 John'], ['Пісн. Піс.', 'Song of Solomon'],
    ['Повтор.', 'Deuteronomy'], ['Филипян', 'Philippians'], ['Обявлення', 'Revelation'], ['Об‘явлення', 'Revelation'],
  ];

  it('reads every Ukrainian title and abbreviation as its book, in Ukrainian', () => {
    const misread = ukrainian
      .map(([form, book]) => [form, book, parseReferenceText(`${form} 1:1`, { locale: 'uk' })?.book ?? 'nothing'] as const)
      .filter(([, book, read]) => read !== book)
      .map(([form, book, read]) => `"${form}" → ${read} (${book})`);
    expect(misread).toEqual([]);
  });

  it('reads «Фил» as Philippians in every language — Philemon is «Флм», «Филим» and has one chapter', () => {
    expect(parseReferenceText('Фил 4:13')?.book).toBe('Philippians');
    expect(parseReferenceText('Фил 4:13', { locale: 'ru' })?.book).toBe('Philippians');
    expect(parseReferenceText('Филим 1:6', { locale: 'ru' })?.book).toBe('Philemon');
  });

  it('keeps the short Ukrainian forms out of a Russian reading: there «пр» and «ав» begin words being typed', () => {
    expect(parseReferenceText('Пр 3:5', { locale: 'uk' })?.book).toBe('Proverbs');
    expect(parseReferenceText('Ав 2:4', { locale: 'uk' })?.book).toBe('Habakkuk');
    expect(parseReferenceText('1 М 3:15', { locale: 'uk' })?.book).toBe('Genesis');
    expect(parseReferenceText('Ав 2:4', { locale: 'ru' })?.book).not.toBe('Habakkuk');
    expect(parseReferenceText('1 М 3:15', { locale: 'ru' })?.book).not.toBe('Genesis');
    // With no language to go by, the form one language alone writes is read last.
    expect(parseReferenceText('Пр 3:5')?.book).toBe('Proverbs');
  });
});
