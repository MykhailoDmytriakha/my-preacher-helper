import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Sermon, Item, Thought, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought, deleteThought } from "@/services/thought.service";
import { debugLog } from "@/utils/debugMode";
import { getCanonicalTagForSection } from "@/utils/tagUtils";
import { insertThoughtIdInStructure, resolveSectionFromOutline } from "@/utils/thoughtOrdering";

import { buildStructureFromContainers, buildItemForUI, findOutlinePoint, isLocalThoughtId } from "../utils/structure";

import type { PendingThoughtInput } from "./usePendingThoughts";

const FAILED_TO_ADD_THOUGHT_KEY = 'errors.failedToAddThought';
const SYNC_TTL_MS = 30 * 60 * 1000;
const SYNC_SUCCESS_MS = 3500;

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
    pendingActions: {
        createPendingThought: (input: PendingThoughtInput) => { localId: string } | null;
        updatePendingThought: (localId: string, input: Partial<PendingThoughtInput>) => void;
        markPendingStatus: (localId: string, status: 'pending' | 'error' | 'sending', options?: { error?: string; resetExpiry?: boolean }) => void;
        removePendingThought: (localId: string, options?: { removeFromContainers?: boolean }) => void;
        replacePendingThought: (localId: string, newItem: Item) => void;
        updateItemSyncStatus: (itemId: string, status?: 'pending' | 'error' | 'success', meta?: { expiresAt?: string; lastError?: string; successAt?: string; operation?: 'create' | 'update' | 'delete' }) => void;
        getPendingById: (localId: string) => { sectionId: 'introduction' | 'main' | 'conclusion'; text: string; tags: string[]; outlinePointId?: string } | undefined;
    };
}

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
    pendingActions,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
    const isOnline = useOnlineStatus();
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
    const sermonRef = useRef(sermon);
    const retryThoughtActionsRef = useRef<Record<string, () => Promise<void>>>({});
    const latestThoughtDraftsRef = useRef<Record<string, Thought>>({});
    const thoughtUpdateVersionRef = useRef<Record<string, number>>({});

    useEffect(() => {
        sermonRef.current = sermon;
    }, [sermon]);

    useEffect(() => {
        retryThoughtActionsRef.current = {};
        latestThoughtDraftsRef.current = {};
        thoughtUpdateVersionRef.current = {};
    }, [sermon?.id]);

    const buildSyncExpiresAt = useCallback(() => {
        return new Date(Date.now() + SYNC_TTL_MS).toISOString();
    }, []);

    const scheduleSyncClear = useCallback((itemId: string) => {
        window.setTimeout(() => {
            pendingActions.updateItemSyncStatus(itemId);
        }, SYNC_SUCCESS_MS);
    }, [pendingActions]);

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

    const submitPendingThought = useCallback(async (payload: {
        localId: string;
        sectionId: 'introduction' | 'main' | 'conclusion';
        text: string;
        tags: string[];
        outlinePointId?: string;
    }) => {
        if (!sermon) return;
        const { localId, sectionId, text, tags, outlinePointId } = payload;

        const outlineSection = resolveSectionFromOutline(sermon, outlinePointId ?? null);
        const finalOutlinePointId = outlineSection && outlineSection !== sectionId ? undefined : outlinePointId;

        debugLog('Structure: submit pending thought', { localId, sectionId, textLength: text.length, tags, outlinePointId });
        pendingActions.markPendingStatus(localId, 'sending', { resetExpiry: true });

        if (isOnline === false) {
            pendingActions.markPendingStatus(localId, 'error', {
                error: t('manualThought.offlineWarning', { defaultValue: 'You are currently offline.' })
            });
            return;
        }

        try {
            const thoughtService = await import('@/services/thought.service');
            const sectionTag = getCanonicalTagForSection(sectionId);
            const requestTags = [...tags, sectionTag];
            debugLog('Structure: createManualThought payload', {
                sermonId: sermon.id,
                localId,
                sectionId,
                outlinePointId,
                tags: requestTags,
            });
            const addedThought = await thoughtService.createManualThought(sermon.id, {
                id: localId,
                text,
                tags: requestTags,
                outlinePointId: finalOutlinePointId,
                date: new Date().toISOString(),
            });
            debugLog('Structure: createManualThought result', { id: addedThought.id, tags: addedThought.tags, outlinePointId: addedThought.outlinePointId });

            const outlinePoint = findOutlinePoint(finalOutlinePointId, sermon);
            const newItem = buildItemForUI({
                id: addedThought.id,
                text,
                tags,
                allowedTags,
                sectionTag,
                outlinePointId: finalOutlinePointId,
                outlinePoint,
            });

            const successAt = new Date().toISOString();
            pendingActions.replacePendingThought(localId, {
                ...newItem,
                syncStatus: 'success',
                syncSuccessAt: successAt,
            });
            pendingActions.removePendingThought(localId, { removeFromContainers: false });

            // Prepare updated structure immediately to avoid race conditions with containersRef
            const currentStructure = buildStructureFromContainers(containersRef.current);
            const thoughtsById = new Map(
                [...sermon.thoughts, addedThought].map((thought) => [thought.id, thought])
            );
            const updatedStructure = insertThoughtIdInStructure({
                structure: currentStructure,
                section: sectionId,
                thoughtId: addedThought.id,
                outlinePointId: finalOutlinePointId,
                thoughtsById,
                thoughts: [...sermon.thoughts, addedThought],
                outline: sermon.outline,
            });

            setSermon((prev) => {
                if (!prev) return null;
                return {
                    ...prev,
                    thoughts: [...prev.thoughts, addedThought],
                    structure: updatedStructure,
                    thoughtsBySection: updatedStructure,
                };
            });

            try {
                await updateStructure(sermon.id, updatedStructure);
            } catch (structureError) {
                console.error("Error updating structure after add:", structureError);
                toast.error(t('errors.failedToSaveStructure'));
            }

            pendingActions.updateItemSyncStatus(addedThought.id, 'success', { successAt });
            setTimeout(() => {
                pendingActions.updateItemSyncStatus(addedThought.id);
            }, 3500);
        } catch (error) {
            console.error("Error adding thought:", error);
            pendingActions.markPendingStatus(localId, 'error', { error: t(FAILED_TO_ADD_THOUGHT_KEY) });
            toast.error(t(FAILED_TO_ADD_THOUGHT_KEY));
        }
    }, [allowedTags, containersRef, isOnline, pendingActions, sermon, setSermon, t]);

    const handleCreateNewThought = async (
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | undefined,
    ) => {
        if (!sermon) return;
        const section = addingThoughtToSection;

        debugLog('Structure: handleCreateNewThought', {
            section,
            textLength: updatedText.length,
            tags: updatedTags,
            outlinePointId,
        });
        if (!section || !['introduction', 'main', 'conclusion'].includes(section)) {
            debugLog('Structure: handleCreateNewThought aborted - invalid section', { section });
            return;
        }

        try {
            const pending = pendingActions.createPendingThought({
                sectionId: section as 'introduction' | 'main' | 'conclusion',
                text: updatedText,
                tags: updatedTags,
                outlinePointId,
            });
            if (pending) {
                await submitPendingThought({
                    localId: pending.localId,
                    sectionId: section as 'introduction' | 'main' | 'conclusion',
                    text: updatedText,
                    tags: updatedTags,
                    outlinePointId,
                });
            }
        } catch (error) {
            console.error("Error adding thought:", error);
            toast.error(t(FAILED_TO_ADD_THOUGHT_KEY));
        } finally {
            handleCloseEdit();
        }
    };

    const handleUpdateExistingThought = async (
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | undefined,
    ) => {
        if (!sermon || !editingItem) return;
        if (isLocalThoughtId(editingItem.id)) return;

        const updatedItem: Thought = {
            ...sermon.thoughts.find((thought) => thought.id === editingItem.id)!,
            text: updatedText,
            tags: [...(editingItem.requiredTags || []), ...updatedTags],
            outlinePointId: outlinePointId
        };
        const syncExpiresAt = buildSyncExpiresAt();
        const outlinePoint = findOutlinePoint(outlinePointId, sermon);
        const nextVersion = (thoughtUpdateVersionRef.current[updatedItem.id] ?? 0) + 1;

        latestThoughtDraftsRef.current[updatedItem.id] = updatedItem;
        thoughtUpdateVersionRef.current[updatedItem.id] = nextVersion;

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
            syncStatus: 'pending',
            syncOperation: 'update',
            syncExpiresAt,
            syncLastError: undefined,
        }));

        const executeUpdate = async (thoughtId: string, requestVersion: number) => {
            const currentSermon = sermonRef.current;
            const latestThought = latestThoughtDraftsRef.current[thoughtId];
            if (!currentSermon || !latestThought) return;

            pendingActions.updateItemSyncStatus(thoughtId, 'pending', {
                expiresAt: buildSyncExpiresAt(),
                operation: 'update',
            });

            try {
                const updatedThought = await updateThought(currentSermon.id, latestThought);
                if (thoughtUpdateVersionRef.current[thoughtId] !== requestVersion) {
                    return;
                }

                const successAt = new Date().toISOString();
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
                }));
                pendingActions.updateItemSyncStatus(updatedThought.id, 'success', {
                    successAt,
                    operation: 'update',
                });

                delete retryThoughtActionsRef.current[thoughtId];
                delete latestThoughtDraftsRef.current[thoughtId];
                delete thoughtUpdateVersionRef.current[thoughtId];
                scheduleSyncClear(thoughtId);
            } catch (error) {
                if (thoughtUpdateVersionRef.current[thoughtId] !== requestVersion) {
                    return;
                }
                console.error("Error updating thought:", error);
                pendingActions.updateItemSyncStatus(thoughtId, 'error', {
                    expiresAt: buildSyncExpiresAt(),
                    lastError: t('errors.failedToSaveThought'),
                    operation: 'update',
                });
            }
        };

        retryThoughtActionsRef.current[updatedItem.id] = async () => {
            const latestVersion = thoughtUpdateVersionRef.current[updatedItem.id];
            if (!latestVersion) return;
            await executeUpdate(updatedItem.id, latestVersion);
        };
        void executeUpdate(updatedItem.id, nextVersion);
    };

    const handleDeleteThought = useCallback(async (thoughtId: string) => {
        if (!sermonRef.current) return;

        pendingActions.updateItemSyncStatus(thoughtId, 'pending', {
            expiresAt: buildSyncExpiresAt(),
            operation: 'delete',
        });

        const executeDelete = async () => {
            const currentSermon = sermonRef.current;
            const thoughtToDelete = currentSermon?.thoughts.find((thought) => thought.id === thoughtId);
            if (!currentSermon || !thoughtToDelete) return;

            try {
                await deleteThought(currentSermon.id, thoughtToDelete);

                const newContainers = Object.keys(containersRef.current).reduce((acc, key) => {
                    acc[key] = (containersRef.current[key] || []).filter((item) => item.id !== thoughtId);
                    return acc;
                }, {} as Record<string, Item[]>);

                const newStructure: ThoughtsBySection = {
                    introduction: (newContainers.introduction || []).map((it) => it.id),
                    main: (newContainers.main || []).map((it) => it.id),
                    conclusion: (newContainers.conclusion || []).map((it) => it.id),
                    ambiguous: (newContainers.ambiguous || []).map((it) => it.id),
                };

                setContainers(newContainers);
                containersRef.current = newContainers;
                setSermon((prev) => prev ? {
                    ...prev,
                    thoughts: prev.thoughts.filter((thought) => thought.id !== thoughtId),
                    structure: newStructure,
                    thoughtsBySection: newStructure,
                } : null);

                await updateStructure(currentSermon.id, newStructure);

                delete retryThoughtActionsRef.current[thoughtId];
                toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");
            } catch (error) {
                console.error("Error deleting empty thought:", error);
                pendingActions.updateItemSyncStatus(thoughtId, 'error', {
                    expiresAt: buildSyncExpiresAt(),
                    lastError: t('errors.deletingError') || "Failed to delete thought.",
                    operation: 'delete',
                });
                toast.error(t('errors.deletingError') || "Failed to delete thought.");
            }
        };

        retryThoughtActionsRef.current[thoughtId] = executeDelete;
        void executeDelete();
    }, [buildSyncExpiresAt, containersRef, pendingActions, setContainers, setSermon, t]);

    const handleSaveEdit = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
        if (!sermon) return;

        const trimmedText = updatedText.trim();

        // TRIZ+IFR: Empty text means "Cancel" for new thoughts and "Delete" for existing ones
        if (!trimmedText) {
            debugLog('Structure: empty text in handleSaveEdit - interpreting as cancel/delete', {
                editingId: editingItem?.id,
                isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            });

            if (!editingItem || editingItem.id.startsWith('temp-') || isLocalThoughtId(editingItem.id)) {
                // New thought or unsynced pending thought -> Just cancel
                if (editingItem && isLocalThoughtId(editingItem.id)) {
                    pendingActions.removePendingThought(editingItem.id, { removeFromContainers: true });
                }
                handleCloseEdit();
                return;
            }

            // Existing thought -> Delete
            const thoughtId = editingItem.id;
            await handleDeleteThought(thoughtId);
            handleCloseEdit();
            return;
        }

        debugLog('Structure: handleSaveEdit', {
            editingId: editingItem?.id,
            isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            isLocal: Boolean(editingItem && isLocalThoughtId(editingItem.id)),
            section: addingThoughtToSection,
            textLength: trimmedText.length,
            tags: updatedTags,
            outlinePointId,
        });

        if (editingItem?.id.startsWith('temp-')) {
            await handleCreateNewThought(trimmedText, updatedTags, outlinePointId);
        } else if (editingItem && isLocalThoughtId(editingItem.id)) {
            pendingActions.updatePendingThought(editingItem.id, {
                text: trimmedText,
                tags: updatedTags,
                outlinePointId,
            });
            const pending = pendingActions.getPendingById(editingItem.id);
            if (pending) {
                await submitPendingThought({
                    localId: editingItem.id,
                    sectionId: pending.sectionId,
                    text: trimmedText,
                    tags: updatedTags,
                    outlinePointId,
                });
            }
            handleCloseEdit();
        } else {
            await handleUpdateExistingThought(trimmedText, updatedTags, outlinePointId);
            handleCloseEdit();
        }
    };

    const handleRetryPendingThought = useCallback(async (localId: string) => {
        const pending = pendingActions.getPendingById(localId);
        if (pending) {
            await submitPendingThought({
                localId,
                sectionId: pending.sectionId,
                text: pending.text,
                tags: pending.tags,
                outlinePointId: pending.outlinePointId,
            });
            return;
        }

        const retryAction = retryThoughtActionsRef.current[localId];
        if (retryAction) {
            await retryAction();
            return;
        }

        if (retryThoughtSave) {
            await retryThoughtSave(localId);
        }
    }, [pendingActions, retryThoughtSave, submitPendingThought]);

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

        const newStructure: ThoughtsBySection = {
            introduction: (updatedContainers.introduction || []).map((it) => it.id),
            main: (updatedContainers.main || []).map((it) => it.id),
            conclusion: (updatedContainers.conclusion || []).map((it) => it.id),
            ambiguous: (updatedContainers.ambiguous || []).map((it) => it.id),
        };
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
