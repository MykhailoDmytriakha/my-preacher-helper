import {
    buildStudyNoteBranchMarkdownReference,
    extractStudyNoteBranchMarkdownReferences,
    getStudyNoteBranchHash,
    parseStudyNoteBranchIdFromHash,
    parseStudyNoteBranchLinkMeta,
} from '../studyNoteBranchLinks';

describe('studyNoteBranchLinks', () => {
    it('builds a plain markdown branch reference', () => {
        expect(buildStudyNoteBranchMarkdownReference('Child Branch', 'branch-child')).toBe(
            '[Child Branch](#branch=branch-child)'
        );
    });

    it('builds a relation-labeled markdown branch reference', () => {
        expect(
            buildStudyNoteBranchMarkdownReference('Child Branch', 'branch-child', 'supports')
        ).toBe('[Child Branch](#branch=branch-child "supports")');
    });

    it('escapes markdown label and relation title content', () => {
        expect(
            buildStudyNoteBranchMarkdownReference('[Child] Branch', 'branch-child', 'supports "A"')
        ).toBe('[\\[Child\\] Branch](#branch=branch-child "supports \\"A\\"")');
    });

    it('parses branch ids from hash values', () => {
        expect(parseStudyNoteBranchIdFromHash(getStudyNoteBranchHash('branch-child'))).toBe('branch-child');
        expect(parseStudyNoteBranchIdFromHash('#other=branch-child')).toBeNull();
    });

    it('parses branch link metadata from href and title', () => {
        expect(parseStudyNoteBranchLinkMeta('#branch=branch-child', 'supports')).toEqual({
            branchId: 'branch-child',
            relationLabel: 'supports',
        });
    });

    it('extracts plain and labeled branch markdown references from markdown text', () => {
        expect(
            extractStudyNoteBranchMarkdownReferences([
                'See [Child Branch](#branch=branch-child).',
                'Compare [Second Branch](#branch=branch-second "contrasts").',
            ].join(' '))
        ).toEqual([
            {
                label: 'Child Branch',
                branchId: 'branch-child',
                relationLabel: null,
            },
            {
                label: 'Second Branch',
                branchId: 'branch-second',
                relationLabel: 'contrasts',
            },
        ]);
    });
});
