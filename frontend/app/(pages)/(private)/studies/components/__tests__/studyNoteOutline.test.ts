import {
    filterStudyNoteOutlineKeys,
    getCollapsibleStudyNoteBranchKeys,
    parseStudyNoteOutline,
} from '../studyNoteOutline';

describe('studyNoteOutline', () => {
    it('parses heading-first branches, intro content, and derived keys', () => {
        const outline = parseStudyNoteOutline([
            'Intro paragraph',
            '',
            '## Blessing',
            'Summary line for blessing.',
            '',
            '### Promise',
            'Promise body.',
            '',
            '## Warning',
            'Warning body.',
        ].join('\n'));

        expect(outline.hasOutline).toBe(true);
        expect(outline.introduction).toBe('Intro paragraph');
        expect(outline.totalBranches).toBe(3);
        expect(outline.branches).toHaveLength(2);
        expect(outline.branches[0].title).toBe('Blessing');
        expect(outline.branches[0].key).toBe('1');
        expect(outline.branches[0].body).toBe('Summary line for blessing.');
        expect(outline.branches[0].children[0].title).toBe('Promise');
        expect(outline.branches[0].children[0].key).toBe('1.1');
        expect(outline.branches[1].title).toBe('Warning');
        expect(outline.branches[1].key).toBe('2');
    });

    it('ignores headings inside fenced code blocks', () => {
        const outline = parseStudyNoteOutline([
            '## Root',
            '```md',
            '### Not a branch',
            '```',
            'After code block',
            '### Real child',
            'Child body',
        ].join('\n'));

        expect(outline.totalBranches).toBe(2);
        expect(outline.branches[0].title).toBe('Root');
        expect(outline.branches[0].body).toContain('### Not a branch');
        expect(outline.branches[0].children[0].title).toBe('Real child');
    });

    it('keeps heading-first parsing compatible with existing h1-authored notes', () => {
        const outline = parseStudyNoteOutline([
            '# Legacy root',
            'Legacy body',
            '## Child',
            'Child body',
        ].join('\n'));

        expect(outline.hasOutline).toBe(true);
        expect(outline.baseHeadingLevel).toBe(1);
        expect(outline.branches[0].title).toBe('Legacy root');
        expect(outline.branches[0].children[0].title).toBe('Child');
    });

    it('returns collapsible keys and filters invalid fold state', () => {
        const outline = parseStudyNoteOutline([
            '## Root',
            'Root body',
            '### Child',
            'Child body',
        ].join('\n'));

        expect(getCollapsibleStudyNoteBranchKeys(outline.branches)).toEqual(['1', '1.1']);
        expect(filterStudyNoteOutlineKeys(['1', '2', 'missing'], outline.branches)).toEqual(['1']);
    });
});
