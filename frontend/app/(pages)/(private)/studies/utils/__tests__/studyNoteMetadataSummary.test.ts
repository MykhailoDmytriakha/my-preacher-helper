import { StudyNoteBranchState } from '@/models/models';
import { createStudyNoteBranchStateRecord } from '../../components/studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../../components/studyNoteOutline';

import {
  buildStudyWorkspaceTopSemanticLabels,
  buildStudyWorkspaceReviewLanes,
  buildStudyNoteMetadataSearchText,
  buildStudyNoteMetadataSummaryMap,
  buildStudyWorkspaceMetadataCounts,
  noteMatchesStudyMetadataFilters,
  summarizeStudyNoteBranchState,
} from '../studyNoteMetadataSummary';

const makeBranchState = (overrides: Partial<StudyNoteBranchState> = {}): StudyNoteBranchState => ({
  id: 'note-1',
  noteId: 'note-1',
  userId: 'user-1',
  branchRecords: [],
  readFoldedBranchIds: [],
  previewFoldedBranchIds: [],
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
  ...overrides,
});

describe('studyNoteMetadataSummary', () => {
  it('summarizes branch metadata counts and labels', () => {
    const summary = summarizeStudyNoteBranchState(
      makeBranchState({
        branchRecords: [
          { branchId: 'a', title: 'A', titleSlug: 'a', parentSlugChain: [], bodyHash: '1', subtreeHash: '1', subtreeContentHash: '1', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'evidence', branchStatus: 'confirmed', semanticLabel: 'Theme' },
          { branchId: 'b', title: 'B', titleSlug: 'b', parentSlugChain: [], bodyHash: '2', subtreeHash: '2', subtreeContentHash: '2', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'evidence', branchStatus: 'active', semanticLabel: 'Theme' },
        ],
      })
    );

    expect(summary).toEqual({
      noteId: 'note-1',
      branchCount: 2,
      labeledBranchCount: 2,
      branchKindCounts: { evidence: 2 },
      branchStatusCounts: { confirmed: 1, active: 1 },
      semanticLabels: ['Theme'],
    });
  });

  it('matches metadata filters against the derived summary', () => {
    const summary = summarizeStudyNoteBranchState(
      makeBranchState({
        branchRecords: [
          { branchId: 'a', title: 'A', titleSlug: 'a', parentSlugChain: [], bodyHash: '1', subtreeHash: '1', subtreeContentHash: '1', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'question', branchStatus: 'tentative', semanticLabel: 'Open issue' },
        ],
      })
    );

    expect(noteMatchesStudyMetadataFilters(summary ?? undefined, { kindFilter: 'question' })).toBe(true);
    expect(noteMatchesStudyMetadataFilters(summary ?? undefined, { statusFilter: 'tentative' })).toBe(true);
    expect(noteMatchesStudyMetadataFilters(summary ?? undefined, { labelFilter: 'labeled' })).toBe(true);
    expect(noteMatchesStudyMetadataFilters(summary ?? undefined, { kindFilter: 'evidence' })).toBe(false);
  });

  it('builds workspace counts per note, not per branch', () => {
    const states = [
      makeBranchState({
        id: 'note-1',
        noteId: 'note-1',
        branchRecords: [
          { branchId: 'a', title: 'A', titleSlug: 'a', parentSlugChain: [], bodyHash: '1', subtreeHash: '1', subtreeContentHash: '1', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'evidence', branchStatus: 'confirmed', semanticLabel: 'Theme' },
          { branchId: 'b', title: 'B', titleSlug: 'b', parentSlugChain: [], bodyHash: '2', subtreeHash: '2', subtreeContentHash: '2', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'evidence', branchStatus: 'confirmed' },
        ],
      }),
      makeBranchState({
        id: 'note-2',
        noteId: 'note-2',
        branchRecords: [
          { branchId: 'c', title: 'C', titleSlug: 'c', parentSlugChain: [], bodyHash: '3', subtreeHash: '3', subtreeContentHash: '3', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'question', branchStatus: 'active' },
        ],
      }),
    ];

    const notes = [
      { id: 'note-1' },
      { id: 'note-2' },
      { id: 'note-3' },
    ] as any;

    const counts = buildStudyWorkspaceMetadataCounts(notes, buildStudyNoteMetadataSummaryMap(states));

    expect(counts).toEqual({
      notesWithMetadata: 2,
      labeledNotes: 1,
      kindNoteCounts: { evidence: 1, question: 1 },
      statusNoteCounts: { confirmed: 1, active: 1 },
    });
  });

  it('builds metadata search text from kinds, statuses, and labels', () => {
    const summary = summarizeStudyNoteBranchState(
      makeBranchState({
        branchRecords: [
          { branchId: 'a', title: 'A', titleSlug: 'a', parentSlugChain: [], bodyHash: '1', subtreeHash: '1', subtreeContentHash: '1', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, branchKind: 'application', branchStatus: 'resolved', semanticLabel: 'Blessing' },
        ],
      })
    );

    expect(buildStudyNoteMetadataSearchText(summary ?? undefined)).toContain('application');
    expect(buildStudyNoteMetadataSearchText(summary ?? undefined)).toContain('resolved');
    expect(buildStudyNoteMetadataSearchText(summary ?? undefined)).toContain('blessing');
  });

  it('builds top semantic labels across notes by note count', () => {
    const notes = [
      { id: 'note-1' },
      { id: 'note-2' },
      { id: 'note-3' },
    ] as any;

    const summaries = buildStudyNoteMetadataSummaryMap([
      makeBranchState({
        id: 'note-1',
        noteId: 'note-1',
        branchRecords: [
          { branchId: 'a', title: 'A', titleSlug: 'a', parentSlugChain: [], bodyHash: '1', subtreeHash: '1', subtreeContentHash: '1', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, semanticLabel: 'Theme' },
          { branchId: 'b', title: 'B', titleSlug: 'b', parentSlugChain: [], bodyHash: '2', subtreeHash: '2', subtreeContentHash: '2', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, semanticLabel: 'Grace' },
        ],
      }),
      makeBranchState({
        id: 'note-2',
        noteId: 'note-2',
        branchRecords: [
          { branchId: 'c', title: 'C', titleSlug: 'c', parentSlugChain: [], bodyHash: '3', subtreeHash: '3', subtreeContentHash: '3', subtreeOccurrenceIndex: 0, contextualOccurrenceIndex: 0, relaxedOccurrenceIndex: 0, contextualContentOccurrenceIndex: 0, relaxedContentOccurrenceIndex: 0, semanticLabel: 'Theme' },
        ],
      }),
    ] as any);

    expect(buildStudyWorkspaceTopSemanticLabels(notes, summaries)).toEqual([
      { label: 'Theme', noteCount: 2 },
      { label: 'Grace', noteCount: 1 },
    ]);
  });

  it('builds branch-level workspace review lanes from note metadata records', () => {
    const notes = [
      { id: 'note-1', title: 'Evidence Note', updatedAt: '2026-03-13T00:00:00.000Z' },
      { id: 'note-2', title: 'Question Note', updatedAt: '2026-03-12T00:00:00.000Z' },
    ] as any;

    const reviewLanes = buildStudyWorkspaceReviewLanes(notes, [
      makeBranchState({
        id: 'note-1',
        noteId: 'note-1',
        branchRecords: [
          {
            branchId: 'branch-1',
            title: 'Evidence',
            titleSlug: 'evidence',
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
            semanticLabel: 'Grace',
          },
        ],
      }),
      makeBranchState({
        id: 'note-2',
        noteId: 'note-2',
        branchRecords: [
          {
            branchId: 'branch-2',
            title: 'Question',
            titleSlug: 'question',
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
      }),
    ] as any);

    expect(reviewLanes).toEqual([
      {
        id: 'evidence',
        totalItems: 1,
        items: [
          expect.objectContaining({
            noteId: 'note-1',
            noteTitle: 'Evidence Note',
            branchId: 'branch-1',
            branchTitle: 'Evidence',
            isResolved: false,
          }),
        ],
      },
      {
        id: 'question',
        totalItems: 1,
        items: [
          expect.objectContaining({
            noteId: 'note-2',
            branchId: 'branch-2',
            isResolved: false,
          }),
        ],
      },
      {
        id: 'confirmed',
        totalItems: 1,
        items: [
          expect.objectContaining({
            branchId: 'branch-1',
            isResolved: false,
          }),
        ],
      },
      {
        id: 'application',
        totalItems: 0,
        items: [],
      },
      {
        id: 'labeled',
        totalItems: 1,
        items: [
          expect.objectContaining({
            branchId: 'branch-1',
            semanticLabel: 'Grace',
            isResolved: false,
          }),
        ],
      },
    ]);
  });

  it('prefers live hydrated branch titles in review lanes after a heading rename', () => {
    const noteContent = '## Fresh Evidence\nBody text';
    const outline = parseStudyNoteOutline(noteContent);
    const liveRecord = createStudyNoteBranchStateRecord(outline.branches, '1', 'branch-1');

    expect(liveRecord).not.toBeNull();

    const staleRecord = {
      ...liveRecord!,
      title: 'Old Evidence',
      titleSlug: 'old-evidence',
    };

    const reviewLanes = buildStudyWorkspaceReviewLanes([
      { id: 'note-1', title: 'Evidence Note', content: noteContent, updatedAt: '2026-03-13T00:00:00.000Z' } as any,
    ], [
      makeBranchState({
        id: 'note-1',
        noteId: 'note-1',
        branchRecords: [{
          ...staleRecord,
          branchKind: 'evidence',
        }],
      }),
    ]);

    expect(reviewLanes[0].items[0]).toEqual(expect.objectContaining({
      branchId: 'branch-1',
      branchTitle: 'Fresh Evidence',
      isResolved: true,
    }));
  });

  it('marks review lane items as unresolved when persisted branch identity no longer maps to the live outline', () => {
    const reviewLanes = buildStudyWorkspaceReviewLanes([
      { id: 'note-1', title: 'Evidence Note', content: '## Completely Different\nNew body', updatedAt: '2026-03-13T00:00:00.000Z' } as any,
    ], [
      makeBranchState({
        id: 'note-1',
        noteId: 'note-1',
        branchRecords: [{
          branchId: 'branch-stale',
          title: 'Snapshot Evidence',
          titleSlug: 'snapshot-evidence',
          parentSlugChain: [],
          bodyHash: 'old-body',
          subtreeHash: 'old-subtree',
          subtreeContentHash: 'old-subtree-content',
          subtreeOccurrenceIndex: 0,
          contextualOccurrenceIndex: 0,
          relaxedOccurrenceIndex: 0,
          contextualContentOccurrenceIndex: 0,
          relaxedContentOccurrenceIndex: 0,
          branchKind: 'evidence',
        }],
      }),
    ]);

    expect(reviewLanes[0].items[0]).toEqual(expect.objectContaining({
      branchId: 'branch-stale',
      branchTitle: 'Snapshot Evidence',
      isResolved: false,
    }));
  });
});
