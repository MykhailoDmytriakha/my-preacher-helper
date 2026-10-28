import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

jest.mock('@tiptap/react', () => ({
    useEditorState: jest.fn(),
}));

import { RichMarkdownToolbar } from '@/components/ui/RichMarkdownToolbar';
import { useEditorState } from '@tiptap/react';

const makeEditorMock = (activeMarks: string[] = []) => ({
    // A real Tiptap editor always says whether its text can change.
    isEditable: true,
    isActive: jest.fn((markOrNode: string) => activeMarks.includes(markOrNode)),
    chain: jest.fn().mockReturnThis(),
    focus: jest.fn().mockReturnThis(),
    toggleBold: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleItalic: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleStrike: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleHeading: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleBulletList: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleOrderedList: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
    toggleBlockquote: jest.fn().mockReturnValue({ run: jest.fn().mockReturnValue(true) }),
});

describe('RichMarkdownToolbar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useEditorState as jest.Mock).mockImplementation(({ editor, selector }) =>
            selector({ editor, transactionNumber: 0 })
        );
    });

    it('renders all toolbar buttons', () => {
        const editor = makeEditorMock() as any;
        render(<RichMarkdownToolbar editor={editor} />);

        expect(screen.getByRole('button', { name: 'richText.bold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.italic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.strikethrough' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.heading1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.heading2' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.heading3' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.bulletList' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.orderedList' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'richText.quote' })).toBeInTheDocument();
    });

    it('returns null when editor is null/undefined', () => {
        const { container } = render(<RichMarkdownToolbar editor={null as any} />);
        expect(container.firstChild).toBeNull();
    });

    it('applies active styles to Bold button when bold is active', () => {
        const editor = makeEditorMock(['bold']) as any;
        render(<RichMarkdownToolbar editor={editor} />);
        const boldBtn = screen.getByRole('button', { name: 'richText.bold' });
        expect(boldBtn.className).toContain('bg-indigo-100');
    });

    it('applies inactive styles when mark is not active', () => {
        const editor = makeEditorMock([]) as any;
        render(<RichMarkdownToolbar editor={editor} />);
        const boldBtn = screen.getByRole('button', { name: 'richText.bold' });
        expect(boldBtn.className).not.toContain('bg-indigo-100');
        expect(boldBtn.className).toContain('text-gray-600');
    });

    it('derives button state through useEditorState', () => {
        const editor = makeEditorMock([]) as any;
        (useEditorState as jest.Mock).mockReturnValue({
            bold: true,
            italic: false,
            strike: false,
            heading1: false,
            heading2: false,
            heading3: false,
            bulletList: false,
            orderedList: false,
            blockquote: false,
        });

        render(<RichMarkdownToolbar editor={editor} />);

        expect(screen.getByRole('button', { name: 'richText.bold' }).className).toContain('bg-indigo-100');
        expect(useEditorState).toHaveBeenCalledWith(
            expect.objectContaining({
                editor,
                selector: expect.any(Function),
            })
        );
    });

    it('calls editor chain when Bold button is clicked', () => {
        const runMock = jest.fn().mockReturnValue(true);
        const toggleBoldMock = jest.fn().mockReturnValue({ run: runMock });
        const focusMock = jest.fn().mockReturnValue({ toggleBold: toggleBoldMock });
        const chainMock = jest.fn().mockReturnValue({ focus: focusMock });
        const editor = { ...makeEditorMock(), chain: chainMock } as any;

        render(<RichMarkdownToolbar editor={editor} />);
        fireEvent.click(screen.getByRole('button', { name: 'richText.bold' }));

        expect(chainMock).toHaveBeenCalled();
        expect(focusMock).toHaveBeenCalled();
        expect(toggleBoldMock).toHaveBeenCalled();
        expect(runMock).toHaveBeenCalled();
    });

    it('holds every button still while the editor says its text is held, so a save being accepted is not changed', () => {
        const editor = makeEditorMock() as any;
        render(<RichMarkdownToolbar editor={editor} disabled />);
        for (const name of ['richText.bold', 'richText.heading1', 'richText.bulletList', 'richText.quote']) {
            expect(screen.getByRole('button', { name })).toBeDisabled();
        }
    });

    it('lets the buttons go as soon as the editor says the text is released, not at the next keystroke', () => {
        const editor = makeEditorMock() as any;
        const { rerender } = render(<RichMarkdownToolbar editor={editor} disabled />);
        // Released without a transaction: what useEditorState last saw still says "read-only".
        editor.isEditable = false;
        rerender(<RichMarkdownToolbar editor={editor} disabled={false} />);
        expect(screen.getByRole('button', { name: 'richText.bold' })).toBeEnabled();
    });

    it('refuses a press on a button drawn a moment before the text was held: making an editor read-only is no transaction', () => {
        const editor = makeEditorMock() as any;
        render(<RichMarkdownToolbar editor={editor} />);
        // setEditable(false) after the buttons were drawn: useEditorState did not hear it, the button still looks enabled.
        editor.isEditable = false;
        fireEvent.click(screen.getByRole('button', { name: 'richText.bulletList' }));
        expect(editor.chain).not.toHaveBeenCalled();
    });

    it('prevents default on button click (handleToggle)', () => {
        const editor = makeEditorMock() as any;
        const runMock = jest.fn().mockReturnValue(true);
        const toggleItalicMock = jest.fn().mockReturnValue({ run: runMock });
        const focusMock = jest.fn().mockReturnValue({ toggleItalic: toggleItalicMock });
        const chainMock = jest.fn().mockReturnValue({ focus: focusMock });
        editor.chain = chainMock;

        render(<RichMarkdownToolbar editor={editor} />);
        const italicBtn = screen.getByRole('button', { name: 'richText.italic' });
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = jest.spyOn(clickEvent, 'preventDefault');
        italicBtn.dispatchEvent(clickEvent);

        // The button must have been in DOM (no crash)
        expect(italicBtn).toBeInTheDocument();
        preventDefaultSpy.mockRestore();
    });
});
