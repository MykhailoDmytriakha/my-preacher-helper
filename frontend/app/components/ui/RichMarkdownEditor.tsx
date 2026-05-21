import { type Extensions } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import React, { useEffect } from 'react';
import { Markdown } from 'tiptap-markdown';

import { RichMarkdownToolbar } from './RichMarkdownToolbar';

interface RichMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    minHeight?: string;
    autoFocus?: boolean;
    onBlur?: () => void;
    /** Hide the toolbar (caller is providing its own affordances). */
    hideToolbar?: boolean;
    /** Extra className for the outer wrapper. */
    className?: string;
    /**
     * Feature-local extensions layered into the shared editor config.
     * Keep shared Markdown/StarterKit wiring here while allowing specialized
     * callers to add narrow schema nodes such as study wikilinks.
     */
    extraExtensions?: Extensions;
    /**
     * Receives the underlying tiptap `Editor` instance once it's available
     * (and `null` on unmount). Lets callers wire features that need direct
     * editor access — e.g. tracking selection for an external picker — while
     * keeping this component otherwise opaque.
     */
    onEditorReady?: (editor: Editor | null) => void;
    /** Hide the H1/H2/H3 cluster from the toolbar. */
    toolbarHideHeadings?: boolean;
    /** Render slot for extra toolbar buttons (e.g. wikilink picker trigger). */
    toolbarExtras?: (editor: Editor) => React.ReactNode;
}

export function RichMarkdownEditor({
    value,
    onChange,
    placeholder = 'Введите текст...',
    minHeight = '150px',
    autoFocus = false,
    onBlur,
    hideToolbar = false,
    className = '',
    extraExtensions = [],
    onEditorReady,
    toolbarHideHeadings = false,
    toolbarExtras,
}: RichMarkdownEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            ...extraExtensions,
            Markdown,
            Placeholder.configure({
                placeholder,
            }),
        ],
        content: value,
        immediatelyRender: false,
        autofocus: autoFocus ? 'end' : false,
        editorProps: {
            attributes: {
                class:
                    `prose prose-sm desktop:prose-base dark:prose-invert max-w-none focus:outline-none flex-1 min-h-0 w-full p-3 ${hideToolbar ? 'rounded-xl border' : 'rounded-b-xl border border-t-0'} border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500`,
            },
        },
        onUpdate: ({ editor }) => {
            // @ts-expect-error - tiptap-markdown types don't extend core storage types properly
            onChange((editor.storage.markdown).getMarkdown());
        },
        onBlur: onBlur ? () => onBlur() : undefined,
    });

    // Expose the editor instance to callers that need direct access (e.g. for
    // a wikilink picker that has to read selection coords and insert tokens
    // at a specific range). Fires on mount + unmount so callers can clean up.
    useEffect(() => {
        if (!onEditorReady) return;
        onEditorReady(editor);
        return () => onEditorReady(null);
    }, [editor, onEditorReady]);

    // Effect to sync external prop changes back into the editor (e.g., initial load or cancel changes)
    useEffect(() => {
        // @ts-expect-error - type
        const currentMarkdown = editor ? (editor.storage.markdown).getMarkdown() : '';
        if (editor && value !== currentMarkdown) {
            // Small timeout prevents race conditions right after mounting
            setTimeout(() => {
                // @ts-expect-error - type
                if (value !== (editor.storage.markdown).getMarkdown()) {
                    editor.commands.setContent(value);
                }
            }, 0);
        }
    }, [value, editor]);

    if (!editor) {
        return null;
    }

    return (
        <div className={`flex flex-col w-full flex-1 rounded-xl shadow-sm ${className}`} style={{ minHeight }}>
            {!hideToolbar && (
                <RichMarkdownToolbar
                    editor={editor}
                    hideHeadings={toolbarHideHeadings}
                    extraButtons={toolbarExtras}
                />
            )}
            <div className="flex-1 cursor-text flex flex-col">
                <EditorContent
                    editor={editor}
                    className="w-full flex-1 flex flex-col"
                    style={{ minHeight: 'inherit' }}
                    onClick={() => editor.chain().focus().run()}
                />
            </div>
        </div>
    );
}
