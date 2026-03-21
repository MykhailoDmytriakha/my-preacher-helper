import { Editor, useEditorState } from '@tiptap/react';
import {
    Bold,
    Italic,
    Strikethrough,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    Quote
} from 'lucide-react';
import React from 'react';

interface RichMarkdownToolbarProps {
    editor: Editor | null;
}

export function RichMarkdownToolbar({ editor }: RichMarkdownToolbarProps) {
    const toolbarState = useEditorState({
        editor,
        selector: ({ editor: currentEditor }) => ({
            bold: currentEditor?.isActive('bold') ?? false,
            italic: currentEditor?.isActive('italic') ?? false,
            strike: currentEditor?.isActive('strike') ?? false,
            heading1: currentEditor?.isActive('heading', { level: 1 }) ?? false,
            heading2: currentEditor?.isActive('heading', { level: 2 }) ?? false,
            heading3: currentEditor?.isActive('heading', { level: 3 }) ?? false,
            bulletList: currentEditor?.isActive('bulletList') ?? false,
            orderedList: currentEditor?.isActive('orderedList') ?? false,
            blockquote: currentEditor?.isActive('blockquote') ?? false,
        }),
    }) ?? DEFAULT_TOOLBAR_STATE;

    if (!editor) {
        return null;
    }

    const handleToggle = (command: () => boolean, e: React.MouseEvent) => {
        e.preventDefault();
        command();
    };

    return (
        <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-t-xl border-b-0">
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBold().run(), e)}
                isActive={toolbarState.bold}
                ariaLabel="Bold"
            >
                <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleItalic().run(), e)}
                isActive={toolbarState.italic}
                ariaLabel="Italic"
            >
                <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleStrike().run(), e)}
                isActive={toolbarState.strike}
                ariaLabel="Strikethrough"
            >
                <Strikethrough className="w-4 h-4" />
            </ToolbarButton>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), e)}
                isActive={toolbarState.heading1}
                ariaLabel="Heading 1"
            >
                <Heading1 className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), e)}
                isActive={toolbarState.heading2}
                ariaLabel="Heading 2"
            >
                <Heading2 className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), e)}
                isActive={toolbarState.heading3}
                ariaLabel="Heading 3"
            >
                <Heading3 className="w-4 h-4" />
            </ToolbarButton>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBulletList().run(), e)}
                isActive={toolbarState.bulletList}
                ariaLabel="Bullet List"
            >
                <List className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleOrderedList().run(), e)}
                isActive={toolbarState.orderedList}
                ariaLabel="Ordered List"
            >
                <ListOrdered className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBlockquote().run(), e)}
                isActive={toolbarState.blockquote}
                ariaLabel="Quote"
            >
                <Quote className="w-4 h-4" />
            </ToolbarButton>
        </div>
    );
}

const DEFAULT_TOOLBAR_STATE = {
    bold: false,
    italic: false,
    strike: false,
    heading1: false,
    heading2: false,
    heading3: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
};

interface ToolbarButtonProps {
    onClick: (e: React.MouseEvent) => void;
    isActive: boolean;
    children: React.ReactNode;
    ariaLabel: string;
}

function ToolbarButton({ onClick, isActive, children, ariaLabel }: ToolbarButtonProps) {
    return (
        <button
            onClick={onClick}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`p-1.5 rounded-md transition-colors ${isActive
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
        >
            {children}
        </button>
    );
}
