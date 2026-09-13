import {
  byNewestFirst,
  countByKind,
  councilEntries,
  entriesByDate,
  entriesInMonth,
  groupEntries,
  kindsByDate,
  sermonEntries,
} from '@/utils/calendarEntries';

import type { Council, Group, Sermon } from '@/models/models';

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
    expect(countByKind(entries)).toEqual({ sermon: 1, group: 1, council: 1 });
    expect(entriesInMonth(entries, '2026-09')).toHaveLength(3);
    expect(entriesInMonth(entries, '2026-10')).toHaveLength(0);
  });

  it('reads newest first, and settles same-day ties by kind so the order never wobbles', () => {
    const entries = [...councilEntries([council()]), ...sermonEntries([sermon()])].sort(byNewestFirst);
    expect(entries.map((entry) => entry.date)).toEqual(['2026-09-13', '2026-09-06']);
  });
});
