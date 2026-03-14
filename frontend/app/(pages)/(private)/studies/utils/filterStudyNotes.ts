import { StudyNote, StudyNoteBranchKind, StudyNoteBranchStatus } from '@/models/models';

import { BibleLocale, getLocalizedBookName } from '../bibleData';

import {
    buildStudyNoteMetadataSearchText,
    noteMatchesStudyMetadataFilters,
    StudyNoteMetadataLabelFilter,
    StudyNoteMetadataSummary,
} from './studyNoteMetadataSummary';

export type StudyNoteTabFilter = 'all' | 'notes' | 'questions';

interface FilterAndSortStudyNotesOptions {
    notes: StudyNote[];
    activeTab?: StudyNoteTabFilter;
    tagFilter?: string;
    bookFilter?: string;
    searchTokens?: string[];
    branchKindFilter?: StudyNoteBranchKind | '';
    branchStatusFilter?: StudyNoteBranchStatus | '';
    branchLabelFilter?: StudyNoteMetadataLabelFilter;
    noteMetadataSummaryByNoteId?: Map<string, StudyNoteMetadataSummary>;
    bibleLocale: BibleLocale;
}

function getStudyNoteSearchHaystack(
    note: StudyNote,
    bibleLocale: BibleLocale,
    metadataSummary?: StudyNoteMetadataSummary
): string {
    return `${note.title} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs
        .map((ref) => `${getLocalizedBookName(ref.book, bibleLocale)} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? `-${ref.toVerse}` : ''}`)
        .join(' ')} ${buildStudyNoteMetadataSearchText(metadataSummary)}`.toLowerCase();
}

export function filterAndSortStudyNotes({
    notes,
    activeTab = 'all',
    tagFilter = '',
    bookFilter = '',
    searchTokens = [],
    branchKindFilter = '',
    branchStatusFilter = '',
    branchLabelFilter = 'all',
    noteMetadataSummaryByNoteId,
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
        .filter((note) =>
            noteMatchesStudyMetadataFilters(noteMetadataSummaryByNoteId?.get(note.id), {
                kindFilter: branchKindFilter,
                statusFilter: branchStatusFilter,
                labelFilter: branchLabelFilter,
            })
        )
        .filter((note) => {
            if (searchTokens.length === 0) {
                return true;
            }

            const haystack = getStudyNoteSearchHaystack(note, bibleLocale, noteMetadataSummaryByNoteId?.get(note.id));
            return searchTokens.every((token) => haystack.includes(token));
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
