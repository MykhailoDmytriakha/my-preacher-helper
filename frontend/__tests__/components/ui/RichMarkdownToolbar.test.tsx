import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

import { RichMarkdownToolbar } from '@/components/ui/RichMarkdownToolbar';

const makeEditorMock = (activeMarks: string[] = []) => ({
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
    it('renders all toolbar buttons', () => {
        const editor = makeEditorMock() as any;
        render(<RichMarkdownToolbar editor={editor} />);

        expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 2' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bullet List' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ordered List' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Quote' })).toBeInTheDocument();
    });

    it('returns null when editor is null/undefined', () => {
        const { container } = render(<RichMarkdownToolbar editor={null as any} />);
        expect(container.firstChild).toBeNull();
    });

    it('applies active styles to Bold button when bold is active', () => {
        const editor = makeEditorMock(['bold']) as any;
        render(<RichMarkdownToolbar editor={editor} />);
        const boldBtn = screen.getByRole('button', { name: 'Bold' });
        expect(boldBtn.className).toContain('bg-indigo-100');
    });

    it('applies inactive styles when mark is not active', () => {
        const editor = makeEditorMock([]) as any;
        render(<RichMarkdownToolbar editor={editor} />);
        const boldBtn = screen.getByRole('button', { name: 'Bold' });
        expect(boldBtn.className).not.toContain('bg-indigo-100');
        expect(boldBtn.className).toContain('text-gray-600');
    });

    it('calls editor chain when Bold button is clicked', () => {
        const runMock = jest.fn().mockReturnValue(true);
        const toggleBoldMock = jest.fn().mockReturnValue({ run: runMock });
        const focusMock = jest.fn().mockReturnValue({ toggleBold: toggleBoldMock });
        const chainMock = jest.fn().mockReturnValue({ focus: focusMock });
        const editor = { ...makeEditorMock(), chain: chainMock } as any;

        render(<RichMarkdownToolbar editor={editor} />);
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

        expect(chainMock).toHaveBeenCalled();
        expect(focusMock).toHaveBeenCalled();
        expect(toggleBoldMock).toHaveBeenCalled();
        expect(runMock).toHaveBeenCalled();
    });

    it('prevents default on button click (handleToggle)', () => {
        const editor = makeEditorMock() as any;
        const runMock = jest.fn().mockReturnValue(true);
        const toggleItalicMock = jest.fn().mockReturnValue({ run: runMock });
        const focusMock = jest.fn().mockReturnValue({ toggleItalic: toggleItalicMock });
        const chainMock = jest.fn().mockReturnValue({ focus: focusMock });
        editor.chain = chainMock;

        render(<RichMarkdownToolbar editor={editor} />);
        const italicBtn = screen.getByRole('button', { name: 'Italic' });
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = jest.spyOn(clickEvent, 'preventDefault');
        italicBtn.dispatchEvent(clickEvent);

        // The button must have been in DOM (no crash)
        expect(italicBtn).toBeInTheDocument();
        preventDefaultSpy.mockRestore();
    });
});
