import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Sermon, Item, Thought, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought } from "@/services/thought.service";
import { debugLog } from "@/utils/debugMode";
import { getCanonicalTagForSection } from "@/utils/tagUtils";

import { buildStructureFromContainers, buildItemForUI, findOutlinePoint, isLocalThoughtId } from "../utils/structure";

import type { PendingThoughtInput } from "./usePendingThoughts";

const FAILED_TO_ADD_THOUGHT_KEY = 'errors.failedToAddThought';

interface UseSermonActionsProps {
    sermon: Sermon | null;
    setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
    containers: Record<string, Item[]>;
    setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
    containersRef: React.MutableRefObject<Record<string, Item[]>>;
    allowedTags: { name: string; color: string }[];
    debouncedSaveThought: (sermonId: string, thought: Thought) => void;
    debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection) => void;
    pendingActions: {
        createPendingThought: (input: PendingThoughtInput) => { localId: string } | null;
        updatePendingThought: (localId: string, input: Partial<PendingThoughtInput>) => void;
        markPendingStatus: (localId: string, status: 'pending' | 'error' | 'sending', options?: { error?: string; resetExpiry?: boolean }) => void;
        removePendingThought: (localId: string, options?: { removeFromContainers?: boolean }) => void;
        replacePendingThought: (localId: string, newItem: Item) => void;
        updateItemSyncStatus: (itemId: string, status?: 'pending' | 'error' | 'success', meta?: { expiresAt?: string; lastError?: string; successAt?: string }) => void;
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
    pendingActions,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
    const isOnline = useOnlineStatus();
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);

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
                outlinePointId,
                date: new Date().toISOString(),
            });
            debugLog('Structure: createManualThought result', { id: addedThought.id, tags: addedThought.tags, outlinePointId: addedThought.outlinePointId });

            const outlinePoint = findOutlinePoint(outlinePointId, sermon);
            const newItem = buildItemForUI({
                id: addedThought.id,
                text,
                tags,
                allowedTags,
                sectionTag,
                outlinePointId,
                outlinePoint,
            });

            const successAt = new Date().toISOString();
            pendingActions.replacePendingThought(localId, {
                ...newItem,
                syncStatus: 'success',
                syncSuccessAt: successAt,
            });
            pendingActions.removePendingThought(localId, { removeFromContainers: false });

            setSermon((prev) => {
                if (!prev) return null;
                return { ...prev, thoughts: [...prev.thoughts, addedThought] };
            });

            // Prepare updated structure immediately to avoid race conditions with containersRef
            const currentStructure = buildStructureFromContainers(containersRef.current);
            const updatedStructure: ThoughtsBySection = {
                ...currentStructure,
                [sectionId]: [...(currentStructure[sectionId as keyof ThoughtsBySection] || []), addedThought.id]
            };

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

        try {
            const updatedThought = await updateThought(sermon.id, updatedItem);
            const updatedThoughts = sermon.thoughts.map((thought) =>
                thought.id === updatedItem.id ? updatedThought : thought
            );
            setSermon((prev) => prev ? { ...prev, thoughts: updatedThoughts } : null);

            const outlinePoint = findOutlinePoint(outlinePointId, sermon);

            const newContainers = Object.keys(containers).reduce((acc, key) => {
                acc[key] = (containers[key] || []).map((item) =>
                    item.id === updatedItem.id
                        ? {
                            ...item,
                            content: updatedText,
                            customTagNames: updatedTags.map((tagName) => ({
                                name: tagName,
                                color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
                            })),
                            outlinePointId,
                            outlinePoint
                        }
                        : item
                );
                return acc;
            }, {} as Record<string, Item[]>);

            setContainers(newContainers);
        } catch (error) {
            console.error("Error updating thought:", error);
        } finally {
            handleCloseEdit();
        }
    };

    const handleSaveEdit = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
        if (!sermon) return;
        debugLog('Structure: handleSaveEdit', {
            editingId: editingItem?.id,
            isTemp: Boolean(editingItem?.id?.startsWith('temp-')),
            isLocal: Boolean(editingItem && isLocalThoughtId(editingItem.id)),
            section: addingThoughtToSection,
            textLength: updatedText.length,
            tags: updatedTags,
            outlinePointId,
        });
        if (editingItem?.id.startsWith('temp-')) {
            await handleCreateNewThought(updatedText, updatedTags, outlinePointId);
        } else if (editingItem && isLocalThoughtId(editingItem.id)) {
            pendingActions.updatePendingThought(editingItem.id, {
                text: updatedText,
                tags: updatedTags,
                outlinePointId,
            });
            const pending = pendingActions.getPendingById(editingItem.id);
            if (pending) {
                await submitPendingThought({
                    localId: editingItem.id,
                    sectionId: pending.sectionId,
                    text: updatedText,
                    tags: updatedTags,
                    outlinePointId,
                });
            }
            handleCloseEdit();
        } else {
            await handleUpdateExistingThought(updatedText, updatedTags, outlinePointId);
        }
    };

    const handleRetryPendingThought = useCallback(async (localId: string) => {
        const pending = pendingActions.getPendingById(localId);
        if (!pending) return;
        await submitPendingThought({
            localId,
            sectionId: pending.sectionId,
            text: pending.text,
            tags: pending.tags,
            outlinePointId: pending.outlinePointId,
        });
    }, [pendingActions, submitPendingThought]);

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
        handleMoveToAmbiguous,
        handleRetryPendingThought,
    };
}
