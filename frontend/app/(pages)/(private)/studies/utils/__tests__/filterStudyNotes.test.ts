import { StudyNote } from '@/models/models';

import { filterAndSortStudyNotes } from '../filterStudyNotes';

function createNote(id: string, overrides: Partial<StudyNote> = {}): StudyNote {
    return {
        id,
        title: `Title ${id}`,
        content: `Body ${id}`,
        tags: [],
        scriptureRefs: [],
        userId: 'user-1',
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
        isDraft: false,
        type: 'note',
        ...overrides,
    };
}

describe('filterAndSortStudyNotes', () => {
    it('filters by tab, tag, book, search tokens, and sorts newest first', () => {
        const notes = [
            createNote('1', {
                title: 'Blessing study',
                content: 'Mercy and blessing',
                tags: ['hope'],
                scriptureRefs: [{ id: 'r1', book: 'Genesis', chapter: 1, fromVerse: 1 }],
                updatedAt: '2026-03-10T02:00:00.000Z',
            }),
            createNote('2', {
                title: 'Question note',
                content: 'Why this happened',
                tags: ['hope'],
                type: 'question',
                updatedAt: '2026-03-10T03:00:00.000Z',
            }),
            createNote('3', {
                title: 'Judgment study',
                content: 'Warning section',
                tags: ['warning'],
                scriptureRefs: [{ id: 'r2', book: 'Exodus', chapter: 2, fromVerse: 3 }],
                updatedAt: '2026-03-10T01:00:00.000Z',
            }),
        ];

        expect(filterAndSortStudyNotes({
            notes,
            activeTab: 'notes',
            tagFilter: 'hope',
            bookFilter: 'genesis',
            searchTokens: ['blessing', 'mercy'],
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1']);
    });

    it('returns all matching notes sorted by updatedAt descending when no extra filters apply', () => {
        const notes = [
            createNote('1', { updatedAt: '2026-03-10T01:00:00.000Z' }),
            createNote('2', { updatedAt: '2026-03-10T03:00:00.000Z' }),
            createNote('3', { updatedAt: '2026-03-10T02:00:00.000Z' }),
        ];

        expect(filterAndSortStudyNotes({
            notes,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['2', '3', '1']);
    });
});
