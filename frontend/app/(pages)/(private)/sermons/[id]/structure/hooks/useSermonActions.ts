import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Sermon, Item, Thought, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought, deleteThought, createManualThought } from "@/services/thought.service";
import { newClientId } from "@/utils/clientId";
import { debugLog } from "@/utils/debugMode";
import { insertThoughtIdInStructure, replaceThoughtIdInStructure, resolveSectionFromOutline } from "@/utils/thoughtOrdering";

import { buildStructureFromContainers, buildItemForUI, findOutlinePoint } from "../utils/structure";

const FAILED_TO_ADD_THOUGHT_KEY = 'errors.failedToAddThought';

type StructureSection = 'introduction' | 'main' | 'conclusion';

interface UseSermonActionsProps {
    sermon: Sermon | null;
    setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
    containers: Record<string, Item[]>;
    setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
    containersRef: React.MutableRefObject<Record<string, Item[]>>;
    allowedTags: { name: string; color: string }[];
    debouncedSaveThought: (sermonId: string, thought: Thought) => void;
    debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection) => void;
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
    debouncedSaveThought,
    debouncedSaveStructure,
    retryThoughtSave,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
    const sermonRef = useRef(sermon);
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
        setEditingItem(item);
    }, []);

    const handleCloseEdit = useCallback(() => {
        setEditingItem(null);
        setAddingThoughtToSection(null);
    }, []);

    const handleAddThoughtToSection = useCallback((sectionId: string, outlinePointId?: string) => {
        debugLog('Structure: add thought requested', { sectionId, outlinePointId });
        const emptyThought: Item = {
            id: `temp-${Date.now()}`,
            content: '',
            requiredTags: [],
            customTagNames: [],
            outlinePointId,
        };
        setEditingItem(emptyThought);
        setAddingThoughtToSection(sectionId);
    }, []);

    // CREATE — optimistic + idempotent by client id (mirrors useGroups/usePrayer):
    // the thought id is minted up front (newClientId) so the container Item, the
    // sermon.thoughts entry, the structure id and the persisted doc all share ONE
    // stable id. No "local-" placeholder ever reaches the structure, so the
    // structure can never reference a non-existent thought (#13). The client-SDK
    // write lands in the native Firestore offline queue; on a real failure we roll
    // containers + sermon back and surface a toast.
    const handleCreateNewThought = useCallback(async (
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | null | undefined,
        subPointId?: string | null,
    ) => {
        const currentSermon = sermonRef.current;
        if (!currentSermon) return;
        const section = addingThoughtToSection;
        if (!section || !['introduction', 'main', 'conclusion'].includes(section)) {
            debugLog('Structure: handleCreateNewThought aborted - invalid section', { section });
            return;
        }
        const sectionId = section as StructureSection;

        const outlineSection = resolveSectionFromOutline(currentSermon, outlinePointId ?? null);
        const finalOutlinePointId = outlineSection && outlineSection !== sectionId ? undefined : (outlinePointId ?? undefined);
        const finalSubPointId = finalOutlinePointId ? (subPointId ?? null) : null;

        const newId = newClientId();
        const newThought: Thought = {
            id: newId,
            text: updatedText,
            tags: updatedTags,
            outlinePointId: finalOutlinePointId,
            subPointId: finalSubPointId ?? undefined,
            date: new Date().toISOString(),
        };

        // Snapshots for rollback
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
            const items = next[sectionId] ? [...next[sectionId]] : [];
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
            thoughtsById: new Map([...currentSermon.thoughts, newThought].map((th) => [th.id, th])),
            thoughts: [...currentSermon.thoughts, newThought],
            outline: currentSermon.outline,
        });

        setSermon((prev) => prev ? {
            ...prev,
            thoughts: [...prev.thoughts, newThought],
            structure: optimisticStructure,
            thoughtsBySection: optimisticStructure,
        } : null);

        // Close the editor immediately — the card is already on screen. The write
        // is fired-and-forgotten so the modal never blocks on the network; offline
        // it parks in the native Firestore queue.
        handleCloseEdit();

        void (async () => {
            try {
                const addedThought = await createManualThought(currentSermon.id, newThought);

                // The client SDK echoes the id (no-op). A server fallback that mints a
                // different id is reconciled here: swap temp->real in the container item,
                // sermon.thoughts AND the cached structure so it never references a
                // non-existent id (#13). The persisted structure is rebuilt from the
                // post-swap containers below, so the DB is always consistent too.
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
                try {
                    await updateStructure(currentSermon.id, persistStructure);
                } catch (structureError) {
                    console.error("Error updating structure after add:", structureError);
                    toast.error(t('errors.failedToSaveStructure'));
                }
            } catch (error) {
                console.error("Error adding thought:", error);
                // Roll back the optimistic container + sermon writes.
                setContainers(prevContainers);
                containersRef.current = prevContainers;
                setSermon(() => prevSermon);
                toast.error(t(FAILED_TO_ADD_THOUGHT_KEY));
            }
        })();
    }, [addingThoughtToSection, allowedTags, containersRef, handleCloseEdit, setContainers, setSermon, t, updateItemInContainers]);

    // UPDATE — optimistic + version-guarded (a newer edit must win over an older
    // in-flight save). Rolls the cache back + toasts on a real failure.
    const handleUpdateExistingThought = useCallback(async (
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | null | undefined,
        subPointId?: string | null,
    ) => {
        const currentSermon = sermonRef.current;
        if (!currentSermon || !editingItem) return;

        const existingThought = currentSermon.thoughts.find((thought) => thought.id === editingItem.id);
        if (!existingThought) return;

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

        // Fire-and-forget so the edit modal closes without waiting on the network.
        void (async () => {
            try {
                const updatedThought = await updateThought(currentSermon.id, updatedItem);
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
                toast.error(t('errors.failedToSaveThought'));
            }
        })();
    }, [allowedTags, containersRef, editingItem, setContainers, setSermon, t, updateItemInContainers]);

    const handleDeleteThought = useCallback(async (thoughtId: string) => {
        const currentSermon = sermonRef.current;
        const thoughtToDelete = currentSermon?.thoughts.find((thought) => thought.id === thoughtId);
        if (!currentSermon || !thoughtToDelete) return;

        // Snapshots for rollback
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

        // Fire-and-forget so the card disappears immediately without blocking on
        // the network.
        void (async () => {
            try {
                await deleteThought(currentSermon.id, thoughtToDelete);
                // Persist the structure rebuilt from the CURRENT containers (post-await),
                // so a DnD reorder made while the delete was in flight is preserved
                // instead of being overwritten by the older pre-await snapshot.
                const persistStructure = structureFromContainers(containersRef.current);
                await updateStructure(currentSermon.id, persistStructure);
                toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");
            } catch (error) {
                console.error("Error deleting thought:", error);
                setContainers(prevContainers);
                containersRef.current = prevContainers;
                setSermon(() => prevSermon);
                toast.error(t('errors.deletingError') || "Failed to delete thought.");
            }
        })();
    }, [containersRef, setContainers, setSermon, t]);

    const handleSaveEdit = useCallback(async (updatedText: string, updatedTags: string[], outlinePointId?: string | null, subPointId?: string | null) => {
        if (!sermonRef.current) return;

        const trimmedText = updatedText.trim();

        // TRIZ+IFR: Empty text means "Cancel" for new thoughts and "Delete" for existing ones.
        if (!trimmedText) {
            debugLog('Structure: empty text in handleSaveEdit - interpreting as cancel/delete', {
                editingId: editingItem?.id,
                isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            });

            if (!editingItem || editingItem.id.startsWith('temp-')) {
                // New, never-persisted thought -> just cancel.
                handleCloseEdit();
                return;
            }

            // Existing thought -> Delete.
            await handleDeleteThought(editingItem.id);
            handleCloseEdit();
            return;
        }

        debugLog('Structure: handleSaveEdit', {
            editingId: editingItem?.id,
            isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            section: addingThoughtToSection,
            textLength: trimmedText.length,
            tags: updatedTags,
            outlinePointId,
        });

        if (editingItem?.id.startsWith('temp-')) {
            await handleCreateNewThought(trimmedText, updatedTags, outlinePointId, subPointId);
        } else {
            await handleUpdateExistingThought(trimmedText, updatedTags, outlinePointId, subPointId);
            handleCloseEdit();
        }
    }, [addingThoughtToSection, editingItem, handleCloseEdit, handleCreateNewThought, handleDeleteThought, handleUpdateExistingThought]);

    // Retained for the offline replay path: a debounced thought save that failed
    // can be re-fired. Thought create/edit/delete now ride the native Firestore
    // offline queue (idempotent by id), so they need no hand-rolled retry.
    const handleRetryPendingThought = useCallback(async (thoughtId: string) => {
        if (retryThoughtSave) {
            await retryThoughtSave(thoughtId);
        }
    }, [retryThoughtSave]);

    const handleMoveToAmbiguous = (itemId: string, fromContainerId: string) => {
        if (!sermon) return;
        if (!['introduction', 'main', 'conclusion'].includes(fromContainerId)) return;

        const sourceItems = containers[fromContainerId] || [];
        const itemIndex = sourceItems.findIndex((it) => it.id === itemId);
        if (itemIndex === -1) return;

        const item = sourceItems[itemIndex];
        const updatedSource = [...sourceItems.slice(0, itemIndex), ...sourceItems.slice(itemIndex + 1)];
        const movedItem = { ...item, outlinePointId: null, requiredTags: [] as string[] };
        const updatedAmbiguous = [...(containers.ambiguous || []), movedItem];

        const updatedContainers = {
            ...containers,
            [fromContainerId]: updatedSource,
            ambiguous: updatedAmbiguous,
        };

        setContainers(updatedContainers);

        const thought = sermon.thoughts.find((t) => t.id === itemId);
        if (thought) {
            const updatedThought: Thought = {
                ...thought,
                tags: [
                    ...(movedItem.requiredTags || []),
                    ...(movedItem.customTagNames || []).map((tag) => tag.name),
                ],
                outlinePointId: null,
            };
            debouncedSaveThought(sermon.id, updatedThought);
        }

        const newStructure = structureFromContainers(updatedContainers);
        debouncedSaveStructure(sermon.id, newStructure);
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
