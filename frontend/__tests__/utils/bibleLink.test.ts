import { bibleHref, bibleHrefForText, leadingReference, parsePassageEnd, referenceFromText, wayBackKind, wayBackPath } from '@/utils/bibleLink';

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

  it('stops where the reference stops: a number after it is a word, a second reference is not the first', () => {
    expect(lead('Ин 3:16 2 ученика')).toMatchObject({ text: 'Ин 3:16', at: '3:16', to: '16' });
    expect(lead('Мф 5:3-12; Лк 6:20')).toMatchObject({ text: 'Мф 5:3-12', book: 'matthew' });
    expect(lead('Песнь Песней 2:1 Я нарцисс Саронский')).toMatchObject({ text: 'Песнь Песней 2:1', book: 'song-of-solomon' });
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
