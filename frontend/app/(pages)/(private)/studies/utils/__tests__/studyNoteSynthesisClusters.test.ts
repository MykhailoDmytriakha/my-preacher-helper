import { StudyWorkspaceReviewBranchItem } from '../studyNoteMetadataSummary';
import { StudyWorkspaceRelationData } from '../studyNoteRelationSummary';
import { StudyWorkspaceSynthesisItem } from '../studyNoteSynthesisSummary';
import { buildStudyWorkspaceQuestionSynthesisClusters } from '../studyNoteSynthesisClusters';

describe('buildStudyWorkspaceQuestionSynthesisClusters', () => {
  it('builds question-centered support, contrast, and application clusters from workspace relation truth', () => {
    const openQuestionItems: StudyWorkspaceSynthesisItem[] = [
      {
        noteId: 'question-note',
        noteTitle: 'Question Note',
        branchId: 'question-branch',
        branchTitle: 'Open question',
        isResolved: true,
        branchKind: 'question',
        branchStatus: 'tentative',
        semanticLabel: 'Grace',
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
        relationBadges: [{ relationKey: 'supports', count: 1 }],
        relationTouchCount: 3,
      },
    ];
    const workspaceBranchInventory: StudyWorkspaceReviewBranchItem[] = [
      {
        noteId: 'question-note',
        noteTitle: 'Question Note',
        branchId: 'question-branch',
        branchTitle: 'Open question',
        isResolved: true,
        branchKind: 'question',
        branchStatus: 'tentative',
        semanticLabel: 'Grace',
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
      },
      {
        noteId: 'evidence-note',
        noteTitle: 'Evidence Note',
        branchId: 'evidence-branch',
        branchTitle: 'Confirmed evidence',
        isResolved: true,
        branchKind: 'evidence',
        branchStatus: 'confirmed',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-15T00:00:00.000Z',
      },
      {
        noteId: 'contrast-note',
        noteTitle: 'Contrast Note',
        branchId: 'contrast-branch',
        branchTitle: 'Counterpoint',
        isResolved: true,
        branchKind: 'evidence',
        branchStatus: 'active',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-14T00:00:00.000Z',
      },
      {
        noteId: 'application-note',
        noteTitle: 'Application Note',
        branchId: 'application-branch',
        branchTitle: 'Apply this truth',
        isResolved: true,
        branchKind: 'application',
        branchStatus: 'active',
        semanticLabel: 'Practice',
        noteUpdatedAt: '2026-03-13T00:00:00.000Z',
      },
    ];
    const relationData: StudyWorkspaceRelationData = {
      relationSummaryByNoteId: new Map(),
      topRelationLabels: [],
      relationLanes: [
        {
          relationLabel: 'supports',
          relationKey: 'supports',
          totalItems: 1,
          items: [
            {
              relationLabel: 'supports',
              relationKey: 'supports',
              sourceNoteId: 'evidence-note',
              sourceNoteTitle: 'Evidence Note',
              sourceBranchId: 'evidence-branch',
              sourceBranchTitle: 'Confirmed evidence',
              targetNoteId: 'question-note',
              targetNoteTitle: 'Question Note',
              targetBranchId: 'question-branch',
              targetBranchTitle: 'Open question',
              sourceUpdatedAt: '2026-03-15T00:00:00.000Z',
              isResolved: true,
            },
          ],
        },
        {
          relationLabel: 'contrasts',
          relationKey: 'contrasts',
          totalItems: 1,
          items: [
            {
              relationLabel: 'contrasts',
              relationKey: 'contrasts',
              sourceNoteId: 'contrast-note',
              sourceNoteTitle: 'Contrast Note',
              sourceBranchId: 'contrast-branch',
              sourceBranchTitle: 'Counterpoint',
              targetNoteId: 'question-note',
              targetNoteTitle: 'Question Note',
              targetBranchId: 'question-branch',
              targetBranchTitle: 'Open question',
              sourceUpdatedAt: '2026-03-14T00:00:00.000Z',
              isResolved: true,
            },
          ],
        },
        {
          relationLabel: 'applies',
          relationKey: 'applies',
          totalItems: 2,
          items: [
            {
              relationLabel: 'applies',
              relationKey: 'applies',
              sourceNoteId: 'application-note',
              sourceNoteTitle: 'Application Note',
              sourceBranchId: 'application-branch',
              sourceBranchTitle: 'Apply this truth',
              targetNoteId: 'question-note',
              targetNoteTitle: 'Question Note',
              targetBranchId: 'question-branch',
              targetBranchTitle: 'Open question',
              sourceUpdatedAt: '2026-03-13T00:00:00.000Z',
              isResolved: true,
            },
            {
              relationLabel: 'applies',
              relationKey: 'applies',
              sourceNoteId: 'application-note',
              sourceNoteTitle: 'Application Note',
              sourceBranchId: 'application-branch',
              sourceBranchTitle: 'Apply this truth',
              targetNoteId: 'question-note',
              targetNoteTitle: 'Question Note',
              targetBranchId: 'question-branch',
              targetBranchTitle: 'Open question',
              sourceUpdatedAt: '2026-03-13T00:00:00.000Z',
              isResolved: true,
            },
          ],
        },
      ],
    };

    const clusters = buildStudyWorkspaceQuestionSynthesisClusters(
      openQuestionItems,
      workspaceBranchInventory,
      relationData
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].question.branchId).toBe('question-branch');
    expect(clusters[0].supportLinks.map((link) => link.branchId)).toEqual(['evidence-branch']);
    expect(clusters[0].contrastLinks.map((link) => link.branchId)).toEqual(['contrast-branch']);
    expect(clusters[0].applicationLinks.map((link) => link.branchId)).toEqual(['application-branch']);
    expect(clusters[0].applicationLinks[0].semanticLabel).toBe('Practice');
  });

  it('ignores unresolved relation items and unresolved questions', () => {
    const unresolvedQuestionItems: StudyWorkspaceSynthesisItem[] = [
      {
        noteId: 'question-note',
        noteTitle: 'Question Note',
        branchId: 'question-branch',
        branchTitle: 'Open question',
        isResolved: false,
        branchKind: 'question',
        branchStatus: 'tentative',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
        relationBadges: [],
        relationTouchCount: 0,
      },
    ];
    const relationData: StudyWorkspaceRelationData = {
      relationSummaryByNoteId: new Map(),
      topRelationLabels: [],
      relationLanes: [
        {
          relationLabel: 'supports',
          relationKey: 'supports',
          totalItems: 1,
          items: [
            {
              relationLabel: 'supports',
              relationKey: 'supports',
              sourceNoteId: 'evidence-note',
              sourceNoteTitle: 'Evidence Note',
              sourceBranchId: 'evidence-branch',
              sourceBranchTitle: 'Confirmed evidence',
              targetNoteId: 'question-note',
              targetNoteTitle: 'Question Note',
              targetBranchId: 'question-branch',
              targetBranchTitle: 'Open question',
              sourceUpdatedAt: '2026-03-15T00:00:00.000Z',
              isResolved: false,
            },
          ],
        },
      ],
    };

    const clusters = buildStudyWorkspaceQuestionSynthesisClusters(
      unresolvedQuestionItems,
      [],
      relationData
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].supportLinks).toEqual([]);
    expect(clusters[0].contrastLinks).toEqual([]);
    expect(clusters[0].applicationLinks).toEqual([]);
  });
});
