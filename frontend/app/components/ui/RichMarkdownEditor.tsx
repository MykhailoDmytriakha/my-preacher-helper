import Placeholder from '@tiptap/extension-placeholder';
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { applyForeignContent, canonicalForeignTarget } from './foreignContent';
import { retireHistory } from './foreignHistory';
import { mapForeignMarkdownSelection } from './foreignMarkdownSelection';
import { appendToComposition, decideComposition, rebaseParagraphAppend, type CompositionOpening, type ObservedTextAppend } from './richMarkdownComposition';
import { RichMarkdownCompositionChoice } from './RichMarkdownCompositionChoice';
import { richMarkdownExtensions } from './richMarkdownExtensions';
import { RichMarkdownToolbar } from './RichMarkdownToolbar';
import { syncClickedTextSelection } from './syncClickedTextSelection';
import { useBufferedText } from './useBufferedText';
import { useStickyEditorViewport } from './useStickyEditorViewport';

import type { Node as DocumentNode } from '@tiptap/pm/model';

interface RichMarkdownEditorProps {
    value: string;
    onChange: (value: string, editOpening?: string) => void | Promise<unknown>;
    /** Include the displayed pre-edit text for callers that track save ancestry. */
    includeEditOpening?: boolean;
    /** Let the document keep a confirmed alternative before the user chooses a version. */
    onHoldText?: (typed: string) => ((keep: boolean, chosenWrite?: void | Promise<unknown>) => void) | undefined;
    /** A proven append from a document action, including an append to an empty draft. */
    observedAppend?: ObservedTextAppend;
    /** Read an authored append before its controlled value reaches this view. */
    readAppend?: () => ObservedTextAppend | undefined;
    /** A newer accepted body to use when Undo only cancels unsubmitted text. */
    readAcceptedAfterUndo?: (restored: string, opening: string) => string | undefined;
    /** Text now owned by this cell after an accepted deletion elsewhere in the document. */
    confirmedTextTransfer?: ObservedTextAppend;
    /** Witness the applied document once, before its first subsequent edit. */
    onEditAfterForeignValue?: (value: string) => void;
    /** Opt in only when the supplied value is this editor user's requested edit. */
    valueIsUserAction?: boolean;
    /** A foreign value coalesced with the own action; apply its boundary first. */
    valueBeforeUserAction?: ForeignValue;
    placeholder?: string;
    minHeight?: string;
    autoFocus?: boolean;
    /** Distance from the top of the window to keep the toolbar at while scrolling. */
    stickyToolbarTop?: number;
    /** False holds the text still — a save being accepted must not take later keystrokes away with it. */
    editable?: boolean;
}

interface ForeignValue {
    value: string | null;
}

interface Composition {
    editor: Editor;
    opening: CompositionOpening;
    pendingForeign?: ForeignValue;
}

function readMarkdown(editor: Editor): string {
    // @ts-expect-error - tiptap-markdown does not augment the core storage type.
    return editor.storage.markdown.getMarkdown();
}

function readOpeningMarkdown(editor: Editor, doc: DocumentNode): string {
    // @ts-expect-error - tiptap-markdown does not augment the core storage type.
    return editor.storage.markdown.serializer.serialize(doc);
}

function showDraft(editor: Editor, draft: string, userAction?: boolean, keepSelection = false): void {
    if (editor.isDestroyed || draft === readMarkdown(editor)) return;
    const chain = editor.chain()
        .command(({ tr }) => {
            if (userAction !== undefined) closeHistory(tr);
            tr.setMeta('addToHistory', userAction === true);
            return true;
        })
        .setContent(draft, { emitUpdate: false });
    if (keepSelection) {
        const { selection, storedMarks } = editor.state;
        chain.command(({ tr }) => {
            const mapped = mapForeignMarkdownSelection(selection, tr.doc);
            if (mapped) tr.setSelection(mapped).setStoredMarks(storedMarks);
            return true;
        });
    }
    chain.run();
    if (userAction === false) retireHistory(editor);
    if (userAction === true) editor.view.dispatch(closeHistory(editor.state.tr));
}

function showOwnTextWithBoundary(editor: Editor, ownText: string, foreign: ForeignValue) {
    if (foreign.value === null) {
        showDraft(editor, ownText, false);
        return;
    }
    if (foreign.value === readMarkdown(editor)) retireHistory(editor);
    else showDraft(editor, foreign.value, false);
    showDraft(editor, ownText, true);
}

interface DeferredArrival {
    editor: Editor;
    target: string;
    shown: string;
}

export function RichMarkdownEditor({
    value,
    onChange,
    includeEditOpening = false,
    onHoldText,
    observedAppend: appendedText,
    readAppend,
    readAcceptedAfterUndo,
    confirmedTextTransfer,
    onEditAfterForeignValue,
    valueIsUserAction = false,
    valueBeforeUserAction,
    placeholder = '',
    minHeight = '150px',
    autoFocus = false,
    stickyToolbarTop,
    editable = true,
}: RichMarkdownEditorProps) {
    const observedAppend = confirmedTextTransfer ?? appendedText;
    const { draft, change, getPending, takeObserved } = useBufferedText(value, onChange, observedAppend?.after === value ? observedAppend.before : undefined);
    const foreignEditMark = useRef<string | null>(valueIsUserAction ? null : value);
    const lastEmittedText = useRef<string | null>(null);
    const adoptForeign = useCallback((editor: Editor, text: string, protectPlace = false) => {
        if (editor.isDestroyed) return true;
        const replaced = text !== readMarkdown(editor);
        if (replaced && applyForeignContent(editor, text, protectPlace).deferred) return false;
        if (replaced || text !== lastEmittedText.current) foreignEditMark.current = text;
        if (replaced) lastEmittedText.current = null;
        return true;
    }, []);
    const publish = (text: string, editOpening?: string) => {
        const opening = foreignEditMark.current;
        foreignEditMark.current = null;
        if (opening !== null) onEditAfterForeignValue?.(opening);
        lastEmittedText.current = text;
        return change(text, editOpening);
    };
    const acceptedTransfer = useRef<ObservedTextAppend | undefined>(undefined);
    const deferredArrival = useRef<DeferredArrival | null>(null);
    const composition = useRef<Composition | null>(null);
    const appliedForeignValue = useRef(valueBeforeUserAction);
    const current = useRef({ draft, value, observedAppend, valueIsUserAction, valueBeforeUserAction });
    const heldText = useRef<{
        settle?: (keep: boolean, chosenWrite?: void | Promise<unknown>) => void;
        pendingOwn?: { value: string; foreign?: ForeignValue };
    } | null>(null);
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
        onUpdate: ({ editor, transaction }) => {
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
                return;
            }
            const editOpening = includeEditOpening ? readOpeningMarkdown(editor, transaction.before) : undefined;
            const append = readAppend?.();
            // When dictation and a native key share a task, the page can already
            // hold the append while the key still edits the old ProseMirror tree.
            if (append && canonicalForeignTarget(editor, append.before).eq(transaction.before)) {
                const accepted = isHistoryTransaction(transaction) && editOpening !== undefined
                    ? readAcceptedAfterUndo?.(typed, editOpening) : undefined;
                const merged = rebaseParagraphAppend(append, accepted ?? typed);
                if (merged !== undefined && merged !== typed) {
                    if (accepted !== undefined) adoptForeign(editor, accepted);
                    showDraft(editor, merged, true, true);
                    publish(merged, accepted ?? editOpening);
                    return;
                }
            }
            publish(typed, editOpening);
        },
    });

    useLayoutEffect(() => {
        const active = composition.current;
        if (active && active.editor === editor) {
            // React can commit a foreign value while ProseMirror is still composing the old one.
            if (!valueIsUserAction && value !== current.current.value) active.pendingForeign = { value };
            if (valueIsUserAction && valueBeforeUserAction && valueBeforeUserAction !== appliedForeignValue.current) {
                active.pendingForeign = valueBeforeUserAction;
            }
        }
        current.current = { draft, value, observedAppend, valueIsUserAction, valueBeforeUserAction };
    }, [draft, editor, value, observedAppend, valueIsUserAction, valueBeforeUserAction]);

    useEffect(() => {
        if (!editor || getPending() !== null || heldText.current !== null
            || composition.current?.editor === editor || editor.view?.composing) return;
        const transferred = confirmedTextTransfer && confirmedTextTransfer !== acceptedTransfer.current &&
            confirmedTextTransfer.after === value && draft === value;
        if (transferred) {
            acceptedTransfer.current = confirmedTextTransfer;
            foreignEditMark.current = null;
            deferredArrival.current = null;
            if (draft === readMarkdown(editor)) retireHistory(editor);
            else showDraft(editor, draft, false);
            return;
        }
        const deferred = deferredArrival.current;
        const foreign = valueBeforeUserAction !== appliedForeignValue.current ? valueBeforeUserAction : undefined;
        const boundary = foreign ?? (deferred?.editor === editor ? { value: deferred.target } : undefined);
        if (draft === value && valueIsUserAction && boundary) {
            appliedForeignValue.current = valueBeforeUserAction;
            foreignEditMark.current = null;
            deferredArrival.current = null;
            showOwnTextWithBoundary(editor, draft, boundary);
            return;
        }
        const ownValue = valueIsUserAction && valueBeforeUserAction?.value !== null;
        // The buffer can still expose the previous arrival in the render where a newer one
        // arrives. It is not a local draft and must not be shown between the two observations.
        if (draft !== value && deferredArrival.current?.editor === editor) return;
        if (draft !== value || ownValue) {
            deferredArrival.current = null;
            if (ownValue) foreignEditMark.current = null;
            showDraft(editor, draft, draft === value ? ownValue : undefined);
            return;
        }
        deferredArrival.current = adoptForeign(editor, draft, true)
            ? null : { editor, shown: readMarkdown(editor), target: draft };
    }, [adoptForeign, confirmedTextTransfer, draft, editor, getPending, value, valueIsUserAction, valueBeforeUserAction]);

    useEffect(() => {
        if (!editor) return;
        const retryArrival = () => {
            const deferred = deferredArrival.current;
            if (deferred?.editor !== editor) return;
            queueMicrotask(() => {
                if (deferredArrival.current !== deferred || heldText.current || getPending() !== null || editor.isDestroyed ||
                    composition.current?.editor === editor || editor.view.composing ||
                    current.current.draft !== deferred.target || current.current.value !== deferred.target) return;
                if (adoptForeign(editor, deferred.target, true)) deferredArrival.current = null;
            });
        };
        editor.on('selectionUpdate', retryArrival);
        editor.on('blur', retryArrival);
        return () => {
            editor.off('selectionUpdate', retryArrival);
            editor.off('blur', retryArrival);
            if (deferredArrival.current?.editor === editor) deferredArrival.current = null;
        };
    }, [adoptForeign, editor, getPending]);

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
                pendingForeign: deferred?.editor === editor ? { value: deferred.target } : undefined,
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
        const held = heldText.current;
        const settle = held?.settle;
        heldText.current = null;
        setChoice(null);
        if (keepTyped) {
            // Undo of the decision returns to the adopted version, not the old editor frame.
            adoptForeign(editor, value);
            showDraft(editor, choice, true);
            const chosenWrite = publish(choice);
            settle?.(true, chosenWrite);
        } else {
            settle?.(false);
            takeObserved();
            const foreign = current.current.valueBeforeUserAction;
            const pendingOwn = held?.pendingOwn?.value === value ? held.pendingOwn : undefined;
            const boundary = foreign && foreign !== appliedForeignValue.current && current.current.valueIsUserAction
                ? foreign : pendingOwn?.foreign;
            if (boundary) {
                if (boundary === foreign) appliedForeignValue.current = boundary;
                foreignEditMark.current = null;
                showOwnTextWithBoundary(editor, value, boundary);
            } else if (pendingOwn) {
                foreignEditMark.current = null;
                showDraft(editor, value, true);
            } else adoptForeign(editor, value);
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
                            const update = current.current;
                            // This can run before the transcription's controlled value reaches React.
                            const ownAppend = active.pendingForeign ? undefined
                                : appendToComposition(active.opening.markdown, update.value, confirmed, readAppend?.());
                            if (ownAppend !== undefined) {
                                deferredArrival.current = null;
                                showDraft(editor, ownAppend, true, true);
                                publish(ownAppend, active.opening.markdown);
                                return;
                            }
                            const result = decideComposition(active.opening, update.value, confirmed, update.observedAppend);
                            const boundary = update.valueIsUserAction ? active.pendingForeign : undefined;
                            const adoptOwn = () => {
                                if (!boundary) return;
                                if (boundary === update.valueBeforeUserAction) appliedForeignValue.current = boundary;
                                foreignEditMark.current = null;
                                showOwnTextWithBoundary(editor, update.value, boundary);
                            };
                            deferredArrival.current = null;
                            switch (result.kind) {
                                case 'restore':
                                    if (boundary) {
                                        takeObserved();
                                        adoptOwn();
                                    } else if (cancelled) showDraft(editor, result.text);
                                    break;
                                case 'adopt':
                                    takeObserved();
                                    if (boundary) adoptOwn();
                                    else if (update.valueIsUserAction) {
                                        foreignEditMark.current = null;
                                        showDraft(editor, result.text, true);
                                    } else if (!adoptForeign(editor, result.text, true)) {
                                        deferredArrival.current = { editor, shown: readMarkdown(editor), target: result.text };
                                    }
                                    break;
                                case 'publish': {
                                    const merged = result.text !== confirmed && result.text !== update.value;
                                    if (boundary) {
                                        adoptOwn();
                                        showDraft(editor, result.text, true);
                                    } else if (merged && !update.valueIsUserAction) {
                                        // Undo can remove the newly composed words while keeping the foreign append.
                                        adoptForeign(editor, update.value);
                                        showDraft(editor, result.text, true);
                                    }
                                    publish(result.text);
                                    break;
                                }
                                case 'compare':
                                    showDraft(editor, result.text);
                                    heldText.current = {
                                        settle: onHoldText?.(result.text),
                                        pendingOwn: update.valueIsUserAction ? { value: update.value, foreign: boundary } : undefined,
                                    };
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
