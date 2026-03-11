import { StudyNote } from '@/models/models';

import { BibleLocale, getLocalizedBookName } from '../bibleData';

export type StudyNoteTabFilter = 'all' | 'notes' | 'questions';

interface FilterAndSortStudyNotesOptions {
    notes: StudyNote[];
    activeTab?: StudyNoteTabFilter;
    tagFilter?: string;
    bookFilter?: string;
    searchTokens?: string[];
    bibleLocale: BibleLocale;
}

function getStudyNoteSearchHaystack(note: StudyNote, bibleLocale: BibleLocale): string {
    return `${note.title} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs
        .map((ref) => `${getLocalizedBookName(ref.book, bibleLocale)} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? `-${ref.toVerse}` : ''}`)
        .join(' ')}`.toLowerCase();
}

export function filterAndSortStudyNotes({
    notes,
    activeTab = 'all',
    tagFilter = '',
    bookFilter = '',
    searchTokens = [],
    bibleLocale,
}: FilterAndSortStudyNotesOptions): StudyNote[] {
    return notes
        .filter((note) => {
            if (activeTab === 'notes') {
                return note.type !== 'question';
            }

            if (activeTab === 'questions') {
                return note.type === 'question';
            }

            return true;
        })
        .filter((note) => (tagFilter ? note.tags.includes(tagFilter) : true))
        .filter((note) =>
            bookFilter
                ? note.scriptureRefs.some((ref) => ref.book.toLowerCase() === bookFilter.toLowerCase())
                : true
        )
        .filter((note) => {
            if (searchTokens.length === 0) {
                return true;
            }

            const haystack = getStudyNoteSearchHaystack(note, bibleLocale);
            return searchTokens.every((token) => haystack.includes(token));
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
