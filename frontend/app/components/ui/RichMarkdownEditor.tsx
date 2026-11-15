import Placeholder from '@tiptap/extension-placeholder';
import { closeHistory } from '@tiptap/pm/history';
import { EditorContent, useEditor } from '@tiptap/react';
import React, { useEffect, useRef } from 'react';

import { retireHistory } from './foreignHistory';
import { richMarkdownExtensions } from './richMarkdownExtensions';
import { RichMarkdownToolbar } from './RichMarkdownToolbar';
import { syncClickedTextSelection } from './syncClickedTextSelection';
import { useBufferedText } from './useBufferedText';
import { useStickyEditorViewport } from './useStickyEditorViewport';

interface RichMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Witness the applied document once, before its first subsequent edit. */
    onEditAfterForeignValue?: (value: string) => void;
    /** Opt in only when the supplied value is this editor user's requested edit. */
    valueIsUserAction?: boolean;
    /** A foreign value coalesced with the own action; apply its boundary first. */
    valueBeforeUserAction?: { value: string | null };
    placeholder?: string;
    minHeight?: string;
    autoFocus?: boolean;
    /** Distance from the top of the window to keep the toolbar at while scrolling. */
    stickyToolbarTop?: number;
    /** False holds the text still — a save being accepted must not take later keystrokes away with it. */
    editable?: boolean;
}

export function RichMarkdownEditor({
    value,
    onChange,
    onEditAfterForeignValue,
    valueIsUserAction = false,
    valueBeforeUserAction,
    placeholder = '',
    minHeight = '150px',
    autoFocus = false,
    stickyToolbarTop,
    editable = true,
}: RichMarkdownEditorProps) {
    const foreignEditMark = useRef<string | null>(value);
    const lastEmittedText = useRef<string | null>(null);
    const { draft, change, getPending } = useBufferedText(value, onChange);
    const { toolbarRef, scrollProps } = useStickyEditorViewport(stickyToolbarTop);
    const editor = useEditor({
        extensions: [
            ...richMarkdownExtensions(),
            Placeholder.configure({
                placeholder,
            }),
        ],
        content: value,
        editable,
        immediatelyRender: false,
        autofocus: autoFocus ? 'end' : false,
        editorProps: {
            ...scrollProps,
            attributes: {
                // A table scrolls inside its own box, as it does when the note is read (`MarkdownDisplay`): its longest
                // word would otherwise widen the page on a phone. A cell holds one paragraph, without the prose margins.
                class:
                    'prose prose-sm desktop:prose-base dark:prose-invert max-w-none focus:outline-none flex-1 min-h-0 w-full p-3 rounded-b-xl border border-t-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td>p]:my-0 [&_th>p]:my-0',
            },
        },
        onUpdate: ({ editor }) => {
            // An echo is not an application: consume only the last document actually installed.
            const mark = foreignEditMark.current;
            foreignEditMark.current = null;
            if (mark !== null) onEditAfterForeignValue?.(mark);
            // @ts-expect-error - tiptap-markdown types don't extend core storage types properly
            const next = (editor.storage.markdown).getMarkdown();
            lastEmittedText.current = next;
            change(next);
        },
    });

    const appliedForeignValue = useRef(valueBeforeUserAction);

    // ACCEPTED LIMITATION: a foreign value retires this editor's entire Undo/Redo history.
    // Until the person acts again, Undo and Redo do nothing, including for earlier own typing.
    // Later own actions are undoable as usual; Undo/Redo cannot cross the arrival boundary.
    // Use production's full-document setContent for both origins, including its selection and
    // composition behavior. Only an explicit own action enters history; neither origin emits an update.
    useEffect(() => {
        // Input may have landed after this render; replacing now would erase its Undo history.
        if (!editor || editor.isDestroyed || getPending() !== null) return;
        const replace = (next: string, own: boolean) => {
            // @ts-expect-error - tiptap-markdown storage is not declared by core
            if (next === editor.storage.markdown.getMarkdown()) {
                if (!own && next !== lastEmittedText.current) foreignEditMark.current = next;
                return;
            }
            editor.chain()
                .command(({ tr }) => {
                    closeHistory(tr).setMeta('addToHistory', own);
                    return true;
                })
                .setContent(next, { emitUpdate: false })
                .run();
            lastEmittedText.current = null;
            foreignEditMark.current = own ? null : next;
            if (!own) retireHistory(editor);
        };
        // The buffer can still contain the previous render's draft. Wait for its value echo,
        // and consume this baseline once so an origin-only render cannot replay it over typing.
        if (valueIsUserAction && valueBeforeUserAction && draft === value
            && appliedForeignValue.current !== valueBeforeUserAction) {
            appliedForeignValue.current = valueBeforeUserAction;
            if (valueBeforeUserAction.value !== null) replace(valueBeforeUserAction.value, false);
        }
        replace(draft, valueIsUserAction && valueBeforeUserAction?.value !== null);
    }, [draft, editor, value, valueIsUserAction, valueBeforeUserAction, getPending]);

    useEffect(() => {
        // Without `false` Tiptap announces an update, and onUpdate would send the words still drawn back as a user
        // edit — over a value just given (a draft restored as the editor is released was wiped live, 2026-10-28).
        if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
    }, [editor, editable]);

    if (!editor) {
        return null;
    }

    return (
        <div className="flex flex-col w-full flex-1 rounded-xl shadow-sm" style={{ minHeight }}>
            <RichMarkdownToolbar editor={editor} stickyTop={stickyToolbarTop} elementRef={toolbarRef} disabled={!editable} />
            <div className="flex-1 cursor-text flex flex-col">
                <EditorContent
                    editor={editor}
                    className="w-full flex-1 flex flex-col"
                    style={{ minHeight: 'inherit' }}
                    onClick={event => {
                        syncClickedTextSelection(editor.view, event.nativeEvent);
                        editor.chain().focus().run();
                    }}
                />
            </div>
        </div>
    );
}
