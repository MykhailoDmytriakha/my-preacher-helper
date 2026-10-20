import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from 'sonner';

import { useStructureWriter, type StructureWriteOptions } from "@/components/sermon/structureWriter";
import { useResolvedUid } from "@/hooks/useResolvedUid";
import { Sermon, Item, Thought, ThoughtsBySection } from "@/models/models";
import { newClientId } from "@/utils/clientId";
import { debugLog } from "@/utils/debugMode";
import { refusedWrite, skippedWrite, type WriteOperation } from '@/utils/recoverableWrite';
import { insertThoughtIdInStructure, replaceThoughtIdInStructure, resolveSectionFromOutline } from "@/utils/thoughtOrdering";
import { recoveryText, showRecoverableWriteFailure, writeFailureTranslationKey } from '@/utils/writeRecovery';
import { useTranslation } from "@locales/useTranslation";
import { auth } from "@services/firebaseAuth.service";

import { buildStructureFromContainers, buildItemForUI, findOutlinePoint } from "../utils/structure";

type StructureSection = 'introduction' | 'main' | 'conclusion';

interface UseSermonActionsProps {
    sermon: Sermon | null;
    setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
    containers: Record<string, Item[]>;
    setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
    containersRef: React.MutableRefObject<Record<string, Item[]>>;
    allowedTags: { name: string; color: string }[];
    debouncedSaveThought: (sermonId: string, thought: Thought, baseThought: Thought | null) => void;
    debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null, options?: StructureWriteOptions) => void;
    onPlacementCaptured?: (thoughtId: string, containers: Record<string, Item[]>) => void;
    retryThoughtSave?: (thoughtId: string) => Promise<void>;
}

const structureFromContainers = (containers: Record<string, Item[]>): ThoughtsBySection => ({
    introduction: (containers.introduction || []).map((it) => it.id),
    main: (containers.main || []).map((it) => it.id),
    conclusion: (containers.conclusion || []).map((it) => it.id),
    ambiguous: (containers.ambiguous || []).map((it) => it.id),
});

export function useSermonActions({
    sermon,
    setSermon,
    containers,
    setContainers,
    containersRef,
    allowedTags,
    retryThoughtSave,
    onPlacementCaptured,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
    const writer = useStructureWriter();
    const { uid } = useResolvedUid();
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
    const sermonRef = useRef(sermon);
    const editingItemRef = useRef<Item | null>(null);
    const rejectedEditorQueueRef = useRef<Array<{ item: Item; section: string | null }>>([]);
    const recoveryCreatesRef = useRef<Record<string, { id: string; date: string; captured?: Thought }>>({});
    const latestThoughtDraftsRef = useRef<Record<string, Thought>>({});
    const thoughtUpdateVersionRef = useRef<Record<string, number>>({});

    useEffect(() => {
        sermonRef.current = sermon;
    }, [sermon]);

    useEffect(() => {
        latestThoughtDraftsRef.current = {};
        thoughtUpdateVersionRef.current = {};
    }, [sermon?.id]);

    const updateItemInContainers = useCallback((itemId: string, updater: (item: Item) => Item) => {
        setContainers((prev) => {
            const next = { ...prev };
            let updated = false;

            Object.keys(next).forEach((key) => {
                const items = next[key] || [];
                const index = items.findIndex((item) => item.id === itemId);
                if (index === -1) return;
                const updatedItems = [...items];
                updatedItems[index] = updater(items[index]);
                next[key] = updatedItems;
                updated = true;
            });

            if (updated) {
                containersRef.current = next;
                return next;
            }

            return prev;
        });
    }, [containersRef, setContainers]);

    const handleEdit = useCallback((item: Item) => {
        editingItemRef.current = item;
        setEditingItem(item);
    }, []);

    const handleCloseEdit = useCallback(() => {
        const closingItem = editingItemRef.current;
        if (closingItem) delete recoveryCreatesRef.current[closingItem.id];
        const nextRecovery = rejectedEditorQueueRef.current.shift() ?? null;
        editingItemRef.current = nextRecovery?.item ?? null;
        setEditingItem(nextRecovery?.item ?? null);
        setAddingThoughtToSection(nextRecovery?.section ?? null);
    }, []);

    /**
     * Bring a refused edit back to the person AND say why it came back.
     *
     * Reopening an editor silently left them guessing: the words reappeared with no
     * explanation, and a refused edit looked like a glitch rather than a refusal. The
     * editor that was open cannot speak for this write — it has already closed — so the
     * message belongs here, next to the text being restored. Said once: the modal's own
     * late toast was removed for exactly this reason.
     */
    /**
     * WHOSE screen this is, answered from the LIVE source at report time. A ref cannot
     * answer it: refs stop updating at unmount, which is precisely the case this guards
     * (submit → leave → sign out → someone else signs in). `auth.currentUser` is a
     * module singleton and stays current afterwards.
     */
    const authorUidRef = useRef(uid);
    if (uid && !authorUidRef.current) authorUidRef.current = uid;
    const stillTheSamePerson = () =>
        Boolean(authorUidRef.current) && auth.currentUser?.uid === authorUidRef.current;

    const queueRejectedEditor = useCallback((
        item: Item,
        section: string | null,
        error?: unknown,
        /** The editor that STARTED this write, when it differs from the recovery item. */
        originEditorId?: string,
    ) => {
        /**
         * If the editor for THIS item is still open, it is already showing the refusal
         * inline and holding the text — one refusal, one reporter. This path speaks only
         * when the editor is gone (or shows a different item), which is exactly when a
         * silent reopen would read as a glitch.
         */
        // Never to a different account: this callback outlives the session that made
        // the write, and a message created now would escape the sign-out sweep.
        if (!stillTheSamePerson()) return;
        /**
         * IS AN OPEN EDITOR ALREADY HOLDING THIS TEXT?
         *
         * An EARLY refusal leaves the editor open with the words in it, so it explains
         * itself and nothing more is needed — not a message, and NOT a queue entry.
         * Queueing anyway was worse than the duplicate it replaced: closing the editor
         * dequeued that stale copy instead of closing, so the person could not get out
         * of the editor and a successful retry looked like it had failed.
         *
         * A create is matched through `recoveryCreatesRef`, because its recovery entry
         * carries a different id than the draft on screen.
         */
        const openEditorId = editingItemRef.current?.id;
        /**
         * A CREATE recovery carries a fresh id (`temp-recovery-…`), while the editor on
         * screen still shows the draft id it was opened with (`temp-…`) — so comparing
         * those two could never match, and the refusal was queued even though the editor
         * was holding the text. The write itself is the only thing that knows both, so
         * it passes its origin along.
         */
        const editorAlreadyExplains =
            openEditorId !== undefined &&
            (openEditorId === item.id || openEditorId === originEditorId);
        if (editorAlreadyExplains) return;

        showRecoverableWriteFailure({
            error,
            title: t(writeFailureTranslationKey(error, 'errors.failedToSaveThought')),
            description: recoveryText([
                item.content,
                (item.customTagNames ?? []).map((tag) => tag.name).join(', '),
            ]),
            retryLabel: t('buttons.retry'),
            // The restored editor IS the retry: re-submitting from it repeats the write.
            retry: () => undefined,
            copyLabel: t('freshness.copyTextAction'),
            id: `write-recovery:structure-thought:${item.id}`,
        });
        if (editingItemRef.current) {
            rejectedEditorQueueRef.current.push({ item, section });
            return;
        }
        editingItemRef.current = item;
        setEditingItem(item);
        setAddingThoughtToSection(section);
    }, [t]);

    const handleAddThoughtToSection = useCallback((sectionId: string, outlinePointId?: string) => {
        debugLog('Structure: add thought requested', { sectionId, outlinePointId });
        const emptyThought: Item = {
            id: `temp-${Date.now()}`,
            content: '',
            requiredTags: [],
            customTagNames: [],
            outlinePointId,
        };
        editingItemRef.current = emptyThought;
        setEditingItem(emptyThought);
        setAddingThoughtToSection(sectionId);
    }, []);

    // CREATE — optimistic + idempotent by client id (mirrors useGroups/usePrayer):
    // the thought id is minted up front (newClientId) so the container Item, the
    // sermon.thoughts entry, the structure id and the persisted doc all share ONE
    // stable id. No "local-" placeholder ever reaches the structure, so the
    // structure can never reference a non-existent thought (#13). The engine owns
    // device capture and later delivery; a capture refusal keeps the editor open.
    const handleCreateNewThought = useCallback((
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | null | undefined,
        subPointId?: string | null,
    ): WriteOperation => {
        const currentSermon = sermonRef.current;
        if (!currentSermon) return skippedWrite();
        const section = addingThoughtToSection;
        if (!section || !['introduction', 'main', 'conclusion'].includes(section)) {
            debugLog('Structure: handleCreateNewThought aborted - invalid section', { section });
            throw new Error('Thought section is not available');
        }
        const sectionId = section as StructureSection;

        const outlineSection = resolveSectionFromOutline(currentSermon, outlinePointId ?? null);
        const finalOutlinePointId = outlineSection && outlineSection !== sectionId ? undefined : (outlinePointId ?? undefined);
        const finalSubPointId = finalOutlinePointId ? (subPointId ?? null) : null;

        const editorId = editingItem?.id;
        const recovery = editorId ? recoveryCreatesRef.current[editorId] : undefined;
        const newId = recovery?.id || newClientId();
        // A rendered row may lag a successful capture from this very editor.
        const existingDraft = recovery?.captured ?? currentSermon.thoughts.find(thought => thought.id === newId);
        const newThought: Thought = {
            ...existingDraft,
            id: newId,
            text: updatedText,
            tags: updatedTags,
            outlinePointId: finalOutlinePointId,
            subPointId: finalSubPointId ?? undefined,
            date: recovery?.date ?? existingDraft?.date ?? new Date().toISOString(),
        };
        // A retry continues this creation, even if refused capture left its RAM draft.
        if (editorId) recoveryCreatesRef.current[editorId] = { id: newId, date: newThought.date, captured: recovery?.captured };
        const nextThoughts = [...currentSermon.thoughts.filter(thought => thought.id !== newId), newThought];
        const prevContainers = containersRef.current;
        const prevSermon = sermonRef.current;

        const outlinePoint = findOutlinePoint(finalOutlinePointId, currentSermon);
        const newItem = buildItemForUI({
            id: newId,
            text: updatedText,
            tags: updatedTags,
            allowedTags,
            outlinePointId: finalOutlinePointId,
            subPointId: finalSubPointId,
            outlinePoint,
        });

        // Optimistic: append the real item to its section, grouped after the last
        // item that shares its outline point (matches prior pending-insert order).
        setContainers((prev) => {
            const next = { ...prev };
            const items = (next[sectionId] ?? []).filter(item => item.id !== newId);
            let insertAt = items.length;
            if (finalOutlinePointId) {
                let lastIndex = -1;
                items.forEach((existing, index) => {
                    if (existing.outlinePointId === finalOutlinePointId) lastIndex = index;
                });
                if (lastIndex !== -1) insertAt = lastIndex + 1;
            }
            items.splice(insertAt, 0, newItem);
            next[sectionId] = items;
            containersRef.current = next;
            return next;
        });

        const optimisticStructure = insertThoughtIdInStructure({
            structure: buildStructureFromContainers(containersRef.current),
            section: sectionId,
            thoughtId: newId,
            outlinePointId: finalOutlinePointId,
            thoughtsById: new Map(nextThoughts.map((th) => [th.id, th])),
            thoughts: nextThoughts,
            outline: currentSermon.outline,
        });

        setSermon((prev) => prev ? {
            ...prev,
            thoughts: [...prev.thoughts.filter(thought => thought.id !== newId), newThought],
            structure: optimisticStructure,
            thoughtsBySection: optimisticStructure,
        } : null);

        const persistence = (async () => {
            try {
                const addedThought = existingDraft
                    ? await writer.updateThought(currentSermon.id, newThought, existingDraft)
                    : await writer.createManualThought(currentSermon.id, newThought, sectionId);
                // The next structure capture may refuse before the board catches up.
                // Retain this actual capture result as the retry's baseline.
                if (editorId) recoveryCreatesRef.current[editorId] = {
                    id: addedThought.id, date: addedThought.date, captured: addedThought,
                };

                // Writers normally keep the caller's ID. Reconcile an alternate ID
                // across cards, thoughts and placement before the follow-up capture,
                // so no structure can refer to the previous identity.
                if (addedThought.id !== newId) {
                    updateItemInContainers(newId, (item) => ({ ...item, id: addedThought.id }));
                    setSermon((prev) => {
                        if (!prev) return null;
                        const nextStructure = replaceThoughtIdInStructure({
                            structure: prev.structure,
                            fromThoughtId: newId,
                            toThoughtId: addedThought.id,
                        });
                        return {
                            ...prev,
                            thoughts: prev.thoughts.map((th) => th.id === newId ? addedThought : th),
                            structure: nextStructure,
                            thoughtsBySection: nextStructure,
                        };
                    });
                } else {
                    setSermon((prev) => prev ? {
                        ...prev,
                        thoughts: prev.thoughts.map((th) => th.id === newId ? addedThought : th),
                    } : null);
                }

                const persistStructure = buildStructureFromContainers(containersRef.current);
                await writer.updateStructure(currentSermon.id, persistStructure, currentSermon.structure, { thoughtIds: [addedThought.id] });
                onPlacementCaptured?.(addedThought.id, containersRef.current);
            } catch (error) {
                console.error("Error adding thought:", error);
                // Roll back the optimistic container + sermon writes.
                setContainers(prevContainers);
                containersRef.current = prevContainers;
                setSermon(() => prevSermon);
                const recoveryEditorId = `temp-recovery-${newId}`;
                recoveryCreatesRef.current[recoveryEditorId] = {
                    ...(editorId ? recoveryCreatesRef.current[editorId] : undefined),
                    id: newId, date: newThought.date,
                };
                queueRejectedEditor(
                    { ...newItem, id: recoveryEditorId },
                    sectionId,
                    error,
                    // The draft the person is looking at, so an open editor is recognised.
                    editingItem?.id,
                );
                throw error;
            }
        })();

        return persistence;
    }, [addingThoughtToSection, allowedTags, containersRef, editingItem, queueRejectedEditor, setContainers, setSermon, updateItemInContainers, writer, onPlacementCaptured]);

    // UPDATE — optimistic + version-guarded (a newer edit must win over an older
    // in-flight save). A terminal failure rolls back and restores the editor.
    const handleUpdateExistingThought = useCallback((
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | null | undefined,
        subPointId?: string | null,
    ): WriteOperation => {
        const currentSermon = sermonRef.current;
        if (!currentSermon || !editingItem) throw new Error('Thought editor is not available');

        const existingThought = currentSermon.thoughts.find((thought) => thought.id === editingItem.id);
        if (!existingThought) throw new Error('Thought is not available');

        const outlineChanged = outlinePointId !== (editingItem.outlinePointId ?? null);
        const updatedItem: Thought = {
            ...existingThought,
            text: updatedText,
            tags: [...(editingItem.requiredTags || []), ...updatedTags],
            outlinePointId,
            subPointId: subPointId !== undefined ? subPointId : (outlineChanged ? null : editingItem.subPointId ?? null),
        };
        const outlinePoint = findOutlinePoint(outlinePointId, currentSermon);
        const nextVersion = (thoughtUpdateVersionRef.current[updatedItem.id] ?? 0) + 1;
        latestThoughtDraftsRef.current[updatedItem.id] = updatedItem;
        thoughtUpdateVersionRef.current[updatedItem.id] = nextVersion;

        // Snapshots for a faithful rollback (restores ALL container fields —
        // content, tags, outline — not just a subset).
        const prevContainers = containersRef.current;

        setSermon((prev) => prev ? {
            ...prev,
            thoughts: prev.thoughts.map((thought) =>
                thought.id === updatedItem.id ? updatedItem : thought
            ),
        } : null);

        updateItemInContainers(updatedItem.id, (item) => ({
            ...item,
            content: updatedText,
            customTagNames: updatedTags.map((tagName) => ({
                name: tagName,
                color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
            })),
            outlinePointId,
            outlinePoint,
            subPointId: updatedItem.subPointId,
        }));

        const persistence = (async () => {
            try {
                // `existingThought` is what this screen holds as stored, so only the
                // fields the person actually edited in the modal are written — the rest
                // keeps whatever is on the server, including a text rewritten elsewhere.
                const updatedThought = await writer.updateThought(currentSermon.id, updatedItem, existingThought);
                if (thoughtUpdateVersionRef.current[updatedItem.id] !== nextVersion) {
                    return;
                }

                const latestOutlinePoint = findOutlinePoint(
                    updatedThought.outlinePointId ?? undefined,
                    sermonRef.current ?? currentSermon
                );

                setSermon((prev) => prev ? {
                    ...prev,
                    thoughts: prev.thoughts.map((thought) =>
                        thought.id === updatedThought.id ? updatedThought : thought
                    ),
                } : null);

                updateItemInContainers(updatedThought.id, (item) => ({
                    ...item,
                    content: updatedThought.text,
                    customTagNames: updatedThought.tags
                        .filter((tagName) => !item.requiredTags?.includes(tagName))
                        .map((tagName) => ({
                            name: tagName,
                            color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
                        })),
                    outlinePointId: updatedThought.outlinePointId,
                    outlinePoint: latestOutlinePoint,
                    subPointId: updatedThought.subPointId ?? null,
                }));

                delete latestThoughtDraftsRef.current[updatedItem.id];
                delete thoughtUpdateVersionRef.current[updatedItem.id];
            } catch (error) {
                if (thoughtUpdateVersionRef.current[updatedItem.id] !== nextVersion) {
                    return;
                }
                console.error("Error updating thought:", error);
                // Roll the thought back to its pre-edit value in cache + restore the
                // full pre-edit container snapshot (tags/outline included).
                setSermon((prev) => prev ? {
                    ...prev,
                    thoughts: prev.thoughts.map((thought) =>
                        thought.id === existingThought.id ? existingThought : thought
                    ),
                } : null);
                setContainers(prevContainers);
                containersRef.current = prevContainers;
                const recoverySection = Object.keys(prevContainers).find((section) =>
                    prevContainers[section]?.some((item) => item.id === updatedItem.id)
                ) ?? null;
                queueRejectedEditor({
                    ...editingItem,
                    content: updatedText,
                    customTagNames: updatedTags.map((tagName) => ({
                        name: tagName,
                        color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
                    })),
                    outlinePointId,
                    outlinePoint,
                    subPointId: updatedItem.subPointId,
                }, recoverySection, error);
                throw error;
            }
        })();

        // Connectivity does not prove capture. The same engine promise owns both paths.
        return persistence;
    }, [allowedTags, containersRef, editingItem, queueRejectedEditor, setContainers, setSermon, updateItemInContainers, writer]);

    const handleDeleteThought = useCallback((thoughtId: string): WriteOperation => {
        const currentSermon = sermonRef.current;
        const thoughtToDelete = currentSermon?.thoughts.find((thought) => thought.id === thoughtId);
        if (!currentSermon || !thoughtToDelete) return skippedWrite();

        const prevContainers = containersRef.current;
        const prevSermon = sermonRef.current;

        const newContainers = Object.keys(containersRef.current).reduce((acc, key) => {
            acc[key] = (containersRef.current[key] || []).filter((item) => item.id !== thoughtId);
            return acc;
        }, {} as Record<string, Item[]>);
        const newStructure = structureFromContainers(newContainers);

        // Optimistic delete.
        setContainers(newContainers);
        containersRef.current = newContainers;
        setSermon((prev) => prev ? {
            ...prev,
            thoughts: prev.thoughts.filter((thought) => thought.id !== thoughtId),
            structure: newStructure,
            thoughtsBySection: newStructure,
        } : null);

        const persistence = (async () => {
            try {
                await writer.deleteThought(currentSermon.id, thoughtToDelete);
                // Persist the structure rebuilt from the CURRENT containers (post-await),
                // so a DnD reorder made while the delete was in flight is preserved
                // instead of being overwritten by the older pre-await snapshot.
                const persistStructure = structureFromContainers(containersRef.current);
                await writer.updateStructure(currentSermon.id, persistStructure, currentSermon.structure, { thoughtIds: [thoughtId] });
                onPlacementCaptured?.(thoughtId, containersRef.current);
            } catch (error) {
                console.error("Error deleting thought:", error);
                setContainers(prevContainers);
                containersRef.current = prevContainers;
                setSermon(() => prevSermon);
                // The caller owns the visible refusal: either the still-open editor
                // or the explicit deletion action. Do not add a second toast here.
                throw error;
            }
        })();
        return persistence;
    }, [containersRef, setContainers, setSermon, writer, onPlacementCaptured]);

    const handleSaveEdit = useCallback((updatedText: string, updatedTags: string[], outlinePointId?: string | null, subPointId?: string | null): WriteOperation => {
        // The sermon is gone, so nothing takes this text: refuse rather than report a
        // no-op, which would close the editor over words nobody stored.
        if (!sermonRef.current) return refusedWrite('not-found', 'This sermon is no longer available', t('writeRecovery.refused'));

        const trimmedText = updatedText.trim();

        // Save validates its own input; clearing text cannot mean Delete or Cancel.
        if (!trimmedText) throw new Error('Thought text is required');

        debugLog('Structure: handleSaveEdit', {
            editingId: editingItem?.id,
            isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            section: addingThoughtToSection,
            textLength: trimmedText.length,
            tags: updatedTags,
            outlinePointId,
        });

        if (editingItem?.id.startsWith('temp-')) {
            return handleCreateNewThought(trimmedText, updatedTags, outlinePointId, subPointId);
        } else {
            return handleUpdateExistingThought(trimmedText, updatedTags, outlinePointId, subPointId);
        }
    }, [addingThoughtToSection, editingItem, handleCreateNewThought, handleUpdateExistingThought, t]);

    // Retained for the debounced compatibility caller. Explicit thought actions
    // return engine capture; the shared engine owns later delivery and retry.
    const handleRetryPendingThought = useCallback(async (thoughtId: string) => {
        if (retryThoughtSave) {
            await retryThoughtSave(thoughtId);
        }
    }, [retryThoughtSave]);

    const handleMoveToAmbiguous = (itemId: string, fromContainerId: string): WriteOperation => {
        if (!sermon || !['introduction', 'main', 'conclusion'].includes(fromContainerId)) return skippedWrite();
        const sourceItems = containers[fromContainerId] || [];
        const item = sourceItems.find(candidate => candidate.id === itemId);
        const thought = sermon.thoughts.find(candidate => candidate.id === itemId);
        if (!item || !thought) return skippedWrite();
        const previous = containersRef.current;
        const updatedContainers = {
            ...containers,
            [fromContainerId]: sourceItems.filter(candidate => candidate.id !== itemId),
            ambiguous: [...(containers.ambiguous || []), { ...item, outlinePointId: null, subPointId: null, requiredTags: [] }],
        };
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
        const persistence = writer.updateStructure(sermon.id, structureFromContainers(updatedContainers), sermon.structure, {
            thoughtIds: [itemId],
            thoughtUpdates: [{ thought: {
                ...thought, tags: (item.customTagNames || []).map(tag => tag.name), outlinePointId: null, subPointId: null,
            }, baseThought: thought }],
        }).then(() => {
            onPlacementCaptured?.(itemId, containersRef.current);
        }).catch(error => {
            setContainers(previous);
            containersRef.current = previous;
            toast.error(t('errors.failedToSaveStructure'));
            throw error;
        });
        void persistence.catch(() => undefined);
        return persistence;
    };

    return {
        editingItem,
        setEditingItem,
        addingThoughtToSection,
        setAddingThoughtToSection,
        handleEdit,
        handleCloseEdit,
        handleAddThoughtToSection,
        handleSaveEdit,
        handleDeleteThought,
        handleMoveToAmbiguous,
        handleRetryPendingThought,
    };
}
