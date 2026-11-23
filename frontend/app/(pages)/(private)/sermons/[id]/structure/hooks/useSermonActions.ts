import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from 'sonner';

import { useStructureWriter } from "@/components/sermon/structureWriter";
import { Sermon, Item, ThoughtsBySection } from "@/models/models";
import { debugLog } from "@/utils/debugMode";
import { skippedWrite, type WriteOperation } from '@/utils/recoverableWrite';
import { useTranslation } from "@locales/useTranslation";

interface UseSermonActionsProps {
    sermon: Sermon | null;
    setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
    containers: Record<string, Item[]>;
    setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
    containersRef: React.MutableRefObject<Record<string, Item[]>>;
    onPlacementCaptured?: (thoughtId: string, containers: Record<string, Item[]>) => void;
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
    onPlacementCaptured,
}: UseSermonActionsProps) {
    const { t } = useTranslation();
    const writer = useStructureWriter();
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
    const sermonRef = useRef(sermon);
    useEffect(() => {
        sermonRef.current = sermon;
    }, [sermon]);

    const handleEdit = useCallback((item: Item) => {
        setEditingItem(item);
        setAddingThoughtToSection(null);
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
        addingThoughtToSection,
        handleEdit,
        handleCloseEdit,
        handleAddThoughtToSection,
        handleDeleteThought,
        handleMoveToAmbiguous,
    };
}
