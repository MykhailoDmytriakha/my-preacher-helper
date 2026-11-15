import React from 'react';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

// CRITICAL: All jest.mock calls must come before imports.
// Mock TipTap and extension modules to prevent JSDOM crashes.
jest.mock('@tiptap/react', () => {
    const { Schema } = jest.requireActual('@tiptap/pm/model');
    const { EditorState } = jest.requireActual('@tiptap/pm/state');
    const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] }, text: {} } });
    const mockEditor = {
        schema,
        options: {},
        state: EditorState.create({ schema }),
        view: { dispatch: jest.fn(), composing: false, hasFocus: jest.fn().mockReturnValue(false) },
        on: jest.fn(),
        off: jest.fn(),
        chain: jest.fn().mockReturnThis(),
        focus: jest.fn().mockReturnThis(),
        command: jest.fn().mockReturnThis(),
        setContent: jest.fn().mockReturnThis(),
        run: jest.fn().mockReturnValue(true),
        isActive: jest.fn().mockReturnValue(false),
        commands: { setContent: jest.fn() },
        storage: { markdown: { getMarkdown: jest.fn().mockReturnValue(''), parser: { parse: (value: string) => `<p>${value}</p>` } } },
        isEditable: true,
        setEditable: jest.fn(),
    };
    return {
        useEditor: jest.fn(() => mockEditor),
        EditorContent: ({ editor, onCompositionEnd }: {
            editor: unknown;
        } & Pick<React.ComponentProps<'div'>, 'onCompositionEnd'>) =>
            editor ? <div data-testid="editor-content" onCompositionEnd={onCompositionEnd} /> : null,
        __mockEditor: mockEditor,
    };
});

jest.mock('@tiptap/starter-kit', () => ({ __esModule: true, default: { configure: jest.fn(() => ({ name: 'starterKit' })) } }));
jest.mock('tiptap-markdown', () => ({ Markdown: { configure: jest.fn(() => ({ name: 'markdown' })) } }));
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
        mockEditor.view.composing = false;
        (TiptapReact.useEditor as jest.Mock).mockReturnValue(mockEditor);
    });

    it('holds the text still when not editable, and lets it go again — announcing no edit either way', () => {
        const mockEditor = getMockEditor();
        const { rerender } = render(<RichMarkdownEditor value="" onChange={jest.fn()} editable={false} />);
        expect(TiptapReact.useEditor).toHaveBeenCalledWith(expect.objectContaining({ editable: false }));
        // Tiptap's setEditable emits "update" unless told not to; onUpdate would then send the old words back as typed.
        expect(mockEditor.setEditable).toHaveBeenCalledWith(false, false);
        mockEditor.isEditable = false;
        rerender(<RichMarkdownEditor value="" onChange={jest.fn()} editable />);
        expect(mockEditor.setEditable).toHaveBeenLastCalledWith(true, false);
        mockEditor.isEditable = true;
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

    it('calls onChange when the editor is updated', () => {
        const onChange = jest.fn();
        const mockEditor = getMockEditor();
        mockEditor.storage.markdown.getMarkdown.mockReturnValue('updated markdown');

        render(<RichMarkdownEditor value="" onChange={onChange} />);

        // Get the onUpdate callback from useEditor calls
        const { onUpdate } = (TiptapReact.useEditor as jest.Mock).mock.calls[0][0];

        // Simulate the update
        onUpdate({ editor: mockEditor });

        expect(onChange).toHaveBeenCalledWith('updated markdown');
    });

    it('publishes a confirmed composition even when confirming it emits no new editor update', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Words before');
        render(<RichMarkdownEditor value="Words before" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        editor.storage.markdown.getMarkdown.mockReturnValue('Words before nihon');
        const { onUpdate } = (TiptapReact.useEditor as jest.Mock).mock.calls.at(-1)![0];
        act(() => onUpdate({ editor }));
        expect(onChange).not.toHaveBeenCalled();

        editor.storage.markdown.getMarkdown.mockReturnValue('Words before 日本語');
        act(() => onUpdate({ editor }));
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('Words before 日本語');
    });

    it('keeps external content off the composing editor and applies it after cancellation without sending an edit', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(<RichMarkdownEditor value="Opening" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening candidate');
        rerender(<RichMarkdownEditor value="New saved words" onChange={onChange} />);
        expect(editor.setContent).not.toHaveBeenCalled();

        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '' }); });
        expect(editor.setContent).toHaveBeenCalledWith('New saved words', { emitUpdate: false });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not save the selection removal when ProseMirror starts a multi-paragraph composition', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        const opening = 'Selected paragraph\n\nSelected words';
        editor.storage.markdown.getMarkdown.mockReturnValue(opening);
        render(<RichMarkdownEditor value={opening} onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        const { onUpdate } = (TiptapReact.useEditor as jest.Mock).mock.calls.at(-1)![0];
        input.addEventListener('compositionstart', () => {
            editor.storage.markdown.getMarkdown.mockReturnValue('');
            onUpdate({ editor });
            editor.view.composing = true;
        }, { once: true });

        fireEvent.compositionStart(input);
        expect(onChange).not.toHaveBeenCalled();
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '' }); });
        expect(editor.setContent).toHaveBeenCalledWith(opening, { emitUpdate: false });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps a dictated paragraph that arrives before the typed word is confirmed', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(<RichMarkdownEditor value="Opening" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening nihon');
        rerender(<RichMarkdownEditor value={'Opening\n\nDictated paragraph'} onChange={onChange} />);
        expect(onChange).not.toHaveBeenCalled();

        editor.storage.markdown.getMarkdown.mockReturnValue('Opening 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('Opening 日本語\n\nDictated paragraph');
    });

    it('keeps both edits when a proven dictation appends to an empty opening', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        const { rerender } = render(<RichMarkdownEditor value="" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        editor.storage.markdown.getMarkdown.mockReturnValue('nihon');
        rerender(<RichMarkdownEditor value="Dictated words" observedAppend={{ before: '', after: 'Dictated words' }} onChange={onChange} />);
        editor.storage.markdown.getMarkdown.mockReturnValue('日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('日本語\n\nDictated words');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps a proven dictation append when the editor normalizes the opening Markdown', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        const raw = '1) Opening';
        const appended = raw + '\n\nDictated words';
        editor.storage.markdown.getMarkdown.mockReturnValue('1. Opening');
        const { rerender } = render(<RichMarkdownEditor value={raw} onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        rerender(<RichMarkdownEditor value={appended} observedAppend={{ before: raw, after: appended }} onChange={onChange} />);
        editor.storage.markdown.getMarkdown.mockReturnValue('1. Opening 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });

        expect(onChange).toHaveBeenCalledWith('1. Opening 日本語\n\nDictated words');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('uses only the new dictation suffix when a previous fragment was already visible', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        const raw = '1) Opening\n\nFirst fragment';
        const appended = raw + '\n\nSecond fragment';
        editor.storage.markdown.getMarkdown.mockReturnValue('1. Opening\n\nFirst fragment');
        const { rerender } = render(<RichMarkdownEditor value={raw} observedAppend={{ before: '1) Opening', after: raw }} onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        rerender(<RichMarkdownEditor value={appended} observedAppend={{ before: '1) Opening', after: appended }} onChange={onChange} />);
        editor.storage.markdown.getMarkdown.mockReturnValue('1. Opening\n\nFirst fragment 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });

        expect(onChange).toHaveBeenCalledWith('1. Opening\n\nFirst fragment 日本語\n\nSecond fragment');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the append when the parent batches it with the preceding typing echo', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(<RichMarkdownEditor value="Opening" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        const { onUpdate } = (TiptapReact.useEditor as jest.Mock).mock.calls.at(-1)![0];

        editor.storage.markdown.getMarkdown.mockReturnValue('Opening typed');
        act(() => onUpdate({ editor }));
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        rerender(<RichMarkdownEditor value={'Opening typed\n\nDictated paragraph'} onChange={onChange} />);
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening typed 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });

        expect(onChange.mock.calls).toEqual([
            ['Opening typed'],
            ['Opening typed 日本語\n\nDictated paragraph'],
        ]);
    });

    it.each([true, false])('asks before overwriting a different observed copy and honors keepTyped=%s', async keepTyped => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(<RichMarkdownEditor value="Opening" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening nihon');
        rerender(<RichMarkdownEditor value="A different document body" onChange={onChange} />);

        editor.storage.markdown.getMarkdown.mockReturnValue('Opening 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });
        expect(onChange).not.toHaveBeenCalled();
        expect(editor.setContent).not.toHaveBeenCalled();
        const question = screen.getByRole('dialog', { name: 'richEditor.compositionChoice.title' });
        expect(within(question).getByText('Opening 日本語')).toBeInTheDocument();
        expect(within(question).getByText('A different document body')).toBeInTheDocument();

        rerender(<RichMarkdownEditor value="A later document body" onChange={onChange} />);
        expect(within(question).getByText('A later document body')).toBeInTheDocument();
        expect(within(question).queryByText('A different document body')).not.toBeInTheDocument();
        fireEvent.keyDown(question, { key: 'Escape' });
        expect(question).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(within(question).getByRole('button', {
                name: keepTyped ? 'richEditor.compositionChoice.keepTyped' : 'richEditor.compositionChoice.keepUpdated',
            }));
        });
        expect(question).not.toBeInTheDocument();
        if (keepTyped) {
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith('Opening 日本語');
        } else {
            expect(onChange).not.toHaveBeenCalled();
            expect(editor.setContent).toHaveBeenCalledWith('A later document body', { emitUpdate: false });
        }
    });

    it('does not submit the containing form when keeping typed text in the comparison', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        const submit = jest.fn((event: React.FormEvent) => event.preventDefault());
        const view = (value: string) => <form onSubmit={submit}><RichMarkdownEditor value={value} onChange={onChange} /></form>;
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(view('Opening'));
        const input = screen.getByTestId('editor-content');
        editor.view.composing = true;
        fireEvent.compositionStart(input);
        rerender(view('Different words'));
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening 日本語');
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '日本語' }); });
        fireEvent.click(screen.getByRole('button', { name: 'richEditor.compositionChoice.keepTyped' }));

        expect(onChange).toHaveBeenCalledWith('Opening 日本語');
        expect(submit).not.toHaveBeenCalled();
    });

    it('restores the selected paragraphs when a cancelled composition keeps an unacknowledged draft', async () => {
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('Opening');
        const { rerender } = render(<RichMarkdownEditor value="Opening" onChange={onChange} />);
        const input = screen.getByTestId('editor-content');
        const { onUpdate } = (TiptapReact.useEditor as jest.Mock).mock.calls.at(-1)![0];
        const local = 'Local paragraph\n\nOther local words';
        editor.storage.markdown.getMarkdown.mockReturnValue(local);
        act(() => onUpdate({ editor }));
        input.addEventListener('compositionstart', () => {
            editor.storage.markdown.getMarkdown.mockReturnValue('');
            onUpdate({ editor });
            editor.view.composing = true;
        }, { once: true });

        fireEvent.compositionStart(input);
        rerender(<RichMarkdownEditor value="Different words" onChange={onChange} />);
        editor.view.composing = false;
        await act(async () => { fireEvent.compositionEnd(input, { data: '' }); });
        fireEvent.click(screen.getByRole('button', { name: 'richEditor.compositionChoice.keepTyped' }));

        expect(onChange).toHaveBeenLastCalledWith(local);
        expect(editor.setContent).toHaveBeenCalledWith(local, { emitUpdate: false });
    });

    it('updates editor content when the value prop changes', () => {
        const mockEditor = getMockEditor();
        // Initially returns old value
        mockEditor.storage.markdown.getMarkdown.mockReturnValue('old value');

        const { rerender } = render(<RichMarkdownEditor value="old value" onChange={jest.fn()} />);

        // We want to trigger the sync effect. value="new value" but editor still says "old value"
        mockEditor.storage.markdown.getMarkdown.mockReturnValue('old value');

        // Use fake timers to catch the setTimeout(0)
        jest.useFakeTimers();

        rerender(<RichMarkdownEditor value="new value" onChange={jest.fn()} />);

        // Trigger the timers
        act(() => {
            jest.runAllTimers();
        });

        expect(mockEditor.setContent).toHaveBeenCalledWith('new value', { emitUpdate: false });
        jest.useRealTimers();
    });

    it('does not replay an obsolete external value over newer typing', () => {
        jest.useFakeTimers();
        const editor = getMockEditor();
        const onChange = jest.fn();
        editor.storage.markdown.getMarkdown.mockReturnValue('A');
        const { rerender, unmount } = render(<RichMarkdownEditor value="A" onChange={onChange} />);
        rerender(<RichMarkdownEditor value="remote" onChange={onChange} />);
        editor.setContent.mockClear();
        editor.storage.markdown.getMarkdown.mockReturnValue('remote plus typing');
        act(() => {
            const calls = (TiptapReact.useEditor as jest.Mock).mock.calls;
            calls[calls.length - 1][0].onUpdate({ editor });
        });
        act(() => { jest.runAllTimers(); });
        expect(editor.setContent).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenLastCalledWith('remote plus typing');
        unmount();
        jest.useRealTimers();
    });
});
