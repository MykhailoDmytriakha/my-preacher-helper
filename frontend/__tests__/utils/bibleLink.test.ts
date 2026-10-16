import { bibleHref, bibleHrefForText, leadingReference, namesAPlace, parsePassageEnd, referenceFromText, referencesInText, wayBackKind, wayBackPath } from '@/utils/bibleLink';

const query = (href: string | null) => Object.fromEntries(new URL(href ?? '/none', 'https://app.test').searchParams);

describe('bibleHref — a stored reference as a place to open', () => {
  it('opens a verse at itself and lights it, in the Bible the reference was written in', () => {
    const href = bibleHref({ bible: 'rst', book: 'Romans', chapter: 16, fromVerse: 21 }, { locale: 'ru', from: '/studies/n1' });
    expect(href?.startsWith('/bible?')).toBe(true);
    expect(query(href)).toEqual({ book: 'romans', at: '16:21', to: '21', tr: 'rst', from: '/studies/n1' });
  });

  it('lights every verse of a passage', () => {
    expect(query(bibleHref({ bible: 'rst', book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2 }, { locale: 'ru' })))
      .toEqual({ book: 'romans', at: '12:1', to: '2', tr: 'rst' });
  });

  it('opens a whole chapter at its heading and lights nothing', () => {
    expect(query(bibleHref({ bible: 'kjv', book: 'Psalms', chapter: 23 }, { locale: 'en' })))
      .toEqual({ book: 'psalms', at: '23:1', tr: 'kjv' });
  });

  it('opens a whole book at its start', () => {
    expect(query(bibleHref({ book: 'Jude' }, { locale: 'ru' }))).toEqual({ book: 'jude' });
  });

  it('reads a verse over a leftover chapter range, as the reference is printed', () => {
    expect(query(bibleHref({ bible: 'rst', book: 'Luke', chapter: 5, toChapter: 7, fromVerse: 17, toVerse: 26 }, { locale: 'ru' })))
      .toEqual({ book: 'luke', at: '5:17', to: '26', tr: 'rst' });
  });

  it('reads an old reference with no Bible as the interface typed it: its psalm was moved one on', () => {
    // Stored before Bibles were kept: "Пс 50:12" typed in Russian was saved as Psalms 51:12.
    expect(query(bibleHref({ book: 'Psalms', chapter: 51, fromVerse: 12 }, { locale: 'ru' })))
      .toEqual({ book: 'psalms', at: '50:12', to: '12', tr: 'rst' });
  });

  it('finds no place for a book it does not know', () => {
    expect(bibleHref({ book: 'Nowhere', chapter: 1, fromVerse: 1 }, { locale: 'ru' })).toBeNull();
  });
});

describe('bibleHrefForText — a reference kept as typed text', () => {
  it.each([
    ['Рим 16:21', 'ru', { book: 'romans', at: '16:21', to: '21', tr: 'rst' }],
    ['Ин 3:16-18', 'ru', { book: 'john', at: '3:16', to: '18', tr: 'rst' }],
    ['Рим. 8:28', 'uk', { book: 'romans', at: '8:28', to: '28', tr: 'ubio' }],
    ['Rom 8:28', 'en', { book: 'romans', at: '8:28', to: '28', tr: 'kjv' }],
    ['Иуд 3', 'ru', { book: 'jude', at: '1:3', to: '3', tr: 'rst' }],
    ['Пс 22', 'ru', { book: 'psalms', at: '22:1', tr: 'rst' }],
  ] as const)('opens %s (%s)', (raw, locale, expected) => {
    expect(query(bibleHrefForText(raw, { locale }))).toEqual(expected);
  });

  it.each(['', '  ', '3', 'нечто 3:16', 'молитва за семью'])('finds no place in %p', (raw) => {
    expect(bibleHrefForText(raw, { locale: 'ru' })).toBeNull();
  });

  it('reads the number after a book of one chapter as its verse, and a verse given with chapter 1 as is', () => {
    expect(referenceFromText('Иуд 3', 'rst')).toMatchObject({ book: 'Jude', chapter: 1, fromVerse: 3 });
    expect(referenceFromText('Иуд 1:3', 'rst')).toMatchObject({ book: 'Jude', chapter: 1, fromVerse: 3 });
  });
});

describe('leadingReference — the passage a sermon\'s verse names first', () => {
  const lead = (text: string, locale: 'ru' | 'uk' | 'en' = 'ru') => {
    const found = leadingReference(text, { locale, from: '/sermons/s1' });
    return found ? { text: text.slice(0, found.end), ...query(found.href) } : null;
  };

  it.each([
    // The shapes the sermons on file have, and the one the form suggests.
    ['Еф 1:15 — «Посему и я, услышав о вашей вере…»', { text: 'Еф 1:15', book: 'ephesians', at: '1:15', to: '15', tr: 'rst', from: '/sermons/s1' }],
    ['Агг 1:5-14: "Посему ныне так говорит Господь"', { text: 'Агг 1:5-14', book: 'haggai', at: '1:5', to: '14', tr: 'rst', from: '/sermons/s1' }],
    ['1 Пар. 4:9–10', { text: '1 Пар. 4:9–10', book: '1-chronicles', at: '4:9', to: '10', tr: 'rst', from: '/sermons/s1' }],
    ['Ин 3:16 Ибо так возлюбил Бог мир', { text: 'Ин 3:16', book: 'john', at: '3:16', to: '16', tr: 'rst', from: '/sermons/s1' }],
    ['Рим 8', { text: 'Рим 8', book: 'romans', at: '8:1', tr: 'rst', from: '/sermons/s1' }],
  ])('reads the opening of %p', (text, expected) => {
    expect(lead(text)).toEqual(expected);
  });

  it('gives the reference itself with its address, for a screen that shows it in place', () => {
    expect(leadingReference('Рим 12:1-2 Итак умоляю вас', { locale: 'ru' })?.reference).toEqual({ bible: 'rst', book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2, toChapter: undefined });
  });

  it('reads an English verse in the King James', () => {
    expect(lead('James 1:22 But be ye doers of the word', 'en')).toMatchObject({ text: 'James 1:22', book: 'james', at: '1:22', tr: 'kjv' });
  });

  it.each([
    'Посему и я, услышав о вашей вере',
    'Бытие — книга начал',
    'Ибо так возлюбил Бог мир, что отдал Сына (Ин 3:16)',
    '',
    // A book's name followed by prose and a number is prose: the generous reference parser would read it as John 3–4.
    'Иоанн пришёл 3-4 раза',
    'В 3 часа дня',
  ])('finds no opening reference in %p', (text) => {
    expect(lead(text)).toBeNull();
  });

  // BUG-20261015-spaced-numbered-abbreviation-not-read: the number and the book written apart, and a book two languages abbreviate alike.
  it('reads a numbered book written with a space, and a shared abbreviation in the language of the verse', () => {
    expect(lead('1 Ин 4:8 Бог есть любовь')).toMatchObject({ text: '1 Ин 4:8', book: '1-john', at: '4:8' });
    expect(lead('1 Ів 4:8 Бог є любов', 'uk')).toMatchObject({ text: '1 Ів 4:8', book: '1-john', at: '4:8' });
    expect(lead('1 Цар 19:12 тихий голос', 'uk')).toMatchObject({ book: '1-kings', at: '19:12' });
    expect(lead('1 Цар 3:10 Говори, Господи', 'ru')).toMatchObject({ book: '1-samuel', at: '3:10' });
  });

  it('stops where the reference stops: a number after it is a word, a second reference is not the first', () => {
    expect(lead('Ин 3:16 2 ученика')).toMatchObject({ text: 'Ин 3:16', at: '3:16', to: '16' });
    expect(lead('Мф 5:3-12; Лк 6:20')).toMatchObject({ text: 'Мф 5:3-12', book: 'matthew' });
    expect(lead('Песнь Песней 2:1 Я нарцисс Саронский')).toMatchObject({ text: 'Песнь Песней 2:1', book: 'song-of-solomon' });
  });
});

describe('referencesInText — every reference a text names', () => {
  const found = (text: string, locale: 'ru' | 'uk' | 'en' = 'ru') =>
    referencesInText(text, locale).map(({ start, end, raw, reference }) => {
      expect(text.slice(start, end)).toBe(raw);
      const { book, chapter, fromVerse, toVerse } = reference;
      return [raw, `${book} ${chapter}${fromVerse ? `:${fromVerse}` : ''}${toVerse ? `-${toVerse}` : ''}`];
    });

  it('finds a reference inside a sentence, without the words or marks around it', () => {
    expect(found('Прочитайте Рим 12:1–2 и обсудите.')).toEqual([['Рим 12:1–2', 'Romans 12:1-2']]);
    expect(found('Прочитаем вместе (1 Кор 13:4–7).')).toEqual([['1 Кор 13:4–7', '1 Corinthians 13:4-7']]);
    expect(found('**Рим 8:28** — главный стих')).toEqual([['Рим 8:28', 'Romans 8:28']]);
    expect(found('«Деян. 2:42–47»')).toEqual([['Деян. 2:42–47', 'Acts 2:42-47']]);
  });

  it('finds every reference of a list, joined by commas, semicolons or a word', () => {
    expect(found('Рим 13, Еф 6')).toEqual([['Рим 13', 'Romans 13'], ['Еф 6', 'Ephesians 6']]);
    expect(found('Рим 13 и Еф 6:10–18')).toEqual([['Рим 13', 'Romans 13'], ['Еф 6:10–18', 'Ephesians 6:10-18']]);
    expect(found('Римлянам 12:1-2; Матфея 5:3')).toEqual([['Римлянам 12:1-2', 'Romans 12:1-2'], ['Матфея 5:3', 'Matthew 5:3']]);
    expect(found('Read Romans 8:28 and John 3', 'en')).toEqual([['Romans 8:28', 'Romans 8:28'], ['John 3', 'John 3']]);
  });

  it('reads the forms people write: a numbered book apart or together, a whole name, a Psalm by its word', () => {
    expect(found('1Ин 4:8 и 1 Иоанна 4:16')).toEqual([['1Ин 4:8', '1 John 4:8'], ['1 Иоанна 4:16', '1 John 4:16']]);
    expect(found('Песнь Песней 2:1 и Псалом 22')).toEqual([['Песнь Песней 2:1', 'Song of Solomon 2:1'], ['Псалом 22', 'Psalms 22']]);
    // The number after a book of one chapter is its verse.
    expect(found('Иуд 3.')).toEqual([['Иуд 3', 'Jude 1:3']]);
    // BUG-20261015-joshua-short-form-not-read.
    expect(found('Раав и алая верёвка: Нав. 2:18.')).toEqual([['Нав. 2:18', 'Joshua 2:18']]);
  });

  it('reads a reference as the app prints it, the book glued to its numbers', () => {
    expect(found('Рим.12:1-2')).toEqual([['Рим.12:1-2', 'Romans 12:1-2']]);
    expect(found('Мф.5:3–4 и Ин3:16, 1Ин3:16')).toEqual([['Мф.5:3–4', 'Matthew 5:3-4'], ['Ин3:16', 'John 3:16'], ['1Ин3:16', '1 John 3:16']]);
  });

  it('reads a whole chapter that ends its phrase, is called a chapter, or joins the next reference', () => {
    expect(found('Чтение: Рим 12. Вопросы ниже')).toEqual([['Рим 12', 'Romans 12']]);
    expect(found('Прочитайте Римлянам 12 главу')).toEqual([['Римлянам 12', 'Romans 12']]);
    expect(found('Пс 22 и Пс 23')).toEqual([['Пс 22', 'Psalms 22'], ['Пс 23', 'Psalms 23']]);
    expect(found('Рим 8:28;Еф 4:1')).toEqual([['Рим 8:28', 'Romans 8:28'], ['Еф 4:1', 'Ephesians 4:1']]);
  });

  it('gives a passage across a chapter end by its first verse, never as another passage', () => {
    // BUG-20261015-cross-chapter-passage-misread: the parser would read it as Isaiah 52:13–53.
    expect(found('Ис 52:13–53:12')).toEqual([['Ис 52:13', 'Isaiah 52:13']]);
  });

  it.each([
    // A chapter alone followed by an ordinary word is prose: a count, a name, never guessed.
    'Даниил 3 года молился',
    'Иов 2 секунды молчал',
    'John 3 times',
    'Job 2 children',
    'Прочитайте Рим 12 вместе',
    // A book is named exactly, never by its first letters.
    'A 2 point plan',
    'see A 2.',
    // Addresses and identifiers.
    'John3@example.com',
    '//John3',
    'Ин3_test',
    'john3.com',
    // A book's name must read as a book by itself.
    'Иоанн пришёл 3-4 раза',
    'В 2023 году глава 3 была',
    // A place the book does not have.
    'Рим 25',
    'Рим 8:999',
    'Откр 22-999999999999',
    // Times, dates, a name before a comma, a link.
    'в 3:30 встреча',
    'Рим, 12 апостолов',
    'https://x.com/Рим 12',
    '',
  ])('finds nothing in %p', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('stops where the reference stops', () => {
    expect(found('Ин 3:16 2 ученика')).toEqual([['Ин 3:16', 'John 3:16']]);
    expect(found('Мф 5:3,4')).toEqual([['Мф 5:3', 'Matthew 5:3']]);
  });

  it('reads a long text at once', () => {
    const text = 'Прочитайте Рим 12:1–2 и обсудите, что значит жить по Еф 4:1. Иов 2 раза сказал. '.repeat(250);
    const started = Date.now();
    expect(found(text)).toHaveLength(500);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('namesAPlace — a reference with somewhere to open', () => {
  it('needs the chapter, the verse it starts at, and a chapter range that ends in the book', () => {
    // In its own Bible: Romans 16 has 24 verses in the Synodal and 27 in the King James.
    expect(namesAPlace({ bible: 'rst', book: 'Romans', chapter: 16, fromVerse: 24 })).toBe(true);
    expect(namesAPlace({ bible: 'rst', book: 'Romans', chapter: 16, fromVerse: 27 })).toBe(false);
    expect(namesAPlace({ bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 27 })).toBe(true);
    expect(namesAPlace({ bible: 'rst', book: 'Romans', chapter: 17 })).toBe(false);
    expect(namesAPlace({ bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 40 })).toBe(false);
    expect(namesAPlace({ bible: 'rst', book: 'Matthew', chapter: 5, toChapter: 7 })).toBe(true);
    expect(namesAPlace({ bible: 'rst', book: 'Revelation', chapter: 21, toChapter: 23 })).toBe(false);
    expect(namesAPlace({ bible: 'rst', book: 'Romans' })).toBe(false);
  });
});

describe('the way back', () => {
  it.each(['/studies/n1', '/studies?tag=hope', '/care/orders/o1'])('keeps a path inside the app: %s', (path) => {
    expect(wayBackPath(path)).toBe(path);
  });

  it('keeps the query and the anchor of the screen it came from', () => {
    expect(wayBackPath('/sermons/s1/plan/manual?source=note')).toBe('/sermons/s1/plan/manual?source=note');
  });

  // A browser drops tabs and newlines from a URL and reads a backslash as a slash: each of these starts with one slash and leads to another host.
  it.each(['https://evil.example/x', '//evil.example/x', '/\\evil.example', '/\t/evil.example/x', '/\n/evil.example/x', '/\r//evil.example', '/a/..//evil.example/x', '/..//evil.example', '/%2e%2e//evil.example', 'studies/n1', '', null, undefined])('refuses %p', (path) => {
    expect(wayBackPath(path)).toBeNull();
  });

  it('names the screen it leads to', () => {
    expect(wayBackKind('/studies/n1')).toBe('note');
    expect(wayBackKind('/studies?tag=hope')).toBe('notes');
    expect(wayBackKind('/studies')).toBe('notes');
    expect(wayBackKind('/sermons/s1')).toBe('sermon');
    expect(wayBackKind('/sermons/s1/plan')).toBe('plan');
    expect(wayBackKind('/sermons/s1/plan/manual')).toBe('plan');
    expect(wayBackKind('/sermons/s1/planner')).toBe('sermon');
    expect(wayBackKind('/groups/g1')).toBe('group');
    expect(wayBackKind('/care/orders/o1')).toBe('order');
    expect(wayBackKind('/dashboard')).toBe('page');
  });

  it('reads the last verse of a passage from the address', () => {
    expect(parsePassageEnd('21')).toBe(21);
    expect(parsePassageEnd('0')).toBeNull();
    expect(parsePassageEnd('2a')).toBeNull();
    expect(parsePassageEnd(null)).toBeNull();
  });
});
