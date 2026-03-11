import {
    filterStudyNoteOutlineKeys,
    getCollapsibleStudyNoteBranchKeys,
    parseStudyNoteOutline,
    remapStudyNoteOutlineKey,
    remapStudyNoteOutlineKeys,
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

    it('does not close a fenced block with a shorter marker sequence', () => {
        const outline = parseStudyNoteOutline([
            '## Root',
            '````md',
            '### Still code, not a branch',
            '```',
            '### Real child',
            'Child body',
            '````',
        ].join('\n'));

        expect(outline.totalBranches).toBe(1);
        expect(outline.branches[0].title).toBe('Root');
        expect(outline.branches[0].body).toContain('### Still code, not a branch');
        expect(outline.branches[0].body).toContain('### Real child');
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

    it('treats headings with up to three leading spaces as valid markdown headings', () => {
        const outline = parseStudyNoteOutline([
            '   ## Indented root',
            'Root body',
            '  ### Indented child',
            'Child body',
        ].join('\n'));

        expect(outline.totalBranches).toBe(2);
        expect(outline.branches[0].title).toBe('Indented root');
        expect(outline.branches[0].children[0].title).toBe('Indented child');
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

    it('captures subtree source ranges for later branch-level rewrites', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '### Child',
            'Child body',
            '',
            '## Next Root',
            'Next body',
        ].join('\n');
        const outline = parseStudyNoteOutline(markdown);
        const rootBranch = outline.branches[0];
        const childBranch = rootBranch.children[0];

        expect(rootBranch.sourceRange).toEqual({
            startOffset: 0,
            bodyStartOffset: '## Root\n'.length,
            bodyEndOffset: markdown.indexOf('### Child'),
            subtreeEndOffset: markdown.indexOf('## Next Root'),
        });
        expect(childBranch.sourceRange).toEqual({
            startOffset: markdown.indexOf('### Child'),
            bodyStartOffset: markdown.indexOf('### Child') + '### Child\n'.length,
            bodyEndOffset: markdown.indexOf('## Next Root'),
            subtreeEndOffset: markdown.indexOf('## Next Root'),
        });
    });

    it('remaps path-based keys by semantic branch match after reorder and insertion', () => {
        const previousOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
            '',
            '## Beta',
            'Beta body',
        ].join('\n'));
        const reorderedOutline = parseStudyNoteOutline([
            '## Beta',
            'Beta body',
            '',
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const insertedOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
            '',
            '## New branch',
            '',
            '## Beta',
            'Beta body',
        ].join('\n'));

        expect(remapStudyNoteOutlineKey('2', previousOutline.branches, reorderedOutline.branches)).toBe('1');
        expect(remapStudyNoteOutlineKey('2', previousOutline.branches, insertedOutline.branches)).toBe('3');
        expect(remapStudyNoteOutlineKeys(['1', '2'], previousOutline.branches, reorderedOutline.branches)).toEqual(['2', '1']);
    });
});
