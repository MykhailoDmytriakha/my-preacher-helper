import { buildStudyNoteBranchBacklinks } from '../studyNoteBranchBacklinks';
import { StudyNoteOutline } from '../studyNoteOutline';

const outlineFixture: StudyNoteOutline = {
    introduction: '',
    hasOutline: true,
    totalBranches: 3,
    baseHeadingLevel: 2,
    branches: [
        {
            key: '1',
            branchId: 'branch-root',
            path: [1],
            depth: 0,
            headingLevel: 2,
            title: 'Root Branch',
            rawTitle: 'Root Branch',
            body: 'See [Child Branch](#branch=branch-child "supports") and [Child Branch](#branch=branch-child "supports").',
            preview: 'Root preview',
            children: [],
        },
        {
            key: '2',
            branchId: 'branch-child',
            path: [2],
            depth: 0,
            headingLevel: 2,
            title: 'Child Branch',
            rawTitle: 'Child Branch',
            body: 'Child body',
            preview: 'Child preview',
            children: [],
        },
        {
            key: '3',
            branchId: 'branch-self',
            path: [3],
            depth: 0,
            headingLevel: 2,
            title: 'Self Branch',
            rawTitle: 'Self Branch',
            body: 'See [Self Branch](#branch=branch-self)',
            preview: 'Self preview',
            children: [],
        },
    ],
};

describe('studyNoteBranchBacklinks', () => {
    it('builds backlinks from branch markdown references, keeps relation labels, and deduplicates identical references', () => {
        expect(buildStudyNoteBranchBacklinks(outlineFixture.branches)).toEqual({
            'branch-child': [
                {
                    sourceBranchKey: '1',
                    sourceBranchTitle: 'Root Branch',
                    sourceBranchDepth: 0,
                    sourceBranchId: 'branch-root',
                    referenceLabel: 'Child Branch',
                    relationLabel: 'supports',
                },
            ],
        });
    });
});
