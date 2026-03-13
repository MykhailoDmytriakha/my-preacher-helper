import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import {
    applyPendingMarkdownInsertion,
    findCurrentOutlineBranchSelection,
    findHeadingSelectionRange,
    getOutlineBaseHeadingLevel,
    getOutlineDepthDecorationsForBlocks,
    getOutlineNodeDecorationRange,
    getRichMarkdownEditorClassName,
    handleOutlineTabShortcut,
    RichMarkdownEditor,
    shiftHeadingDepth,
} from '../RichMarkdownEditor';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' },
    }),
}));

function createHeadingShortcutEditor(nodeType: 'heading' | 'paragraph', level: number | null = null) {
    const run = jest.fn(() => true);
    const insertContent = jest.fn(() => ({ run }));
    const setHeading = jest.fn(() => ({ run }));
    const setParagraph = jest.fn(() => ({ run }));
    const chain = jest.fn(() => ({
        focus: jest.fn(() => ({
            insertContent,
            setHeading,
            setParagraph,
        })),
    }));

    return {
        editor: {
            state: {
                selection: {
                    $from: {
                        parent: nodeType === 'paragraph'
                            ? { type: { name: 'paragraph' }, attrs: {} }
                            : { type: { name: 'heading' }, attrs: { level } },
                    },
                },
            },
            chain,
        },
        spies: {
            chain,
            insertContent,
            setHeading,
            setParagraph,
            run,
        },
    };
}

describe('shiftHeadingDepth', () => {
    it('demotes and promotes heading levels for Tab shortcuts', () => {
        const { editor, spies } = createHeadingShortcutEditor('heading', 2);

        expect(shiftHeadingDepth(editor as never, 'deeper')).toBe(true);
        expect(spies.setHeading).toHaveBeenCalledWith({ level: 3 });

        spies.setHeading.mockClear();

        expect(shiftHeadingDepth(editor as never, 'shallower')).toBe(true);
        expect(spies.setHeading).toHaveBeenCalledWith({ level: 1 });
    });

    it('does not try to shift non-heading blocks', () => {
        const { editor, spies } = createHeadingShortcutEditor('paragraph');

        expect(shiftHeadingDepth(editor as never, 'deeper')).toBe(false);
        expect(spies.setHeading).not.toHaveBeenCalled();
    });

    it('turns H1 back into body text on Shift-Tab and keeps H6 stable on Tab', () => {
        const shallowerBoundary = createHeadingShortcutEditor('heading', 1);
        const deeperBoundary = createHeadingShortcutEditor('heading', 6);

        expect(shiftHeadingDepth(shallowerBoundary.editor as never, 'shallower')).toBe(true);
        expect(shallowerBoundary.spies.setParagraph).toHaveBeenCalledTimes(1);
        expect(shallowerBoundary.spies.setHeading).not.toHaveBeenCalled();

        expect(shiftHeadingDepth(deeperBoundary.editor as never, 'deeper')).toBe(true);
        expect(deeperBoundary.spies.setHeading).not.toHaveBeenCalled();
    });
});

describe('handleOutlineTabShortcut', () => {
    it('turns body text into H1 on Tab and keeps Shift-Tab inside the editor', () => {
        const bodyEditor = createHeadingShortcutEditor('paragraph');

        expect(handleOutlineTabShortcut(bodyEditor.editor as never, 'deeper')).toBe(true);
        expect(bodyEditor.spies.setHeading).toHaveBeenCalledWith({ level: 1 });

        bodyEditor.spies.setHeading.mockClear();

        expect(handleOutlineTabShortcut(bodyEditor.editor as never, 'shallower')).toBe(true);
        expect(bodyEditor.spies.setHeading).not.toHaveBeenCalled();
    });
});

describe('getRichMarkdownEditorClassName', () => {
    it('adds outline heading indentation classes only in outline mode', () => {
        const plainClassName = getRichMarkdownEditorClassName(false);
        const outlineClassName = getRichMarkdownEditorClassName(true);

        expect(plainClassName).not.toContain('[&_.outline-depth-2]:ml-3');
        expect(outlineClassName).toContain('[&_.outline-depth-2]:ml-3');
        expect(outlineClassName).toContain('[&_.outline-depth-6]:ml-15');
        expect(outlineClassName).toContain('desktop:[&_.outline-depth-4]:ml-12');
    });
});

describe('getOutlineDepthDecorationsForBlocks', () => {
    it('normalizes branch depth to the base heading level and applies it to the whole branch body', () => {
        expect(getOutlineDepthDecorationsForBlocks([
            { type: 'paragraph', from: 1, to: 5 },
            { type: 'heading', level: 2, from: 6, to: 12 },
            { type: 'paragraph', from: 13, to: 18 },
            { type: 'blockquote', from: 19, to: 26 },
            { type: 'heading', level: 3, from: 27, to: 34 },
            { type: 'paragraph', from: 35, to: 42 },
        ])).toEqual([
            { from: 6, to: 12, depth: 1 },
            { from: 13, to: 18, depth: 1 },
            { from: 19, to: 26, depth: 1 },
            { from: 27, to: 34, depth: 2 },
            { from: 35, to: 42, depth: 2 },
        ]);
    });
});

describe('getOutlineBaseHeadingLevel', () => {
    it('uses the lowest heading level in the note as the visual root depth', () => {
        expect(getOutlineBaseHeadingLevel([
            { type: 'paragraph', from: 1, to: 5 },
            { type: 'heading', level: 4, from: 6, to: 12 },
            { type: 'heading', level: 2, from: 13, to: 18 },
            { type: 'heading', level: 3, from: 19, to: 24 },
        ])).toBe(2);
    });
});

describe('getOutlineNodeDecorationRange', () => {
    it('uses outer ProseMirror node boundaries for node decorations', () => {
        expect(getOutlineNodeDecorationRange(0, 9)).toEqual({ from: 0, to: 9 });
        expect(getOutlineNodeDecorationRange(14, 7)).toEqual({ from: 14, to: 21 });
    });
});

describe('findHeadingSelectionRange', () => {
    it('selects the requested heading occurrence by level and raw text', () => {
        expect(findHeadingSelectionRange([
            { level: 2, text: 'New branch', from: 4, to: 14, nodeFrom: 2, nodeTo: 16 },
            { level: 2, text: 'Existing', from: 18, to: 26, nodeFrom: 16, nodeTo: 28 },
            { level: 2, text: 'New branch', from: 30, to: 40, nodeFrom: 28, nodeTo: 42 },
        ], {
            token: 'selection-1',
            headingText: 'New branch',
            headingLevel: 2,
            occurrenceIndex: 1,
        })).toEqual({
            from: 30,
            to: 40,
        });
    });
});

describe('findCurrentOutlineBranchSelection', () => {
    it('uses the current heading when the cursor is inside it, including the first text position, and falls back to the previous heading for branch body text', () => {
        const headings = [
            {
                level: 2,
                text: 'Main Branch',
                from: 4,
                to: 15,
                nodeFrom: 2,
                nodeTo: 18,
            },
            {
                level: 3,
                text: 'Child Branch',
                from: 28,
                to: 40,
                nodeFrom: 26,
                nodeTo: 43,
            },
            {
                level: 2,
                text: 'Main Branch',
                from: 52,
                to: 63,
                nodeFrom: 50,
                nodeTo: 66,
            },
        ];

        expect(findCurrentOutlineBranchSelection(headings, 4)).toEqual({
            headingText: 'Main Branch',
            headingLevel: 2,
            occurrenceIndex: 0,
        });

        expect(findCurrentOutlineBranchSelection(headings, 30)).toEqual({
            headingText: 'Child Branch',
            headingLevel: 3,
            occurrenceIndex: 0,
        });

        expect(findCurrentOutlineBranchSelection(headings, 45)).toEqual({
            headingText: 'Child Branch',
            headingLevel: 3,
            occurrenceIndex: 0,
        });

        expect(findCurrentOutlineBranchSelection(headings, 60)).toEqual({
            headingText: 'Main Branch',
            headingLevel: 2,
            occurrenceIndex: 1,
        });
    });
});

describe('applyPendingMarkdownInsertion', () => {
    it('inserts pending markdown at the current editor selection and consumes the token', () => {
        const { editor, spies } = createHeadingShortcutEditor('paragraph');
        const handlePendingMarkdownInsertionConsumed = jest.fn();

        expect(applyPendingMarkdownInsertion(
            editor as never,
            {
                token: 'insert-1',
                text: '[Child Branch](#branch=branch-child)',
            },
            handlePendingMarkdownInsertionConsumed
        )).toBe(true);

        expect(spies.insertContent).toHaveBeenCalledWith('[Child Branch](#branch=branch-child)');
        expect(handlePendingMarkdownInsertionConsumed).toHaveBeenCalledWith('insert-1');
    });

    it('preserves branch-link markdown through the live TipTap markdown round-trip', async () => {
        jest.useFakeTimers();

        const handleChange = jest.fn();
        const handlePendingMarkdownInsertionConsumed = jest.fn();
        const elementPrototype = Element.prototype as Element & {
            getClientRects?: () => DOMRectList;
            getBoundingClientRect?: () => DOMRect;
        };
        const rangePrototype = Range.prototype as Range & {
            getClientRects?: () => DOMRectList;
            getBoundingClientRect?: () => DOMRect;
        };
        const originalGetClientRects = elementPrototype.getClientRects;
        const originalGetBoundingClientRect = elementPrototype.getBoundingClientRect;
        const originalRangeGetClientRects = rangePrototype.getClientRects;
        const originalRangeGetBoundingClientRect = rangePrototype.getBoundingClientRect;
        const createRect = () => ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => '',
        });

        elementPrototype.getClientRects = () => ({
            length: 1,
            item: () => null,
            [Symbol.iterator]: function* iterator() {
                yield createRect();
            },
            0: createRect(),
        } as unknown as DOMRectList);
        elementPrototype.getBoundingClientRect = () => createRect() as DOMRect;
        rangePrototype.getClientRects = elementPrototype.getClientRects;
        rangePrototype.getBoundingClientRect = elementPrototype.getBoundingClientRect;

        render(React.createElement(RichMarkdownEditor, {
            value: '## Root',
            onChange: handleChange,
            pendingMarkdownInsertion: {
                token: 'insert-1',
                text: '[Child Branch](#branch=branch-child)',
            },
            onPendingMarkdownInsertionConsumed: handlePendingMarkdownInsertionConsumed,
        }));

        await act(async () => {
            jest.runOnlyPendingTimers();
            await Promise.resolve();
        });

        await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(expect.stringContaining('[Child Branch](#branch=branch-child)'));
        });

        expect(handlePendingMarkdownInsertionConsumed).toHaveBeenCalledWith('insert-1');
        elementPrototype.getClientRects = originalGetClientRects;
        elementPrototype.getBoundingClientRect = originalGetBoundingClientRect;
        rangePrototype.getClientRects = originalRangeGetClientRects;
        rangePrototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
        jest.useRealTimers();
    });
});
