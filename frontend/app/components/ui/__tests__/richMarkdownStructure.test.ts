import {
    clampHeadingLevel,
    clampOutlinePreviewWidth,
    getDemotedHeadingLevel,
    getChildBranchLevel,
    getContextBranchLevel,
    getPromotedHeadingLevel,
} from '../richMarkdownStructure';

describe('richMarkdownStructure', () => {
    it('derives branch levels from current or previous heading context', () => {
        expect(getContextBranchLevel({ currentHeadingLevel: 4, previousHeadingLevel: 2 })).toBe(4);
        expect(getContextBranchLevel({ currentHeadingLevel: null, previousHeadingLevel: 3 })).toBe(3);
        expect(getContextBranchLevel({ currentHeadingLevel: null, previousHeadingLevel: null })).toBe(2);
    });

    it('derives child branch levels relative to local context', () => {
        expect(getChildBranchLevel({ currentHeadingLevel: 3, previousHeadingLevel: 2 })).toBe(4);
        expect(getChildBranchLevel({ currentHeadingLevel: null, previousHeadingLevel: 5 })).toBe(6);
        expect(getChildBranchLevel({ currentHeadingLevel: null, previousHeadingLevel: 6 })).toBe(6);
    });

    it('promotes headings without dropping below markdown minimum', () => {
        expect(getPromotedHeadingLevel(4)).toBe(3);
        expect(getPromotedHeadingLevel(1)).toBe(1);
        expect(getPromotedHeadingLevel(null)).toBeNull();
        expect(getDemotedHeadingLevel(4)).toBe(5);
        expect(getDemotedHeadingLevel(6)).toBe(6);
        expect(getDemotedHeadingLevel(null)).toBeNull();
    });

    it('clamps heading and preview widths into safe ranges', () => {
        expect(clampHeadingLevel(0)).toBe(1);
        expect(clampHeadingLevel(7)).toBe(6);
        expect(clampHeadingLevel(3)).toBe(3);

        expect(clampOutlinePreviewWidth(200, 2200)).toBe(280);
        expect(clampOutlinePreviewWidth(800, 1200)).toBe(576);
        expect(clampOutlinePreviewWidth(420, 2200)).toBe(420);
    });
});
