import { bookUsage, passageCovers, usageDocuments } from '@/utils/scriptureUsage';

import type { Group, Sermon, ServiceOrder, StudyNote } from '@/models/models';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

const note = (id: string, refs: ScriptureRefShape[], content = '', updatedAt = ''): StudyNote => ({ id, title: id, userId: 'owner', content,
  scriptureRefs: refs.map((ref, index) => ({ ...ref, id: String(index) })), tags: [], createdAt: '', updatedAt, isDraft: false });
const sermon = (value: Partial<Sermon>): Sermon => ({ id: 'sermon', title: 'Sermon', userId: 'owner', verse: '', date: '', thoughts: [], ...value });
const group = (id: string, refs: string[], content = ''): Group => ({ id, userId: 'owner', title: id, status: 'draft', templates: [
  { id: 'b', type: 'scripture', title: 'Чтение', content, scriptureRefs: refs, status: 'filled' },
], flow: [], createdAt: '', updatedAt: '' } as unknown as Group);
const order = (id: string, refs: string[], body = ''): ServiceOrder => ({ id, userId: 'owner', title: id, rank: 1, createdAt: '', updatedAt: '',
  steps: [{ id: 's', title: 'Чтение Писания', body, scriptureRefs: refs }] });

const entries = (sources: { notes?: StudyNote[]; sermons?: Sermon[]; groups?: Group[]; serviceOrders?: ServiceOrder[] }, bookId = 'Hebrews', bible: 'rst' | 'kjv' = 'rst') =>
  bookUsage(usageDocuments({ notes: [], sermons: [], groups: [], ...sources, locale: 'ru' }), bookId, bible);
const places = (list: ReturnType<typeof entries>) => list.map(({ kind, id, passage }) => [kind, id, passage]);

describe('a book gathers everything of the person\'s that points at its verses', () => {
  it('puts each kind on the verses it names: a note\'s list and words, a sermon\'s verse, a group\'s block, a service order\'s step', () => {
    const found = entries({
      notes: [note('rest', [{ bible: 'rst', book: 'Hebrews', chapter: 4, fromVerse: 1, toVerse: 3 }], 'Второе: Евр 4:12 — слово острее меча.')],
      sermons: [sermon({ id: 'sabbath', verse: 'Евр 4:9-11' })],
      groups: [group('thursday', ['Евр 4:14-16'])],
      serviceOrders: [order('funeral', ['Евр 4:9-10'])],
    });
    expect(places(found)).toEqual([
      ['note', 'rest', { chapter: 4, toChapter: 4, fromVerse: 1, toVerse: 3 }],
      ['sermon', 'sabbath', { chapter: 4, toChapter: 4, fromVerse: 9, toVerse: 11 }],
      ['order', 'funeral', { chapter: 4, toChapter: 4, fromVerse: 9, toVerse: 10 }],
      ['note', 'rest', { chapter: 4, toChapter: 4, fromVerse: 12, toVerse: 12 }],
      ['group', 'thursday', { chapter: 4, toChapter: 4, fromVerse: 14, toVerse: 16 }],
    ]);
    expect(found.map(entry => entry.href)).toEqual(['/studies/rest', '/sermons/sabbath', '/care/orders/funeral', '/studies/rest', '/groups/thursday']);
    // The row under a badge shows the words around the mention, not the start of the note.
    expect(found[3].excerpt).toContain('Евр 4:12');
    // A sermon's verse line says only its place: no words are shown for it.
    expect(found[1].excerpt).toBe('');
  });

  it('stands on the verse of the Bible being read: Synodal Psalm 22 is King James Psalm 23', () => {
    const sources = { sermons: [sermon({ id: 'shepherd', verse: 'Пс 22:1' })] };
    expect(places(entries(sources, 'Psalms', 'rst'))).toEqual([['sermon', 'shepherd', { chapter: 22, toChapter: 22, fromVerse: 1, toVerse: 1 }]]);
    expect(places(entries(sources, 'Psalms', 'kjv'))).toEqual([['sermon', 'shepherd', { chapter: 23, toChapter: 23, fromVerse: 1, toVerse: 1 }]]);
  });

  it('keeps a whole chapter whole, and leaves out a whole book and other books', () => {
    const found = entries({ notes: [
      note('plan', [{ bible: 'rst', book: 'Hebrews', chapter: 4 }]),
      note('book', [{ bible: 'rst', book: 'Hebrews' }]),
      note('elsewhere', [{ bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 28 }]),
    ] });
    expect(places(found)).toEqual([['note', 'plan', { chapter: 4, toChapter: 4 }]]);
  });

  it('shows a document on a place once: a mention inside its own passage, or named twice, adds no badge', () => {
    const found = entries({ sermons: [sermon({
      id: 'sabbath', verse: 'Евр 4:9-11',
      thoughts: [{ id: 't1', text: 'Евр 4:10 — успокоился от дел.', tags: [], date: '' }, { id: 't2', text: 'Снова Евр 4:9-11.', tags: [], date: '' }],
    })] });
    expect(places(found)).toEqual([['sermon', 'sabbath', { chapter: 4, toChapter: 4, fromVerse: 9, toVerse: 11 }]]);
    // A whole chapter holds its verses too.
    const chapter = entries({ notes: [note('plan', [{ bible: 'rst', book: 'Hebrews', chapter: 4 }], 'Ключ — Евр 4:12.')] });
    expect(places(chapter)).toEqual([['note', 'plan', { chapter: 4, toChapter: 4 }]]);
  });

  it('orders a verse\'s badges sermon first, then notes, groups and service orders', () => {
    const verse = 'Евр 4:12';
    const found = entries({
      serviceOrders: [order('o', [verse])], groups: [group('g', [verse])], notes: [note('n', [], verse)], sermons: [sermon({ id: 's', verse })],
    });
    expect(found.map(entry => entry.kind)).toEqual(['sermon', 'note', 'group', 'order']);
  });
});

describe('what the review of 2026-10-21 found', () => {
  it('leaves out a place its own Bible lacks, rather than standing on another Bible\'s verse there', () => {
    // The Synodal ends Joel at chapter 3; Ohienko has a chapter 4.
    const sources = { notes: [note('joel', [{ bible: 'rst', book: 'Joel', chapter: 4, fromVerse: 1 }])] };
    expect(entries(sources, 'Joel', 'rst')).toEqual([]);
    expect(bookUsage(usageDocuments({ notes: sources.notes, sermons: [], groups: [], locale: 'ru' }), 'Joel', 'ubio')).toEqual([]);
  });

  it('leaves out a chapter range past the end of the book, instead of laying it out chapter by chapter', () => {
    const found = entries({ notes: [note('huge', [{ bible: 'rst', book: 'Hebrews', chapter: 4, toChapter: 999999999 }])] });
    expect(found).toEqual([]);
  });

  it('finds a group\'s references where the meeting shows them: a block\'s questions and a meeting\'s notes', () => {
    const asked = { ...group('asked', []), templates: [{ id: 'b', type: 'questions', title: 'Вопросы', content: '', questions: ['Прочитайте Евр 4:12. Что это значит?'], status: 'filled' }],
      flow: [{ id: 'f', templateId: 'b', order: 0, instanceNotes: 'В четверг читали Евр 4:16.' }] } as unknown as Group;
    // A chapter in a block's text keeps its place whatever questions follow it.
    const chapterThenQuestion = { ...group('chapter', []), templates: [{ id: 'b', type: 'scripture', title: 'Чтение', content: 'Евр 4', questions: ['Что значит эта глава?'], status: 'filled' }] } as unknown as Group;
    expect(places(entries({ groups: [chapterThenQuestion] }))).toEqual([['group', 'chapter', { chapter: 4, toChapter: 4 }]]);
    expect(places(entries({ groups: [asked] }))).toEqual([
      ['group', 'asked', { chapter: 4, toChapter: 4, fromVerse: 12, toVerse: 12 }],
      ['group', 'asked', { chapter: 4, toChapter: 4, fromVerse: 16, toVerse: 16 }],
    ]);
  });
});

describe('which verses a passage holds', () => {
  it('runs from its first verse to its last, across a chapter seam too, and holds a whole chapter', () => {
    const seam = { chapter: 9, toChapter: 10, fromVerse: 19, toVerse: 4 };
    expect([[9, 18], [9, 19], [9, 21], [10, 1], [10, 4], [10, 5]].map(([c, v]) => passageCovers(seam, c, v))).toEqual([false, true, true, true, true, false]);
    expect(passageCovers({ chapter: 4, toChapter: 4 }, 4, 16)).toBe(true);
    expect(passageCovers({ chapter: 4, toChapter: 4 }, 5, 1)).toBe(false);
  });
});
