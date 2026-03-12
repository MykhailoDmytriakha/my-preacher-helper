import { Editor, useEditorState } from '@tiptap/react';
import {
    Bold,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    List,
    ListOrdered,
    Quote,
    Strikethrough,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import {
    getChildBranchLevel,
    getContextBranchLevel,
    MarkdownHeadingLevel,
    getPromotedHeadingLevel,
} from './richMarkdownStructure';

import type { OutlineBranchSelectionRequest } from './RichMarkdownEditor';

interface RichMarkdownToolbarProps {
    editor: Editor;
    sticky?: boolean;
    stickyTop?: string;
    showOutlineStructureControls?: boolean;
    outlineBranchSelection?: OutlineBranchSelectionRequest | null;
    onCreateSiblingBranch?: (() => void) | null;
    onCreateChildBranch?: (() => void) | null;
    canCreateSiblingBranch?: boolean;
    canCreateChildBranch?: boolean;
}

interface ToolbarState {
    isBold: boolean;
    isItalic: boolean;
    isStrike: boolean;
    isBulletList: boolean;
    isOrderedList: boolean;
    isBlockquote: boolean;
    isHeading1: boolean;
    isHeading2: boolean;
    isHeading3: boolean;
    currentHeadingLevel: number | null;
    previousHeadingLevel: number | null;
}

export function RichMarkdownToolbar({
    editor,
    sticky = false,
    stickyTop = '0px',
    showOutlineStructureControls = false,
    outlineBranchSelection = null,
    onCreateSiblingBranch = null,
    onCreateChildBranch = null,
    canCreateSiblingBranch = false,
    canCreateChildBranch = false,
}: RichMarkdownToolbarProps) {
    const { t } = useTranslation();

    const toolbarState = useEditorState({
        editor,
        selector: ({ editor: currentEditor }): ToolbarState => {
            if (!currentEditor) {
                return {
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
                    previousHeadingLevel: null,
                };
            }
            return {
                isBold: currentEditor.isActive('bold'),
                isItalic: currentEditor.isActive('italic'),
                isStrike: currentEditor.isActive('strike'),
                isBulletList: currentEditor.isActive('bulletList'),
                isOrderedList: currentEditor.isActive('orderedList'),
                isBlockquote: currentEditor.isActive('blockquote'),
                isHeading1: currentEditor.isActive('heading', { level: 1 }),
                isHeading2: currentEditor.isActive('heading', { level: 2 }),
                isHeading3: currentEditor.isActive('heading', { level: 3 }),
                currentHeadingLevel: getCurrentHeadingLevel(currentEditor),
                previousHeadingLevel: showOutlineStructureControls ? getPreviousHeadingLevel(currentEditor) : null,
            };
        },
    });

    const handleToggle = (command: () => boolean, event: React.MouseEvent) => {
        event.preventDefault();
        command();
    };

    if (!editor) return null;

    const headingContext = {
        currentHeadingLevel: toolbarState.currentHeadingLevel,
        previousHeadingLevel: toolbarState.previousHeadingLevel,
    };
    const contextBranchLevel = getContextBranchLevel(headingContext);
    const childBranchLevel = getChildBranchLevel(headingContext);
    const promotedHeadingLevel = getPromotedHeadingLevel(toolbarState.currentHeadingLevel);
    const currentBlockValue = toolbarState.currentHeadingLevel
        ? `heading-${toolbarState.currentHeadingLevel}`
        : 'paragraph';

    const toolbarClassName = `flex flex-wrap items-center gap-1 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-t-xl border-b-0 ${
        sticky ? 'sticky z-20 shadow-sm' : ''
    }`;

    return (
        <div className={toolbarClassName} style={sticky ? { top: stickyTop } : undefined}>
            {showOutlineStructureControls && (
                <>
                    <div className="flex items-center gap-1 rounded-lg border border-emerald-100 bg-white px-1.5 py-1 shadow-sm dark:border-emerald-900/60 dark:bg-gray-950/70">
                        <select
                            value={currentBlockValue}
                            onChange={(event) => {
                                const selectedValue = event.target.value;

                                if (selectedValue === 'paragraph') {
                                    editor.chain().focus().setParagraph().run();
                                    return;
                                }

                                const level = Number(selectedValue.replace('heading-', '')) as MarkdownHeadingLevel;
                                editor.chain().focus().setHeading({ level }).run();
                            }}
                            className="rounded-md border-none bg-transparent px-2 py-1 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:text-gray-200"
                            aria-label={t('common.blockType') || 'Block type'}
                        >
                            <option value="paragraph">{t('common.bodyText') || 'Body'}</option>
                            <option value="heading-1">H1</option>
                            <option value="heading-2">H2</option>
                            <option value="heading-3">H3</option>
                            <option value="heading-4">H4</option>
                            <option value="heading-5">H5</option>
                            <option value="heading-6">H6</option>
                        </select>

                        <ToolbarTextButton
                            onClick={() => editor.chain().focus().setHeading({ level: contextBranchLevel }).run()}
                            label={t('common.makeBranch') || 'Make branch'}
                            ariaLabel={t('common.branchAtCurrentLevel', { level: contextBranchLevel }) || `Branch at level H${contextBranchLevel}`}
                        />
                        <ToolbarTextButton
                            onClick={() => editor.chain().focus().setHeading({ level: childBranchLevel }).run()}
                            label={t('common.makeChildBranch') || 'Make child'}
                            ariaLabel={t('common.childBranchAtLevel', { level: childBranchLevel }) || `Child branch at level H${childBranchLevel}`}
                        />
                        <ToolbarTextButton
                            onClick={() => {
                                if (toolbarState.currentHeadingLevel === 1) {
                                    editor.chain().focus().setParagraph().run();
                                    return;
                                }

                                if (promotedHeadingLevel !== null) {
                                    editor.chain().focus().setHeading({ level: promotedHeadingLevel }).run();
                                }
                            }}
                            label={t('common.promote') || 'Up'}
                            ariaLabel={t('common.promoteBranch') || 'Promote branch'}
                            disabled={toolbarState.currentHeadingLevel === null}
                        />
                    </div>

                    <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-white px-1.5 py-1 shadow-sm dark:border-indigo-900/60 dark:bg-gray-950/70">
                        <ToolbarTextButton
                            onClick={() => onCreateSiblingBranch?.()}
                            label={t('common.addBranch') || 'Add branch'}
                            ariaLabel={outlineBranchSelection
                                ? t('common.addBranchAfterCurrent') || 'Add branch after current branch'
                                : t('common.addBranch') || 'Add branch'}
                            disabled={!canCreateSiblingBranch || !onCreateSiblingBranch}
                        />
                        <ToolbarTextButton
                            onClick={() => onCreateChildBranch?.()}
                            label={t('common.addChildBranch') || 'Add child'}
                            ariaLabel={outlineBranchSelection
                                ? t('common.addChildUnderCurrent') || 'Add child branch under current branch'
                                : t('common.addChildBranch') || 'Add child branch'}
                            disabled={!canCreateChildBranch || !onCreateChildBranch}
                        />
                    </div>

                    <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
                </>
            )}

            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleBold().run(), event)}
                isActive={toolbarState.isBold}
                ariaLabel="Bold"
            >
                <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleItalic().run(), event)}
                isActive={toolbarState.isItalic}
                ariaLabel="Italic"
            >
                <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleStrike().run(), event)}
                isActive={toolbarState.isStrike}
                ariaLabel="Strikethrough"
            >
                <Strikethrough className="w-4 h-4" />
            </ToolbarButton>

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            {!showOutlineStructureControls && (
                <>
                    <ToolbarButton
                        onClick={(event) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), event)}
                        isActive={toolbarState.isHeading1}
                        ariaLabel="Heading 1"
                    >
                        <Heading1 className="w-4 h-4" />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={(event) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), event)}
                        isActive={toolbarState.isHeading2}
                        ariaLabel="Heading 2"
                    >
                        <Heading2 className="w-4 h-4" />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={(event) => handleToggle(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), event)}
                        isActive={toolbarState.isHeading3}
                        ariaLabel="Heading 3"
                    >
                        <Heading3 className="w-4 h-4" />
                    </ToolbarButton>
                </>
            )}

            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleBulletList().run(), event)}
                isActive={toolbarState.isBulletList}
                ariaLabel="Bullet List"
            >
                <List className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleOrderedList().run(), event)}
                isActive={toolbarState.isOrderedList}
                ariaLabel="Ordered List"
            >
                <ListOrdered className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={(event) => handleToggle(() => editor.chain().focus().toggleBlockquote().run(), event)}
                isActive={toolbarState.isBlockquote}
                ariaLabel="Quote"
            >
                <Quote className="w-4 h-4" />
            </ToolbarButton>
        </div>
    );
}

function getCurrentHeadingLevel(editor: Editor): number | null {
    const parentNode = editor.state.selection.$from.parent;

    if (parentNode.type.name !== 'heading') {
        return null;
    }

    return typeof parentNode.attrs.level === 'number' ? parentNode.attrs.level : null;
}

function getPreviousHeadingLevel(editor: Editor): number | null {
    const { doc, selection } = editor.state;
    let previousHeadingLevel: number | null = null;

    doc.nodesBetween(0, selection.from, (node) => {
        if (node.type.name === 'heading' && typeof node.attrs.level === 'number') {
            previousHeadingLevel = node.attrs.level;
        }
    });

    return previousHeadingLevel;
}

interface ToolbarButtonProps {
    onClick: (event: React.MouseEvent) => void;
    isActive: boolean;
    children: React.ReactNode;
    ariaLabel: string;
}

function ToolbarButton({ onClick, isActive, children, ariaLabel }: ToolbarButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`p-1.5 rounded-md transition-colors ${
                isActive
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
        >
            {children}
        </button>
    );
}

interface ToolbarTextButtonProps {
    onClick: () => void;
    label: string;
    ariaLabel: string;
    disabled?: boolean;
}

function ToolbarTextButton({ onClick, label, ariaLabel, disabled = false }: ToolbarTextButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                disabled
                    ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                    : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
            }`}
        >
            {label}
        </button>
    );
}
