import React from 'react';
import { render, screen } from '@testing-library/react';

// CRITICAL: All jest.mock calls must come before imports.
// Mock TipTap and extension modules to prevent JSDOM crashes.
jest.mock('@tiptap/react', () => {
    const mockEditor = {
        chain: jest.fn().mockReturnThis(),
        focus: jest.fn().mockReturnThis(),
        run: jest.fn().mockReturnValue(true),
        isActive: jest.fn().mockReturnValue(false),
        commands: { setContent: jest.fn() },
        storage: { markdown: { getMarkdown: jest.fn().mockReturnValue('') } },
    };
    return {
        useEditor: jest.fn(() => mockEditor),
        EditorContent: ({ editor }: any) =>
            editor ? <div data-testid="editor-content" /> : null,
        __mockEditor: mockEditor,
    };
});

jest.mock('@tiptap/starter-kit', () => ({ __esModule: true, default: {} }));
jest.mock('tiptap-markdown', () => ({ Markdown: {} }));
jest.mock('@tiptap/extension-placeholder', () => ({
    __esModule: true,
    default: { configure: jest.fn(() => ({ name: 'placeholder' })) },
}));

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({
    RichMarkdownToolbar: () => <div data-testid="toolbar" />,
}));

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import * as TiptapReact from '@tiptap/react';

const getMockEditor = () => (TiptapReact as any).__mockEditor;

describe('RichMarkdownEditor', () => {
    beforeEach(() => {
        // Reset mock call counts but keep their implementations
        jest.clearAllMocks();
        // Restore the default return value after clearAllMocks
        const mockEditor = getMockEditor();
        mockEditor.storage.markdown.getMarkdown.mockReturnValue('');
        (TiptapReact.useEditor as jest.Mock).mockReturnValue(mockEditor);
    });

    it('renders the toolbar and editor content when editor is ready', () => {
        render(<RichMarkdownEditor value="" onChange={jest.fn()} />);
        expect(screen.getByTestId('toolbar')).toBeInTheDocument();
        expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    });

    it('returns null when useEditor returns null (initial load)', () => {
        (TiptapReact.useEditor as jest.Mock).mockReturnValueOnce(null);
        const { container } = render(<RichMarkdownEditor value="" onChange={jest.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders with a custom minHeight style', () => {
        const { container } = render(
            <RichMarkdownEditor value="" onChange={jest.fn()} minHeight="250px" />
        );
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.style.minHeight).toBe('250px');
    });

    it('passes autofocus=end to useEditor when autoFocus is true', () => {
        render(<RichMarkdownEditor value="" onChange={jest.fn()} autoFocus />);
        expect(TiptapReact.useEditor).toHaveBeenCalledWith(
            expect.objectContaining({ autofocus: 'end' })
        );
    });

    it('passes autofocus=false to useEditor when autoFocus is false', () => {
        render(<RichMarkdownEditor value="" onChange={jest.fn()} autoFocus={false} />);
        expect(TiptapReact.useEditor).toHaveBeenCalledWith(
            expect.objectContaining({ autofocus: false })
        );
    });

    it('passes the initial content value to useEditor', () => {
        render(<RichMarkdownEditor value="initial text" onChange={jest.fn()} />);
        expect(TiptapReact.useEditor).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'initial text' })
        );
    });
});
