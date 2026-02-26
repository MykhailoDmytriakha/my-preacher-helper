import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
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
}

export function RichMarkdownEditor({
    value,
    onChange,
    placeholder = 'Введите текст...',
    minHeight = '150px',
    autoFocus = false,
}: RichMarkdownEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
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
                    'prose prose-sm desktop:prose-base dark:prose-invert max-w-none focus:outline-none flex-1 min-h-0 w-full p-3 rounded-b-xl border border-t-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
            },
        },
        onUpdate: ({ editor }) => {
            // @ts-expect-error - tiptap-markdown types don't extend core storage types properly
            onChange((editor.storage.markdown).getMarkdown());
        },
    });

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
        <div className="flex flex-col w-full flex-1 rounded-xl shadow-sm" style={{ minHeight }}>
            <RichMarkdownToolbar editor={editor} />
            <div className="flex-1 cursor-text flex flex-col focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent dark:focus-within:ring-indigo-400">
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
