import Placeholder from '@tiptap/extension-placeholder';
import { closeHistory } from '@tiptap/pm/history';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { retireHistory } from './foreignHistory';
import { adoptOutsideMarkdownSelection, mapForeignMarkdownSelection } from './foreignMarkdownSelection';
import { decideComposition, type CompositionOpening, type ObservedTextAppend } from './richMarkdownComposition';
import { RichMarkdownCompositionChoice } from './RichMarkdownCompositionChoice';
import { richMarkdownExtensions } from './richMarkdownExtensions';
import { RichMarkdownToolbar } from './RichMarkdownToolbar';
import { syncClickedTextSelection } from './syncClickedTextSelection';
import { useBufferedText } from './useBufferedText';
import { useStickyEditorViewport } from './useStickyEditorViewport';

import type { Node as DocumentNode } from '@tiptap/pm/model';

interface RichMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void | Promise<unknown>;
    /** Let the document keep a confirmed alternative before the user chooses a version. */
    onHoldText?: (typed: string) => ((keep: boolean, chosenWrite?: void | Promise<unknown>) => void) | undefined;
    /** A proven append from a document action, including an append to an empty draft. */
    observedAppend?: ObservedTextAppend;
    /** Text now owned by this cell after an accepted deletion elsewhere in the document. */
    confirmedTextTransfer?: ObservedTextAppend;
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

interface Composition {
    editor: Editor;
    opening: CompositionOpening;
}

function readMarkdown(editor: Editor): string {
    // @ts-expect-error - tiptap-markdown does not augment the core storage type.
    return editor.storage.markdown.getMarkdown();
}

function showDraft(editor: Editor, draft: string, userAction?: boolean, protectPlace = false): boolean {
    if (editor.isDestroyed || draft === readMarkdown(editor)) return true;
    const chain = editor.chain()
        .command(({ tr }) => {
            if (userAction !== undefined) closeHistory(tr);
            tr.setMeta('addToHistory', userAction === true);
            return true;
        })
        .setContent(draft, { emitUpdate: false });
    if (protectPlace && editor.isEditable && editor.view.hasFocus()) {
        let unresolved: DocumentNode | undefined;
        chain.command(({ tr }) => {
            const selection = mapForeignMarkdownSelection(editor.state.selection, tr.doc);
            if (selection) tr.setSelection(selection);
            else unresolved = tr.doc;
            return true;
        });
        if (unresolved) {
            const outside = adoptOutsideMarkdownSelection(editor.state.tr, unresolved);
            if (outside.docChanged) {
                closeHistory(outside);
                editor.view.dispatch(outside.setMeta('addToHistory', false).setMeta('preventUpdate', true));
                retireHistory(editor);
            }
            return false;
        }
    }
    chain.run();
    // Keep the established history boundary for an adopted external value.
    if (userAction === false) retireHistory(editor);
    if (userAction === true) editor.view.dispatch(closeHistory(editor.state.tr));
    return true;
}

interface DeferredArrival {
    editor: Editor;
    target: string;
    shown: string;
}

export function RichMarkdownEditor({
    value,
    onChange,
    onHoldText,
    observedAppend: appendedText,
    confirmedTextTransfer,
    valueIsUserAction = false,
    valueBeforeUserAction,
    placeholder = '',
    minHeight = '150px',
    autoFocus = false,
    stickyToolbarTop,
    editable = true,
}: RichMarkdownEditorProps) {
    const observedAppend = confirmedTextTransfer ?? appendedText;
    const { draft, change, takeObserved } = useBufferedText(value, onChange, observedAppend?.after === value ? observedAppend.before : undefined);
    const acceptedTransfer = useRef<ObservedTextAppend | undefined>(undefined);
    const deferredArrival = useRef<DeferredArrival | null>(null);
    const composition = useRef<Composition | null>(null);
    const appliedForeignValue = useRef(valueBeforeUserAction);
    const current = useRef({ draft, value, observedAppend, valueIsUserAction });
    const heldText = useRef<{ settle?: (keep: boolean, chosenWrite?: void | Promise<unknown>) => void } | null>(null);
    const [choice, setChoice] = useState<string | null>(null);
    const editorContainer = useRef<HTMLDivElement>(null);
    const { toolbarRef, scrollProps } = useStickyEditorViewport(stickyToolbarTop);
    const canEdit = editable && choice === null;
    // Observed text is applied by the guarded mirror below. Reconfiguring the editor for each
    // render makes ProseMirror rebuild view props while the browser still owns a composition.
    const initialContent = useRef(value);
    const extensions = useMemo(() => [
        ...richMarkdownExtensions(),
        Placeholder.configure({ placeholder }),
    ], [placeholder]);
    const editorProps = useMemo(() => ({
        ...scrollProps,
        attributes: {
            // Keep the longest word of a table inside its own box on a phone.
            class:
                'prose prose-sm desktop:prose-base dark:prose-invert max-w-none focus:outline-none flex-1 min-h-0 w-full p-3 rounded-b-xl border border-t-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td>p]:my-0 [&_th>p]:my-0',
        },
    }), [scrollProps]);
    const editor = useEditor({
        extensions,
        content: initialContent.current,
        editable: canEdit,
        immediatelyRender: false,
        autofocus: autoFocus ? 'end' : false,
        editorProps,
        onUpdate: ({ editor }) => {
            if (heldText.current !== null || composition.current?.editor === editor || editor.view?.composing) return;
            const typed = readMarkdown(editor);
            if (deferredArrival.current?.editor === editor) {
                deferredArrival.current = null;
                // The displayed opening may now differ from the observed document. Do not send
                // its untouched old text back to autosave along with this keystroke.
                if (typed === current.current.value) {
                    takeObserved();
                    return;
                }
                heldText.current = { settle: onHoldText?.(typed) };
                setChoice(typed);
            } else change(typed);
        },
    });

    useLayoutEffect(() => { current.current = { draft, value, observedAppend, valueIsUserAction }; }, [draft, value, observedAppend, valueIsUserAction]);

    useEffect(() => {
        if (!editor || heldText.current !== null || composition.current?.editor === editor || editor.view?.composing) return;
        const transferred = confirmedTextTransfer && confirmedTextTransfer !== acceptedTransfer.current &&
            confirmedTextTransfer.after === value && draft === value;
        if (transferred) {
            acceptedTransfer.current = confirmedTextTransfer;
            deferredArrival.current = null;
            if (draft === readMarkdown(editor)) retireHistory(editor);
            else showDraft(editor, draft, false);
            return;
        }
        if (draft === value && valueIsUserAction && valueBeforeUserAction && appliedForeignValue.current !== valueBeforeUserAction) {
            appliedForeignValue.current = valueBeforeUserAction;
            deferredArrival.current = null;
            if (valueBeforeUserAction.value !== null) showDraft(editor, valueBeforeUserAction.value, false);
        }
        const ownValue = valueIsUserAction && valueBeforeUserAction?.value !== null;
        // The buffer can still expose the previous arrival in the render where a newer one
        // arrives. It is not a local draft and must not be shown between the two observations.
        if (draft !== value && deferredArrival.current?.editor === editor) return;
        if (draft !== value || ownValue) {
            deferredArrival.current = null;
            showDraft(editor, draft, draft === value ? ownValue : undefined);
            return;
        }
        deferredArrival.current = showDraft(editor, draft, false, true)
            ? null : { editor, shown: readMarkdown(editor), target: draft };
    }, [confirmedTextTransfer, draft, editor, value, valueIsUserAction, valueBeforeUserAction]);

    useEffect(() => {
        if (!editor) return;
        const retryArrival = () => {
            const deferred = deferredArrival.current;
            if (deferred?.editor !== editor) return;
            queueMicrotask(() => {
                if (deferredArrival.current !== deferred || heldText.current || editor.isDestroyed ||
                    composition.current?.editor === editor || editor.view.composing ||
                    current.current.draft !== deferred.target || current.current.value !== deferred.target) return;
                if (showDraft(editor, deferred.target, false, true)) deferredArrival.current = null;
            });
        };
        editor.on('selectionUpdate', retryArrival);
        editor.on('blur', retryArrival);
        return () => {
            editor.off('selectionUpdate', retryArrival);
            editor.off('blur', retryArrival);
            if (deferredArrival.current?.editor === editor) deferredArrival.current = null;
        };
    }, [editor]);

    useLayoutEffect(() => {
        const container = editorContainer.current;
        if (!editor || !container) return;
        // ProseMirror can remove a multi-block selection before marking the view as composing.
        // React dispatches its synthetic composition listeners after the native target handlers.
        const begin = () => {
            const deferred = deferredArrival.current;
            const shown = deferred?.editor === editor ? deferred.shown : undefined;
            composition.current = {
                editor,
                opening: {
                    markdown: readMarkdown(editor),
                    draft: shown ?? current.current.draft,
                    observed: shown ?? current.current.value,
                    append: current.current.observedAppend,
                },
            };
        };
        container.addEventListener('compositionstart', begin, true);
        return () => {
            container.removeEventListener('compositionstart', begin, true);
            if (composition.current?.editor === editor) composition.current = null;
        };
    }, [editor]);

    useEffect(() => {
        // Without `false` Tiptap announces an update, and onUpdate would send the words still drawn back as a user
        // edit — over a value just given (a draft restored as the editor is released was wiped live, 2026-10-28).
        if (editor && editor.isEditable !== canEdit) editor.setEditable(canEdit, false);
    }, [editor, canEdit]);

    if (!editor) {
        return null;
    }

    const choose = (keepTyped: boolean) => {
        if (choice === null || current.current.value !== value) return;
        const settle = heldText.current?.settle;
        heldText.current = null;
        setChoice(null);
        if (keepTyped) {
            // Undo of the decision returns to the adopted version, not the old editor frame.
            showDraft(editor, value, false);
            showDraft(editor, choice, true);
            const chosenWrite = change(choice);
            settle?.(true, chosenWrite);
        } else {
            settle?.(false);
            takeObserved();
            showDraft(editor, value, current.current.valueIsUserAction);
        }
    };

    return (
        <div className="flex flex-col w-full flex-1 rounded-xl shadow-sm" style={{ minHeight }}>
            <RichMarkdownToolbar editor={editor} stickyTop={stickyToolbarTop} elementRef={toolbarRef} disabled={!canEdit} />
            <div ref={editorContainer} className="flex-1 cursor-text flex flex-col">
                <EditorContent
                    editor={editor}
                    className="w-full flex-1 flex flex-col"
                    style={{ minHeight: 'inherit' }}
                    onCompositionEnd={event => {
                        const active = composition.current;
                        if (active?.editor !== editor) return;
                        const cancelled = event.data === '';
                        // ProseMirror's native end handler queues the final DOM read before this
                        // bubbled event. It may finish without a new update if the candidate is unchanged.
                        queueMicrotask(() => {
                            if (composition.current !== active || editor.isDestroyed) return;
                            composition.current = null;
                            const confirmed = cancelled ? active.opening.markdown : readMarkdown(editor);
                            const result = decideComposition(active.opening, current.current.value, confirmed, current.current.observedAppend);
                            deferredArrival.current = null;
                            switch (result.kind) {
                                case 'restore':
                                    if (cancelled) showDraft(editor, result.text);
                                    break;
                                case 'adopt':
                                    takeObserved();
                                    if (!showDraft(editor, result.text, current.current.valueIsUserAction, !current.current.valueIsUserAction)) {
                                        deferredArrival.current = { editor, shown: readMarkdown(editor), target: result.text };
                                    }
                                    break;
                                case 'publish': {
                                    const currentValue = current.current;
                                    const merged = result.text !== confirmed && result.text !== currentValue.value;
                                    if (merged && !currentValue.valueIsUserAction) {
                                        // Undo can remove the newly composed words while keeping the foreign append.
                                        showDraft(editor, currentValue.value, false);
                                        showDraft(editor, result.text, true);
                                    }
                                    change(result.text);
                                    break;
                                }
                                case 'compare':
                                    showDraft(editor, result.text);
                                    heldText.current = { settle: onHoldText?.(result.text) };
                                    setChoice(result.text);
                                    break;
                            }
                        });
                    }}
                    onClick={event => {
                        syncClickedTextSelection(editor.view, event.nativeEvent);
                        editor.chain().focus().run();
                    }}
                />
            </div>
            {choice !== null && (
                <RichMarkdownCompositionChoice typed={choice} updated={value} onChoose={choose} />
            )}
        </div>
    );
}
