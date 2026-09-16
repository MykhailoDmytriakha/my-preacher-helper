import {
  byNewestFirst,
  countByKind,
  councilEntries,
  entriesByDate,
  entriesInMonth,
  groupEntries,
  kindsByDate,
  noteEntries,
  prayerEntries,
  sermonEntries,
} from '@/utils/calendarEntries';

import type { Council, Group, PrayerRequest, Sermon, StudyNote } from '@/models/models';

const sermon = (over: Partial<Sermon> = {}): Sermon =>
  ({
    id: 's1',
    title: 'О терпении',
    verse: 'Иак 1:4',
    date: '2026-09-01',
    thoughts: [],
    userId: 'u1',
    preachDates: [
      { id: 'pd1', date: '2026-09-06', status: 'planned', church: { id: 'c', name: 'Вифания', city: 'Сиэтл' }, createdAt: '' },
    ],
    ...over,
  }) as Sermon;

const group = (over: Partial<Group> = {}): Group =>
  ({
    id: 'g1',
    title: 'Молодёжь',
    description: 'Разбор Послания',
    userId: 'u1',
    meetingDates: [{ id: 'md1', date: '2026-09-06', location: 'Зал', createdAt: '' }],
    ...over,
  }) as Group;

const council = (over: Partial<Council> = {}): Council =>
  ({
    id: 'k1',
    userId: 'u1',
    title: 'Совет — Bible Truck',
    date: '2026-09-13',
    status: 'preparing',
    topics: [
      { id: 't1', title: 'Контекст', questions: [], options: [] },
      { id: 't2', title: 'Решение 1', questions: [], options: [], discussed: true },
    ],
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as Council;

/** A stamp at the given local time, the way the clock writes one: an instant, in UTC. */
const at = (year: number, monthIndex: number, day: number, hour = 12): string =>
  new Date(year, monthIndex, day, hour, 0, 0).toISOString();

const note = (over: Partial<StudyNote> = {}): StudyNote =>
  ({
    id: 'n1',
    userId: 'u1',
    title: 'Молитва Иависа',
    content: 'Девять глав одних имён…',
    scriptureRefs: [{ book: '1 Пар', chapter: 4, fromVerse: 9, toVerse: 10 }],
    tags: [],
    createdAt: at(2026, 8, 3),
    updatedAt: at(2026, 8, 3, 18),
    isDraft: false,
    ...over,
  }) as StudyNote;

const prayer = (over: Partial<PrayerRequest> = {}): PrayerRequest =>
  ({
    id: 'p1',
    userId: 'u1',
    title: 'За церковь',
    description: 'Прийди и помоги нам.\n\nВторой абзац остаётся в молитве.',
    status: 'active',
    updates: [],
    createdAt: at(2026, 8, 2),
    updatedAt: at(2026, 8, 2),
    ...over,
  }) as PrayerRequest;

const WORDS = { untitled: 'Заметка без названия' };

describe('everything the calendar shows, in one shape', () => {
  it('turns a sermon into an entry per preach date, carrying church and status', () => {
    const [entry] = sermonEntries([sermon()]);
    expect(entry).toMatchObject({
      kind: 'sermon',
      refId: 's1',
      date: '2026-09-06',
      title: 'О терпении',
      href: '/sermons/s1',
      location: 'Вифания, Сиэтл',
      status: 'planned',
    });
  });

  it('keys a day by the day, whatever shape the date arrived in', () => {
    const stamped = group({ meetingDates: [{ id: 'md1', date: '2026-09-06T00:00:00.000Z', location: 'Зал', createdAt: '' }] } as any);
    expect(groupEntries([stamped])[0].date).toBe('2026-09-06');
  });

  it('turns a group meeting into an entry with its place', () => {
    const [entry] = groupEntries([group()]);
    expect(entry).toMatchObject({ kind: 'group', date: '2026-09-06', href: '/groups/g1', location: 'Зал' });
  });

  it('turns a council into one entry on its day, with how far it got', () => {
    const [entry] = councilEntries([council()]);
    expect(entry).toMatchObject({
      kind: 'council',
      date: '2026-09-13',
      href: '/care/council/k1',
      status: 'preparing',
      progress: { done: 1, total: 2 },
    });
  });

  it('carries the section headings, because a day answers "what is it about"', () => {
    // The section itself lists a council's sections under its name; the calendar showed the
    // name alone, so remembering the agenda meant leaving the day and opening the council.
    const [entry] = councilEntries([council()]);
    expect(entry.sections).toEqual({ titles: ['Контекст', 'Решение 1'], hidden: 0 });
  });

  it('shows the first few headings and says how many are left', () => {
    const many = council({
      topics: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, title: `Секция ${i + 1}`, questions: [], options: [] })),
    } as Partial<Council>);

    const [entry] = councilEntries([many]);
    expect(entry.sections?.titles).toEqual([
      'Секция 1', 'Секция 2', 'Секция 3', 'Секция 4', 'Секция 5', 'Секция 6',
    ]);
    expect(entry.sections?.hidden).toBe(3);
  });

  it('says nothing at all when the council has no sections yet', () => {
    // An empty list rendered as an empty block is a card with a hole in it.
    expect(councilEntries([council({ topics: [] })])[0].sections).toBeUndefined();
  });

  it('skips a section left untitled, instead of printing a blank line', () => {
    const [entry] = councilEntries([council({
      topics: [
        { id: 't1', title: 'Контекст', questions: [], options: [] },
        { id: 't2', title: '   ', questions: [], options: [] },
      ],
    } as Partial<Council>)]);
    expect(entry.sections?.titles).toEqual(['Контекст']);
  });

  it('leaves out a council whose day is not set: a calendar has nowhere to put it', () => {
    expect(councilEntries([council({ date: undefined })])).toEqual([]);
  });

  it('calls a held council held', () => {
    expect(councilEntries([council({ status: 'held' })])[0].status).toBe('held');
  });

  it('says which kinds fall on a day, in one order, without guessing by what is missing', () => {
    const entries = [...sermonEntries([sermon()]), ...groupEntries([group()]), ...councilEntries([council()])];
    expect(kindsByDate(entries)).toEqual({
      '2026-09-06': ['sermon', 'group'],
      '2026-09-13': ['council'],
    });
  });

  it('groups a day and counts a month by kind', () => {
    const entries = [...sermonEntries([sermon()]), ...groupEntries([group()]), ...councilEntries([council()])];
    expect(Object.keys(entriesByDate(entries)).sort()).toEqual(['2026-09-06', '2026-09-13']);
    expect(countByKind(entries)).toEqual({ sermon: 1, group: 1, council: 1, note: 0, prayer: 0 });
    expect(entriesInMonth(entries, '2026-09')).toHaveLength(3);
    expect(entriesInMonth(entries, '2026-10')).toHaveLength(0);
  });

  it('reads newest first, and settles same-day ties by kind so the order never wobbles', () => {
    const entries = [...councilEntries([council()]), ...sermonEntries([sermon()])].sort(byNewestFirst);
    expect(entries.map((entry) => entry.date)).toEqual(['2026-09-13', '2026-09-06']);
  });

  describe('a study note', () => {
    it('stands on the day it was written, named by its title, with its Scripture underneath', () => {
      const [entry] = noteEntries([note()], WORDS);
      expect(entry).toMatchObject({
        kind: 'note',
        refId: 'n1',
        date: '2026-09-03',
        title: 'Молитва Иависа',
        subtitle: '1 Пар 4:9-10',
        href: '/studies/n1',
      });
      expect(entry.status).toBeUndefined();
    });

    it('previews the first two passages and leaves the rest to the note itself', () => {
      const [entry] = noteEntries([note({
        scriptureRefs: [
          { id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 },
          { id: 'r2', book: 'John', chapter: 2, fromVerse: 1, toVerse: 11 },
          { id: 'r3', book: 'Jeremiah', chapter: 31, fromVerse: 31, toVerse: 34 },
        ],
      })], WORDS);
      expect(entry.subtitle).toBe('Luke 5:17-26; John 2:1-11');
    });

    it('is named by its first Scripture reference when it has no title, and does not repeat it below', () => {
      const [entry] = noteEntries([note({ title: undefined })], WORDS);
      expect(entry.title).toBe('1 Пар 4:9-10');
      expect(entry.subtitle).toBeUndefined();
    });

    it('is called untitled in the caller\'s words when it has neither title nor Scripture', () => {
      expect(noteEntries([note({ title: '  ', scriptureRefs: [] })], WORDS)[0].title).toBe('Заметка без названия');
    });

    it('appears once when written and edited the same day: that day it was simply written', () => {
      expect(noteEntries([note()], WORDS)).toHaveLength(1);
    });

    it('appears a second time on the day it was last touched, and says so', () => {
      const entries = noteEntries([note({ updatedAt: at(2026, 8, 10) })], WORDS);
      expect(entries.map((entry) => [entry.date, entry.status])).toEqual([
        ['2026-09-03', undefined],
        ['2026-09-10', 'updated'],
      ]);
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    });

    it('keeps an evening\'s writing on that evening\'s day, not on the UTC day', () => {
      const [entry] = noteEntries([note({ createdAt: at(2026, 8, 15, 23), updatedAt: at(2026, 8, 15, 23) })], WORDS);
      expect(entry.date).toBe('2026-09-15');
    });

    it('is left out when it carries no stamp at all', () => {
      expect(noteEntries([note({ createdAt: undefined, updatedAt: undefined })], WORDS)).toEqual([]);
    });
  });

  describe('a prayer', () => {
    it('stands on the day it was brought, with the first paragraph of what it asks', () => {
      const [entry] = prayerEntries([prayer()]);
      expect(entry).toMatchObject({
        kind: 'prayer',
        refId: 'p1',
        date: '2026-09-02',
        title: 'За церковь',
        subtitle: 'Прийди и помоги нам.',
        href: '/prayers/p1',
      });
      expect(entry.status).toBeUndefined();
    });

    it('appears again on the day it was answered, marked answered', () => {
      const entries = prayerEntries([prayer({ status: 'answered', answeredAt: at(2026, 8, 20) })]);
      expect(entries.map((entry) => [entry.date, entry.status])).toEqual([
        ['2026-09-02', undefined],
        ['2026-09-20', 'answered'],
      ]);
    });

    it('appears once when brought and answered the same day', () => {
      expect(prayerEntries([prayer({ status: 'answered', answeredAt: at(2026, 8, 2, 20) })])).toHaveLength(1);
    });

    it('forgets the answer day of a prayer moved back to active', () => {
      expect(prayerEntries([prayer({ status: 'active', answeredAt: at(2026, 8, 20) })])).toHaveLength(1);
    });

    it('carries no subtitle when nothing was written under the title', () => {
      expect(prayerEntries([prayer({ description: undefined })])[0].subtitle).toBeUndefined();
    });
  });

  it('lists the kinds of a day in the one fixed order, notes and prayers included', () => {
    const entries = [
      ...prayerEntries([prayer({ createdAt: at(2026, 8, 6) })]),
      ...noteEntries([note({ createdAt: at(2026, 8, 6), updatedAt: at(2026, 8, 6) })], WORDS),
      ...sermonEntries([sermon()]),
    ];
    expect(kindsByDate(entries)).toEqual({ '2026-09-06': ['sermon', 'note', 'prayer'] });
    expect(countByKind(entries)).toEqual({ sermon: 1, group: 0, council: 0, note: 1, prayer: 1 });
  });
});
