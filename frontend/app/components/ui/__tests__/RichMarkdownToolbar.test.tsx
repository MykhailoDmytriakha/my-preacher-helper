import { fireEvent, render, screen } from '@testing-library/react';

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
    const toggleBulletList = jest.fn(() => ({ run }));
    const toggleOrderedList = jest.fn(() => ({ run }));
    const sinkListItem = jest.fn(() => ({ run }));
    const liftListItem = jest.fn(() => ({ run }));
    const focus = jest.fn(() => ({
        setHeading,
        setParagraph,
        toggleBold: () => ({ run }),
        toggleItalic: () => ({ run }),
        toggleStrike: () => ({ run }),
        toggleBulletList,
        toggleOrderedList,
        toggleBlockquote: () => ({ run }),
        toggleHeading: () => ({ run }),
        sinkListItem,
        liftListItem,
    }));
    const chain = jest.fn(() => ({ focus }));

    return {
        editor: {
            chain,
        },
        spies: {
            setHeading,
            setParagraph,
            toggleBulletList,
            toggleOrderedList,
            sinkListItem,
            liftListItem,
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
            currentNodeType: 'heading',
            activeListType: null,
            isInsideListItem: false,
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
            currentNodeType: 'paragraph',
            activeListType: null,
            isInsideListItem: false,
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
            currentNodeType: 'paragraph',
            activeListType: null,
            isInsideListItem: false,
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

    it('moves H1 back to body text through the outdent action', () => {
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
            currentNodeType: 'heading',
            activeListType: null,
            isInsideListItem: false,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        screen.getByRole('button', { name: 'common.outdentBranch' }).click();

        expect(editorDouble.spies.setParagraph).toHaveBeenCalledTimes(1);
        expect(editorDouble.spies.setHeading).not.toHaveBeenCalled();
    });

    it('renders editor-native branch creation controls and respects their enabled state', () => {
        const editorDouble = createEditorDouble();
        const handleCreateSiblingBranch = jest.fn();
        const handleCreateChildBranch = jest.fn();

        mockUseEditorState.mockReturnValue({
            isBold: false,
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
            currentNodeType: 'heading',
            activeListType: null,
            isInsideListItem: false,
        });

        const { rerender } = render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
                outlineBranchSelection={{
                    headingText: 'Main Branch',
                    headingLevel: 2,
                    occurrenceIndex: 0,
                }}
                onCreateSiblingBranch={handleCreateSiblingBranch}
                onCreateChildBranch={handleCreateChildBranch}
                canCreateSiblingBranch
                canCreateChildBranch
            />
        );

        screen.getByRole('button', { name: 'common.addBranchAfterCurrent' }).click();
        screen.getByRole('button', { name: 'common.addChildUnderCurrent' }).click();

        expect(handleCreateSiblingBranch).toHaveBeenCalledTimes(1);
        expect(handleCreateChildBranch).toHaveBeenCalledTimes(1);

        rerender(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
                onCreateSiblingBranch={handleCreateSiblingBranch}
                onCreateChildBranch={handleCreateChildBranch}
                canCreateSiblingBranch={false}
                canCreateChildBranch={false}
            />
        );

        expect(screen.getByRole('button', { name: 'common.addBranch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'common.addChildBranch' })).toBeDisabled();
    });

    it('renders discoverable indent and outdent controls that mirror outline depth changes', () => {
        const editorDouble = createEditorDouble();

        mockUseEditorState.mockReturnValue({
            isBold: false,
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
            currentNodeType: 'heading',
            activeListType: null,
            isInsideListItem: false,
        });

        const { rerender } = render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        screen.getByRole('button', { name: 'common.indentBranch' }).click();
        expect(editorDouble.spies.setHeading).toHaveBeenCalledWith({ level: 3 });

        editorDouble.spies.setHeading.mockClear();

        screen.getByRole('button', { name: 'common.outdentBranch' }).click();
        expect(editorDouble.spies.setHeading).toHaveBeenCalledWith({ level: 1 });

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
            currentNodeType: 'paragraph',
            activeListType: null,
            isInsideListItem: false,
        });

        rerender(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        expect(screen.getByRole('button', { name: 'common.outdentBranch' })).toBeDisabled();
    });

    it('treats bullet lists as untitled note blocks in outline mode', () => {
        const editorDouble = createEditorDouble();

        mockUseEditorState.mockReturnValue({
            isBold: false,
            isItalic: false,
            isStrike: false,
            isBulletList: true,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: false,
            isHeading2: false,
            isHeading3: false,
            currentHeadingLevel: null,
            previousHeadingLevel: 2,
            currentNodeType: 'paragraph',
            activeListType: 'bulletList',
            isInsideListItem: true,
            selectedNodeblockPath: [0, 0],
            selectedTopLevelNodeblockIndex: 0,
            selectedTopLevelBranchBlockIndex: 0,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
            />
        );

        expect(screen.getByRole('combobox')).toHaveValue('note-block');

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'paragraph' } });
        expect(editorDouble.spies.toggleBulletList).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'common.indentBranch' }));
        expect(editorDouble.spies.sinkListItem).toHaveBeenCalledWith('listItem');

        fireEvent.click(screen.getByRole('button', { name: 'common.outdentBranch' }));
        expect(editorDouble.spies.liftListItem).toHaveBeenCalledWith('listItem');
    });

    it('uses outdent to lift a top-level note block to the parent branch scope when available', () => {
        const editorDouble = createEditorDouble();
        const handleLiftNodeblockToParentBranch = jest.fn();

        mockUseEditorState.mockReturnValue({
            isBold: false,
            isItalic: false,
            isStrike: false,
            isBulletList: true,
            isOrderedList: false,
            isBlockquote: false,
            isHeading1: false,
            isHeading2: false,
            isHeading3: false,
            currentHeadingLevel: null,
            previousHeadingLevel: 3,
            currentNodeType: 'paragraph',
            activeListType: 'bulletList',
            isInsideListItem: true,
            selectedNodeblockPath: [1],
            selectedTopLevelNodeblockIndex: 1,
            selectedTopLevelBranchBlockIndex: 0,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
                onLiftNodeblockToParentBranch={handleLiftNodeblockToParentBranch}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'common.outdentBranch' }));

        expect(handleLiftNodeblockToParentBranch).toHaveBeenCalledWith(1);
        expect(editorDouble.spies.liftListItem).not.toHaveBeenCalled();
    });

    it('enables outdent for a plain paragraph block when it can be lifted to the parent branch scope', () => {
        const editorDouble = createEditorDouble();
        const handleLiftBranchBlockToParentBranch = jest.fn();

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
            previousHeadingLevel: 3,
            currentNodeType: 'paragraph',
            activeListType: null,
            isInsideListItem: false,
            selectedNodeblockPath: null,
            selectedTopLevelNodeblockIndex: null,
            selectedTopLevelBranchBlockIndex: 2,
        });

        render(
            <RichMarkdownToolbar
                editor={editorDouble.editor as never}
                showOutlineStructureControls
                onLiftBranchBlockToParentBranch={handleLiftBranchBlockToParentBranch}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'common.outdentBranch' }));

        expect(handleLiftBranchBlockToParentBranch).toHaveBeenCalledWith(2);
        expect(editorDouble.spies.setParagraph).not.toHaveBeenCalled();
        expect(editorDouble.spies.liftListItem).not.toHaveBeenCalled();
    });
});
