import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Sermon, Item, Thought, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought } from "@/services/thought.service";

import { findOutlinePoint, buildItemForUI } from "../utils/structure";

interface UseSermonActionsProps {
    sermon: Sermon | null;
    setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
    containers: Record<string, Item[]>;
    setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
    allowedTags: { name: string; color: string }[];
    columnTitles: Record<string, string>;
    debouncedSaveThought: (sermonId: string, thought: Thought) => void;
    debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection) => void;
}

export function useSermonActions({
    sermon,
    setSermon,
    containers,
    setContainers,
    allowedTags,
    columnTitles,
    debouncedSaveThought,
    debouncedSaveStructure,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
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

    const handleCreateNewThought = async (
        updatedText: string,
        updatedTags: string[],
        outlinePointId: string | undefined,
    ) => {
        if (!sermon) return;
        const section = addingThoughtToSection;

        const newThought = {
            id: Date.now().toString(),
            text: updatedText,
            tags: [
                ...updatedTags,
                ...(section ? [columnTitles[section]] : [])
            ],
            outlinePointId: outlinePointId,
            date: new Date().toISOString()
        };

        try {
            const thoughtService = await import('@/services/thought.service');
            const addedThought = await thoughtService.createManualThought(sermon.id, newThought);
            const outlinePoint = findOutlinePoint(outlinePointId, sermon);

            const newItem = buildItemForUI({
                id: addedThought.id,
                text: updatedText,
                tags: updatedTags,
                allowedTags,
                sectionTag: section ? columnTitles[section] || '' : undefined,
                outlinePointId,
                outlinePoint,
            });

            setSermon((prev) => {
                if (!prev) return null;
                return { ...prev, thoughts: [...prev.thoughts, addedThought] };
            });

            if (section) {
                setContainers(prev => ({
                    ...prev,
                    [section]: [...(prev[section] || []), newItem]
                }));

                const currentStructure = sermon.structure || {};
                const newStructure = typeof currentStructure === 'string'
                    ? JSON.parse(currentStructure)
                    : { ...currentStructure };

                if (!newStructure[section]) newStructure[section] = [];
                newStructure[section] = [...newStructure[section], newItem.id];

                await updateStructure(sermon.id, newStructure);
            }
        } catch (error) {
            console.error("Error adding thought:", error);
            toast.error(t('errors.failedToAddThought'));
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
        if (editingItem?.id.startsWith('temp-')) {
            await handleCreateNewThought(updatedText, updatedTags, outlinePointId);
        } else {
            await handleUpdateExistingThought(updatedText, updatedTags, outlinePointId);
        }
    };

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
    };
}
