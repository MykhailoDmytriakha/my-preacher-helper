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
import { useTranslation } from 'react-i18next';

interface RichMarkdownToolbarProps {
    editor: Editor | null;
    /**
     * Keeps the formatting buttons in view while a long note scrolls past. Opt-in: the
     * editor also lives inside modals, where sticking would fight their own scrolling.
     * The number is the distance from the top of the window to stick at.
     */
    stickyTop?: number;
    /**
     * The editor's own word that its text is held still (a save being accepted). Said, not read back from the
     * editor: `useEditorState` hears transactions, and making an editor read-only is not one (Codex review, 2026-10-28).
     */
    disabled?: boolean;
}

export function RichMarkdownToolbar({ editor, stickyTop, disabled = false }: RichMarkdownToolbarProps) {
    // A button's name is its tooltip and what a screen reader says: in the interface's language.
    const { t } = useTranslation();
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

    // Only the editor's word: a snapshot from useEditorState would stay "held" after the text is released, until the next
    // transaction (Codex review, 2026-10-28).
    const locked = disabled;
    const handleToggle = (command: () => boolean, e: React.MouseEvent) => {
        e.preventDefault();
        // Checked at the press too: a button drawn a moment before the text was held still must not change it.
        if (disabled || !editor.isEditable) return;
        command();
    };

    return (
        <div
            className={`flex flex-wrap items-center gap-1 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-t-xl border-b-0${stickyTop === undefined ? '' : ' sticky z-20'}`}
            style={stickyTop === undefined ? undefined : { top: stickyTop }}>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBold().run(), e)}
                disabled={locked}
                isActive={toolbarState.bold}
                ariaLabel={t('richText.bold')}
            >
                <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleItalic().run(), e)}
                disabled={locked}
                isActive={toolbarState.italic}
                ariaLabel={t('richText.italic')}
            >
                <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleStrike().run(), e)}
                disabled={locked}
                isActive={toolbarState.strike}
                ariaLabel={t('richText.strikethrough')}
            >
                <Strikethrough className="w-4 h-4" />
            </ToolbarButton>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), e)}
                disabled={locked}
                isActive={toolbarState.heading1}
                ariaLabel={t('richText.heading1')}
            >
                <Heading1 className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), e)}
                disabled={locked}
                isActive={toolbarState.heading2}
                ariaLabel={t('richText.heading2')}
            >
                <Heading2 className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), e)}
                disabled={locked}
                isActive={toolbarState.heading3}
                ariaLabel={t('richText.heading3')}
            >
                <Heading3 className="w-4 h-4" />
            </ToolbarButton>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBulletList().run(), e)}
                disabled={locked}
                isActive={toolbarState.bulletList}
                ariaLabel={t('richText.bulletList')}
            >
                <List className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleOrderedList().run(), e)}
                disabled={locked}
                isActive={toolbarState.orderedList}
                ariaLabel={t('richText.orderedList')}
            >
                <ListOrdered className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(e) => handleToggle(() => editor.chain().focus().toggleBlockquote().run(), e)}
                disabled={locked}
                isActive={toolbarState.blockquote}
                ariaLabel={t('richText.quote')}
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
    /** The editor holds still (a save is being accepted): the marks wait too. */
    disabled?: boolean;
    children: React.ReactNode;
    ariaLabel: string;
}

function ToolbarButton({ onClick, isActive, disabled = false, children, ariaLabel }: ToolbarButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`p-1.5 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isActive
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
        >
            {children}
        </button>
    );
}
