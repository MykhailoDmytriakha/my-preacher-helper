import { StudyNote } from '@/models/models';
import { createStudyNoteBranchStateRecord } from '../../components/studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../../components/studyNoteOutline';

import { filterAndSortStudyNotes } from '../filterStudyNotes';
import { buildStudyNoteMetadataSummaryMap } from '../studyNoteMetadataSummary';
import { buildStudyWorkspaceRelationData } from '../studyNoteRelationSummary';

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

    it('filters notes by derived branch metadata and metadata search text', () => {
        const notes = [
            createNote('1', { title: 'Evidence note' }),
            createNote('2', { title: 'Question note' }),
            createNote('3', { title: 'Plain note' }),
        ];
        const metadataSummaryByNoteId = buildStudyNoteMetadataSummaryMap([
            {
                id: '1',
                noteId: '1',
                userId: 'user-1',
                branchRecords: [
                    {
                        branchId: 'branch-1',
                        title: 'Alpha',
                        titleSlug: 'alpha',
                        parentSlugChain: [],
                        bodyHash: '1',
                        subtreeHash: '1',
                        subtreeContentHash: '1',
                        subtreeOccurrenceIndex: 0,
                        contextualOccurrenceIndex: 0,
                        relaxedOccurrenceIndex: 0,
                        contextualContentOccurrenceIndex: 0,
                        relaxedContentOccurrenceIndex: 0,
                        branchKind: 'evidence',
                        branchStatus: 'confirmed',
                        semanticLabel: 'Blessing',
                    },
                ],
                readFoldedBranchIds: [],
                previewFoldedBranchIds: [],
                createdAt: '2026-03-13T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            },
            {
                id: '2',
                noteId: '2',
                userId: 'user-1',
                branchRecords: [
                    {
                        branchId: 'branch-2',
                        title: 'Beta',
                        titleSlug: 'beta',
                        parentSlugChain: [],
                        bodyHash: '2',
                        subtreeHash: '2',
                        subtreeContentHash: '2',
                        subtreeOccurrenceIndex: 0,
                        contextualOccurrenceIndex: 0,
                        relaxedOccurrenceIndex: 0,
                        contextualContentOccurrenceIndex: 0,
                        relaxedContentOccurrenceIndex: 0,
                        branchKind: 'question',
                        branchStatus: 'tentative',
                    },
                ],
                readFoldedBranchIds: [],
                previewFoldedBranchIds: [],
                createdAt: '2026-03-13T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            },
        ] as any);

        expect(filterAndSortStudyNotes({
            notes,
            branchKindFilter: 'evidence',
            noteMetadataSummaryByNoteId: metadataSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1']);

        expect(filterAndSortStudyNotes({
            notes,
            branchLabelFilter: 'labeled',
            noteMetadataSummaryByNoteId: metadataSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1']);

        expect(filterAndSortStudyNotes({
            notes,
            searchTokens: ['blessing'],
            noteMetadataSummaryByNoteId: metadataSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1']);
    });

    it('filters notes by derived relation labels and relation search text', () => {
        const notes = [
            createNote('1', {
                title: 'Supports note',
                content: [
                    '## Source',
                    'See [Target](#branch=branch-target "supports")',
                ].join('\n'),
            }),
            createNote('2', {
                title: 'Target note',
                content: [
                    '## Target',
                    'Target body',
                ].join('\n'),
            }),
            createNote('3', {
                title: 'Unrelated note',
                content: 'Plain note',
            }),
        ];
        const targetOutline = parseStudyNoteOutline(notes[1].content);
        const targetRecord = createStudyNoteBranchStateRecord(targetOutline.branches, '1', 'branch-target');

        expect(targetRecord).not.toBeNull();

        const relationSummaryByNoteId = buildStudyWorkspaceRelationData(notes, [
            {
                id: 'branch-state-2',
                noteId: '2',
                userId: 'user-1',
                branchRecords: [targetRecord!],
                readFoldedBranchIds: [],
                previewFoldedBranchIds: [],
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z',
            },
        ] as any).relationSummaryByNoteId;

        expect(filterAndSortStudyNotes({
            notes,
            branchRelationFilter: 'supports',
            noteRelationSummaryByNoteId: relationSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1', '2']);

        expect(filterAndSortStudyNotes({
            notes,
            searchTokens: ['supports'],
            noteRelationSummaryByNoteId: relationSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1', '2']);
    });

    it('applies relation and metadata filters together with AND semantics', () => {
        const relationSummaryByNoteId = new Map([
            ['1', { noteId: '1', totalRelations: 1, relationCounts: { supports: 1 }, relationLabels: ['supports'], normalizedRelationLabels: ['supports'] }],
            ['2', { noteId: '2', totalRelations: 1, relationCounts: { supports: 1 }, relationLabels: ['supports'], normalizedRelationLabels: ['supports'] }],
        ]) as any;
        const metadataSummaryByNoteId = buildStudyNoteMetadataSummaryMap([
            {
                id: '1',
                noteId: '1',
                userId: 'user-1',
                branchRecords: [
                    {
                        branchId: 'branch-1',
                        title: 'Alpha',
                        titleSlug: 'alpha',
                        parentSlugChain: [],
                        bodyHash: '1',
                        subtreeHash: '1',
                        subtreeContentHash: '1',
                        subtreeOccurrenceIndex: 0,
                        contextualOccurrenceIndex: 0,
                        relaxedOccurrenceIndex: 0,
                        contextualContentOccurrenceIndex: 0,
                        relaxedContentOccurrenceIndex: 0,
                        branchKind: 'evidence',
                    },
                ],
                readFoldedBranchIds: [],
                previewFoldedBranchIds: [],
                createdAt: '2026-03-13T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            },
            {
                id: '2',
                noteId: '2',
                userId: 'user-1',
                branchRecords: [
                    {
                        branchId: 'branch-2',
                        title: 'Beta',
                        titleSlug: 'beta',
                        parentSlugChain: [],
                        bodyHash: '2',
                        subtreeHash: '2',
                        subtreeContentHash: '2',
                        subtreeOccurrenceIndex: 0,
                        contextualOccurrenceIndex: 0,
                        relaxedOccurrenceIndex: 0,
                        contextualContentOccurrenceIndex: 0,
                        relaxedContentOccurrenceIndex: 0,
                        branchKind: 'question',
                    },
                ],
                readFoldedBranchIds: [],
                previewFoldedBranchIds: [],
                createdAt: '2026-03-13T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            },
        ] as any);

        expect(filterAndSortStudyNotes({
            notes: [
                createNote('1', { updatedAt: '2026-03-10T02:00:00.000Z' }),
                createNote('2', { updatedAt: '2026-03-10T01:00:00.000Z' }),
            ],
            branchKindFilter: 'evidence',
            branchRelationFilter: 'supports',
            noteMetadataSummaryByNoteId: metadataSummaryByNoteId,
            noteRelationSummaryByNoteId: relationSummaryByNoteId,
            bibleLocale: 'en',
        }).map((note) => note.id)).toEqual(['1']);
    });
});
