import { Extension } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, type Editor, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import React, { useEffect, useMemo } from 'react';
import { Markdown } from 'tiptap-markdown';

import {
    clampHeadingLevel,
    getDemotedHeadingLevel,
    getPromotedHeadingLevel,
    MIN_MARKDOWN_HEADING_LEVEL,
} from './richMarkdownStructure';
import { RichMarkdownToolbar } from './RichMarkdownToolbar';

interface RichMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    minHeight?: string;
    autoFocus?: boolean;
    stickyToolbar?: boolean;
    stickyToolbarTop?: string;
    showOutlineStructureControls?: boolean;
    pendingHeadingSelection?: PendingHeadingSelectionRequest | null;
}

export interface PendingHeadingSelectionRequest {
    token: string;
    headingText: string;
    headingLevel: number;
    occurrenceIndex: number;
}

const OutlineHeadingHotkeys = Extension.create({
    name: 'outlineHeadingHotkeys',
    addKeyboardShortcuts() {
        return {
            Tab: () => handleOutlineTabShortcut(this.editor, 'deeper'),
            'Shift-Tab': () => handleOutlineTabShortcut(this.editor, 'shallower'),
        };
    },
});

interface HeadingShortcutEditor {
    state: Editor['state'];
    chain: Editor['chain'];
}

interface OutlineBlockDescriptor {
    type: string;
    from: number;
    to: number;
    level?: number | null;
}

interface OutlineDepthDecorationDescriptor {
    from: number;
    to: number;
    depth: number;
}

interface HeadingSelectionDescriptor {
    level: number;
    text: string;
    from: number;
    to: number;
}

interface MarkdownStorageShape {
    markdown?: {
        getMarkdown?: () => string;
    };
}

const BASE_EDITOR_CLASS_NAME =
    'prose prose-sm desktop:prose-base dark:prose-invert max-w-none focus:outline-none flex-1 min-h-0 w-full p-3 rounded-b-xl border border-t-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500';

const OUTLINE_BLOCK_INDENT_CLASS_NAME = [
    '[&_.outline-depth-1]:ml-0',
    '[&_.outline-depth-2]:ml-3',
    '[&_.outline-depth-3]:ml-6',
    '[&_.outline-depth-4]:ml-9',
    '[&_.outline-depth-5]:ml-12',
    '[&_.outline-depth-6]:ml-15',
    'desktop:[&_.outline-depth-2]:ml-4',
    'desktop:[&_.outline-depth-3]:ml-8',
    'desktop:[&_.outline-depth-4]:ml-12',
    'desktop:[&_.outline-depth-5]:ml-16',
    'desktop:[&_.outline-depth-6]:ml-20',
].join(' ');

export function getOutlineNodeDecorationRange(offset: number, nodeSize: number): Pick<OutlineBlockDescriptor, 'from' | 'to'> {
    return {
        from: offset,
        to: offset + nodeSize,
    };
}

export function getOutlineBaseHeadingLevel(blocks: OutlineBlockDescriptor[]): number | null {
    const headingLevels = blocks
        .filter((block) => block.type === 'heading' && typeof block.level === 'number')
        .map((block) => clampHeadingLevel(block.level as number));

    if (headingLevels.length === 0) {
        return null;
    }

    return Math.min(...headingLevels);
}

function getEditorMarkdown(editor: Editor | null): string {
    const storage = editor?.storage as MarkdownStorageShape | undefined;
    return storage?.markdown?.getMarkdown?.() ?? '';
}

const OutlineDepthDecorations = Extension.create({
    name: 'outlineDepthDecorations',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('outlineDepthDecorations'),
                props: {
                    decorations(state) {
                        const outlineBlocks: OutlineBlockDescriptor[] = [];

                        state.doc.forEach((node, offset) => {
                            const { from, to } = getOutlineNodeDecorationRange(offset, node.nodeSize);

                            outlineBlocks.push({
                                type: node.type.name,
                                from,
                                to,
                                level: typeof node.attrs.level === 'number' ? node.attrs.level : null,
                            });
                        });

                        const decorations = getOutlineDepthDecorationsForBlocks(outlineBlocks).map(({ from, to, depth }) =>
                            Decoration.node(from, to, {
                                class: `outline-depth-${depth}`,
                            })
                        );

                        return DecorationSet.create(state.doc, decorations);
                    },
                },
            }),
        ];
    },
});

export function getRichMarkdownEditorClassName(showOutlineStructureControls: boolean): string {
    if (!showOutlineStructureControls) {
        return BASE_EDITOR_CLASS_NAME;
    }

    return `${BASE_EDITOR_CLASS_NAME} ${OUTLINE_BLOCK_INDENT_CLASS_NAME}`;
}

export function getOutlineDepthDecorationsForBlocks(
    blocks: OutlineBlockDescriptor[]
): OutlineDepthDecorationDescriptor[] {
    const baseHeadingLevel = getOutlineBaseHeadingLevel(blocks);
    let currentDepth: number | null = null;

    return blocks.flatMap((block) => {
        if (block.type === 'heading' && typeof block.level === 'number' && baseHeadingLevel !== null) {
            currentDepth = Math.max(
                1,
                clampHeadingLevel(block.level) - baseHeadingLevel + 1
            );
        }

        if (currentDepth === null) {
            return [];
        }

        return [{
            from: block.from,
            to: block.to,
            depth: currentDepth,
        }];
    });
}

export function findHeadingSelectionRange(
    headings: HeadingSelectionDescriptor[],
    pendingHeadingSelection: PendingHeadingSelectionRequest
): Pick<HeadingSelectionDescriptor, 'from' | 'to'> | null {
    const matchingHeadings = headings.filter((heading) =>
        heading.level === pendingHeadingSelection.headingLevel &&
        heading.text === pendingHeadingSelection.headingText
    );

    const matchingHeading = matchingHeadings[pendingHeadingSelection.occurrenceIndex];

    if (!matchingHeading) {
        return null;
    }

    return {
        from: matchingHeading.from,
        to: matchingHeading.to,
    };
}

function collectHeadingSelectionDescriptors(doc: Editor['state']['doc']): HeadingSelectionDescriptor[] {
    const headings: HeadingSelectionDescriptor[] = [];

    doc.descendants((node, position) => {
        if (node.type.name !== 'heading' || typeof node.attrs.level !== 'number') {
            return true;
        }

        headings.push({
            level: clampHeadingLevel(node.attrs.level),
            text: node.textContent,
            from: position + 1,
            to: position + 1 + node.textContent.length,
        });

        return true;
    });

    return headings;
}

export function RichMarkdownEditor({
    value,
    onChange,
    placeholder = 'Введите текст...',
    minHeight = '150px',
    autoFocus = false,
    stickyToolbar = false,
    stickyToolbarTop = '0px',
    showOutlineStructureControls = false,
    pendingHeadingSelection = null,
}: RichMarkdownEditorProps) {
    const extensions = useMemo(() => {
        const configuredExtensions = [
            StarterKit,
            Markdown,
            Placeholder.configure({
                placeholder,
            }),
        ];

        if (showOutlineStructureControls) {
            configuredExtensions.push(OutlineHeadingHotkeys);
            configuredExtensions.push(OutlineDepthDecorations);
        }

        return configuredExtensions;
    }, [placeholder, showOutlineStructureControls]);

    const editor = useEditor({
        extensions,
        content: value,
        immediatelyRender: false,
        autofocus: autoFocus ? 'end' : false,
        editorProps: {
            attributes: {
                class: getRichMarkdownEditorClassName(showOutlineStructureControls),
            },
        },
        onUpdate: ({ editor }) => {
            onChange(getEditorMarkdown(editor));
        },
    });

    // Effect to sync external prop changes back into the editor (e.g., initial load or cancel changes)
    useEffect(() => {
        const currentMarkdown = getEditorMarkdown(editor);

        if (editor && value !== currentMarkdown) {
            // Small timeout prevents race conditions right after mounting
            const syncTimeoutId = window.setTimeout(() => {
                if (value !== getEditorMarkdown(editor)) {
                    editor.commands.setContent(value);
                }
            }, 0);

            return () => window.clearTimeout(syncTimeoutId);
        }

        return undefined;
    }, [value, editor]);

    useEffect(() => {
        if (!editor || !pendingHeadingSelection) {
            return undefined;
        }

        const selectionTimeoutId = window.setTimeout(() => {
            const headingSelectionRange = findHeadingSelectionRange(
                collectHeadingSelectionDescriptors(editor.state.doc),
                pendingHeadingSelection
            );

            if (!headingSelectionRange) {
                return;
            }

            editor.view.dispatch(
                editor.state.tr.setSelection(
                    TextSelection.create(
                        editor.state.doc,
                        headingSelectionRange.from,
                        headingSelectionRange.to
                    )
                ).scrollIntoView()
            );
            editor.view.focus();
        }, 0);

        return () => window.clearTimeout(selectionTimeoutId);
    }, [editor, pendingHeadingSelection]);

    if (!editor) {
        return null;
    }

    return (
        <div className="flex flex-col w-full flex-1 rounded-xl shadow-sm" style={{ minHeight }}>
            <RichMarkdownToolbar
                editor={editor}
                sticky={stickyToolbar}
                stickyTop={stickyToolbarTop}
                showOutlineStructureControls={showOutlineStructureControls}
            />
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

export function shiftHeadingDepth(editor: HeadingShortcutEditor, direction: 'deeper' | 'shallower'): boolean {
    const parentNode = editor.state.selection.$from.parent;

    if (parentNode.type.name !== 'heading' || typeof parentNode.attrs.level !== 'number') {
        return false;
    }

    if (direction === 'shallower' && parentNode.attrs.level === MIN_MARKDOWN_HEADING_LEVEL) {
        return editor.chain().focus().setParagraph().run();
    }

    const nextLevel = direction === 'deeper'
        ? getDemotedHeadingLevel(parentNode.attrs.level)
        : getPromotedHeadingLevel(parentNode.attrs.level);

    if (nextLevel === null || nextLevel === parentNode.attrs.level) {
        return true;
    }

    return editor.chain().focus().setHeading({ level: nextLevel }).run();
}

export function handleOutlineTabShortcut(editor: HeadingShortcutEditor, direction: 'deeper' | 'shallower'): boolean {
    const parentNode = editor.state.selection.$from.parent;

    if (parentNode.type.name === 'heading') {
        return shiftHeadingDepth(editor, direction);
    }

    if (parentNode.type.name === 'paragraph') {
        if (direction === 'shallower') {
            return true;
        }

        return editor.chain().focus().setHeading({ level: MIN_MARKDOWN_HEADING_LEVEL }).run();
    }

    return false;
}
