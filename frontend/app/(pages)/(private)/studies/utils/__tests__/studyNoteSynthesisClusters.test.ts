import { StudyWorkspaceReviewBranchItem } from '../studyNoteMetadataSummary';
import { StudyWorkspaceRelationData } from '../studyNoteRelationSummary';
import { StudyWorkspaceSynthesisItem } from '../studyNoteSynthesisSummary';
import {
  buildStudyWorkspaceQuestionSynthesisClusterGroups,
  buildStudyWorkspaceQuestionSynthesisClusters,
  StudyWorkspaceQuestionSynthesisCluster,
} from '../studyNoteSynthesisClusters';

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

  it('ignores unresolved relation items and rejects unresolved questions from cluster output', () => {
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

    expect(clusters).toEqual([]);
  });

  it('groups question synthesis clusters by workflow stage and semantic theme', () => {
    const clusters = [
      {
        question: {
          noteId: 'q1',
          noteTitle: 'Question Note',
          branchId: 'q1-branch',
          branchTitle: 'Needs evidence',
          isResolved: true,
          branchKind: 'question' as const,
          branchStatus: 'tentative' as const,
          semanticLabel: 'Grace',
          noteUpdatedAt: '2026-03-17T00:00:00.000Z',
          relationBadges: [],
          relationTouchCount: 0,
        },
        supportLinks: [],
        contrastLinks: [],
        applicationLinks: [],
      },
      {
        question: {
          noteId: 'q2',
          noteTitle: 'Question Note',
          branchId: 'q2-branch',
          branchTitle: 'Has support',
          isResolved: true,
          branchKind: 'question' as const,
          branchStatus: 'tentative' as const,
          semanticLabel: 'Grace',
          noteUpdatedAt: '2026-03-17T00:00:00.000Z',
          relationBadges: [{ relationKey: 'supports', count: 1 }],
          relationTouchCount: 1,
        },
        supportLinks: [
          {
            noteId: 'e1',
            noteTitle: 'Evidence Note',
            branchId: 'e1-branch',
            branchTitle: 'Evidence',
            isResolved: true,
            branchKind: 'evidence' as const,
            branchStatus: 'confirmed' as const,
            semanticLabel: null,
            noteUpdatedAt: '2026-03-17T00:00:00.000Z',
            relationKey: 'supports',
          },
        ],
        contrastLinks: [],
        applicationLinks: [],
      },
      {
        question: {
          noteId: 'q3',
          noteTitle: 'Question Note',
          branchId: 'q3-branch',
          branchTitle: 'Ready to apply',
          isResolved: true,
          branchKind: 'question' as const,
          branchStatus: 'tentative' as const,
          semanticLabel: null,
          noteUpdatedAt: '2026-03-17T00:00:00.000Z',
          relationBadges: [{ relationKey: 'applies', count: 1 }],
          relationTouchCount: 1,
        },
        supportLinks: [],
        contrastLinks: [],
        applicationLinks: [
          {
            noteId: 'a1',
            noteTitle: 'Application Note',
            branchId: 'a1-branch',
            branchTitle: 'Application',
            isResolved: true,
            branchKind: 'application' as const,
            branchStatus: 'active' as const,
            semanticLabel: null,
            noteUpdatedAt: '2026-03-17T00:00:00.000Z',
            relationKey: 'applies',
          },
        ],
      },
    ];

    expect(buildStudyWorkspaceQuestionSynthesisClusterGroups(clusters, 'workflow')).toEqual([
      { id: 'needsEvidence', label: 'needsEvidence', totalClusters: 1, clusters: [clusters[0]] },
      { id: 'hasSupport', label: 'hasSupport', totalClusters: 1, clusters: [clusters[1]] },
      { id: 'readyToApply', label: 'readyToApply', totalClusters: 1, clusters: [clusters[2]] },
    ]);

    expect(buildStudyWorkspaceQuestionSynthesisClusterGroups(clusters, 'theme')).toEqual([
      { id: 'grace', label: 'Grace', totalClusters: 2, clusters: [clusters[0], clusters[1]] },
      { id: 'unlabeled', label: 'unlabeled', totalClusters: 1, clusters: [clusters[2]] },
    ]);
  });

  it('keeps empty workflow stages visible for board-style grouping', () => {
    const clusters: StudyWorkspaceQuestionSynthesisCluster[] = [
      {
        question: {
          noteId: 'q1',
          noteTitle: 'Question Note',
          branchId: 'q1-branch',
          branchTitle: 'Ready to apply',
          isResolved: true,
          branchKind: 'question',
          branchStatus: 'tentative',
          semanticLabel: null,
          noteUpdatedAt: '2026-03-17T00:00:00.000Z',
          relationBadges: [{ relationKey: 'applies', count: 1 }],
          relationTouchCount: 1,
        },
        supportLinks: [],
        contrastLinks: [],
        applicationLinks: [
          {
            noteId: 'a1',
            noteTitle: 'Application Note',
            branchId: 'a1-branch',
            branchTitle: 'Application',
            isResolved: true,
            branchKind: 'application',
            branchStatus: 'active',
            semanticLabel: null,
            noteUpdatedAt: '2026-03-17T00:00:00.000Z',
            relationKey: 'applies',
          },
        ],
      },
    ];

    expect(buildStudyWorkspaceQuestionSynthesisClusterGroups(clusters, 'workflow')).toEqual([
      { id: 'needsEvidence', label: 'needsEvidence', totalClusters: 0, clusters: [] },
      { id: 'hasSupport', label: 'hasSupport', totalClusters: 0, clusters: [] },
      { id: 'readyToApply', label: 'readyToApply', totalClusters: 1, clusters },
    ]);
  });

  it('treats support as incoming-only for question synthesis clusters', () => {
    const openQuestionItems: StudyWorkspaceSynthesisItem[] = [
      {
        noteId: 'question-note',
        noteTitle: 'Question Note',
        branchId: 'question-branch',
        branchTitle: 'Open question',
        isResolved: true,
        branchKind: 'question',
        branchStatus: 'tentative',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
        relationBadges: [],
        relationTouchCount: 1,
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
        semanticLabel: null,
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
      },
      {
        noteId: 'evidence-note',
        noteTitle: 'Evidence Note',
        branchId: 'evidence-branch',
        branchTitle: 'Supporting point',
        isResolved: true,
        branchKind: 'evidence',
        branchStatus: 'confirmed',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-15T00:00:00.000Z',
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
              sourceNoteId: 'question-note',
              sourceNoteTitle: 'Question Note',
              sourceBranchId: 'question-branch',
              sourceBranchTitle: 'Open question',
              targetNoteId: 'evidence-note',
              targetNoteTitle: 'Evidence Note',
              targetBranchId: 'evidence-branch',
              targetBranchTitle: 'Supporting point',
              sourceUpdatedAt: '2026-03-16T00:00:00.000Z',
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
    expect(clusters[0].supportLinks).toEqual([]);
  });
});
