import { render, screen } from '@testing-library/react';

import { RichMarkdownToolbar } from '../RichMarkdownToolbar';

const mockUseEditorState = jest.fn();

jest.mock('@tiptap/react', () => ({
    useEditorState: (options: unknown) => mockUseEditorState(options),
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

function createEditorDouble() {
    const run = jest.fn(() => true);
    const setHeading = jest.fn(() => ({ run }));
    const setParagraph = jest.fn(() => ({ run }));
    const focus = jest.fn(() => ({
        setHeading,
        setParagraph,
        toggleBold: () => ({ run }),
        toggleItalic: () => ({ run }),
        toggleStrike: () => ({ run }),
        toggleBulletList: () => ({ run }),
        toggleOrderedList: () => ({ run }),
        toggleBlockquote: () => ({ run }),
        toggleHeading: () => ({ run }),
    }));
    const chain = jest.fn(() => ({ focus }));

    return {
        editor: {
            chain,
        },
        spies: {
            setHeading,
            setParagraph,
        },
    };
}

describe('RichMarkdownToolbar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reacts to the current selection state', () => {
        const editorDouble = createEditorDouble();

        mockUseEditorState.mockReturnValueOnce({
            isBold: true,
            isItalic: false,
            isStrike: false,
            isBulletList: false,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: false,
            isHeading2: true,
            isHeading3: false,
            currentHeadingLevel: 2,
            previousHeadingLevel: 2,
        });

        const { rerender } = render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        expect(screen.getByRole('combobox')).toHaveValue('heading-2');
        expect(screen.getByRole('button', { name: 'Bold' })).toHaveClass('bg-indigo-100');

        mockUseEditorState.mockReturnValueOnce({
            isBold: false,
            isItalic: false,
            isStrike: false,
            isBulletList: false,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: false,
            isHeading2: false,
            isHeading3: false,
            currentHeadingLevel: null,
            previousHeadingLevel: 2,
        });

        rerender(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        expect(screen.getByRole('combobox')).toHaveValue('paragraph');
        expect(screen.getByRole('button', { name: 'Bold' })).not.toHaveClass('bg-indigo-100');
    });

    it('uses local heading context for relative branch actions', () => {
        const editorDouble = createEditorDouble();

        mockUseEditorState.mockReturnValue({
            isBold: false,
            isItalic: false,
            isStrike: false,
            isBulletList: false,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: false,
            isHeading2: false,
            isHeading3: false,
            currentHeadingLevel: null,
            previousHeadingLevel: 2,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        screen.getByRole('button', { name: 'common.childBranchAtLevel' });
        screen.getByRole('button', { name: 'common.branchAtCurrentLevel' });

        screen.getByRole('button', { name: 'common.childBranchAtLevel' }).click();
        expect(editorDouble.spies.setHeading).toHaveBeenCalledWith({ level: 3 });
    });

    it('promotes H1 back to body text through the Up action', () => {
        const editorDouble = createEditorDouble();

        mockUseEditorState.mockReturnValue({
            isBold: false,
            isItalic: false,
            isStrike: false,
            isBulletList: false,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: true,
            isHeading2: false,
            isHeading3: false,
            currentHeadingLevel: 1,
            previousHeadingLevel: 1,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        screen.getByRole('button', { name: 'common.promoteBranch' }).click();

        expect(editorDouble.spies.setParagraph).toHaveBeenCalledTimes(1);
        expect(editorDouble.spies.setHeading).not.toHaveBeenCalled();
    });
});
