"use client";

import React, { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { DndContext, DragOverlay, pointerWithin, type DragEndEvent } from "@dnd-kit/core";
import { useSearchParams } from "next/navigation";
import Column from "@/components/Column";
import { Item, Sermon, OutlinePoint, Thought, Outline, Structure } from "@/models/models";
import EditThoughtModal from "@/components/EditThoughtModal";
import { updateThought, deleteThought } from "@/services/thought.service";
import { updateStructure } from "@/services/structure.service";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { toast } from 'sonner';
import CardContent from "@/components/CardContent";
import { getExportContent } from "@/utils/exportContent";
import { getSectionLabel } from "@lib/sections";
import { useSermonStructureData } from "@/hooks/useSermonStructureData";
import { isStructureChanged } from "./utils/structure";
import { useStructureDnd } from "./hooks/useStructureDnd";
import { useAiSortingDiff } from "./hooks/useAiSortingDiff";
import { useFocusMode } from "./hooks/useFocusMode";
import { useOutlineStats } from "./hooks/useOutlineStats";
import { usePersistence } from "./hooks/usePersistence";
import { FocusNav } from "./components/FocusNav";
import { AmbiguousSection } from "./components/AmbiguousSection";

interface UseSermonStructureDataReturn {
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: OutlinePoint[]; main: OutlinePoint[]; conclusion: OutlinePoint[] };
  requiredTagColors: { introduction?: string; main?: string; conclusion?: string };
  allowedTags: { name: string; color: string }[];
  loading: boolean;
  error: string | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isAmbiguousVisible: boolean;
  setIsAmbiguousVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function StructurePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}

function StructurePageContent() {
  const searchParams = useSearchParams();
  const sermonId = searchParams?.get("sermonId");
  const { t } = useTranslation();
  const [isClient, setIsClient] = useState(false);

  // Use effect to mark when component is mounted on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Use the hook to manage data fetching and related state
  const {
    sermon,
    setSermon,
    containers,
    setContainers,
    outlinePoints,
    requiredTagColors,
    allowedTags,
    loading,
    error,
    isAmbiguousVisible,
    setIsAmbiguousVisible
  }: UseSermonStructureDataReturn = useSermonStructureData(sermonId, t);

  // Ref to hold the latest containers state
  const containersRef = useRef(containers);
  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  // Local UI state
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Persistence hook
  const { debouncedSaveThought, debouncedSaveStructure } = usePersistence({ setSermon });

  // Focus mode hook
  const {
    focusedColumn,
    handleToggleFocusMode,
    navigateToSection,
  } = useFocusMode({ searchParams, sermonId });

  // Outline stats hook
  const { thoughtsPerOutlinePoint } = useOutlineStats({ sermon, containers });

  // AI sorting diff hook
  const {
    preSortState,
    highlightedItems,
    isDiffModeActive,
    isSorting,
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
  } = useAiSortingDiff({
    containers,
    setContainers,
    outlinePoints,
    sermon,
    sermonId,
    debouncedSaveThought,
    debouncedSaveStructure,
  });

  // DnD hook
  const {
    sensors: dndSensors,
    activeId: dndActiveId,
    handleDragStart: onDragStartHook,
    handleDragOver: onDragOverHook,
    handleDragEnd,
  } = useStructureDnd({
    containers,
    setContainers,
    containersRef,
    sermon,
    setSermon,
    outlinePoints,
    columnTitles: {
      introduction: getSectionLabel(t, 'introduction'),
      main: getSectionLabel(t, 'main'),
      conclusion: getSectionLabel(t, 'conclusion'),
      ambiguous: getSectionLabel(t, 'ambiguous'),
    },
    debouncedSaveThought,
  });

  const columnTitles: Record<string, string> = {
    introduction: getSectionLabel(t, 'introduction'),
    main: getSectionLabel(t, 'main'),
    conclusion: getSectionLabel(t, 'conclusion'),
    ambiguous: getSectionLabel(t, 'ambiguous'),
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
  };

  const handleAddThoughtToSection = (sectionId: string) => {
    // Create an empty thought with predefined section
    const emptyThought: Item = {
      id: `temp-${Date.now()}`, // Temporary ID that will be replaced when saved
      content: '',
      requiredTags: [],
      customTagNames: []
    };
    
    // Set as the editing item with the specific section
    setEditingItem(emptyThought);
    setAddingThoughtToSection(sectionId);
  };

  // Handle a newly created audio thought: append to data model and UI, and persist structure
  const handleAudioThoughtCreated = useCallback(async (thought: Thought, sectionId: 'introduction' | 'main' | 'conclusion') => {
    if (!sermon) return;

    try {
      // Determine localized structural tag for the section
      const sectionTag = columnTitles[sectionId];

      // Compute custom tags (exclude structural tag), preserving original order
      const customTags = (thought.tags || []).filter((tag) => {
        const norm = (tag || '').trim().toLowerCase();
        return norm !== sectionTag.trim().toLowerCase() &&
               norm !== 'introduction' && norm !== 'main part' && norm !== 'conclusion' &&
               norm !== 'вступление' && norm !== 'основная часть' && norm !== 'заключение';
      });

      // Build UI item
      const newItem: Item = {
        id: thought.id,
        content: thought.text,
        requiredTags: [sectionTag],
        customTagNames: customTags.map((name) => ({
          name,
          color: allowedTags.find((t) => t.name === name)?.color || '#4c51bf',
        })),
      };

      // 1) Update sermon state
      setSermon((prev) => prev ? { ...prev, thoughts: [...prev.thoughts, thought] } : prev);

      // 2) Update containers UI (append to end of the target section)
      setContainers((prev) => {
        const next = { ...prev };
        next[sectionId] = [...(prev[sectionId] || []), newItem];
        return next;
      });

      // 3) Persist updated structure (append id to the section)
      const updatedContainers = {
        ...containersRef.current,
        [sectionId]: [...(containersRef.current[sectionId] || []), newItem],
      } as Record<string, Item[]>;

      containersRef.current = updatedContainers;

      const newStructure: Structure = {
        introduction: (updatedContainers.introduction || []).map((it) => it.id),
        main: (updatedContainers.main || []).map((it) => it.id),
        conclusion: (updatedContainers.conclusion || []).map((it) => it.id),
        ambiguous: (updatedContainers.ambiguous || []).map((it) => it.id),
      };

      // Use debounced structure save
      debouncedSaveStructure(sermon.id, newStructure);
    } catch (e) {
      console.error('Error handling audio thought creation:', e);
      toast.error(t('errors.savingError'));
    }
  }, [allowedTags, columnTitles, debouncedSaveStructure, sermon, t]);

  const handleSaveEdit = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!sermon) return;
    
    // Check if we're adding a new thought or editing an existing one
    if (editingItem && editingItem.id.startsWith('temp-')) {
      // This is a new thought being added
      const section = addingThoughtToSection;
      
      // Construct the new thought data with the required date property
      const newThought = {
        id: Date.now().toString(), // Will be replaced by server
        text: updatedText,
        tags: [
          ...updatedTags,
          // Add the required section tag based on the section
          ...(section ? [columnTitles[section as keyof typeof columnTitles]] : [])
        ],
        outlinePointId: outlinePointId,
        date: new Date().toISOString() // Adding the required date property
      };
      
      try {
        // Add the thought using the thought service
        const thoughtService = await import('@/services/thought.service');
        const addedThought = await thoughtService.createManualThought(sermon.id, newThought);
        
        // Find outline point info if available
        let outlinePoint: { text: string; section: string } | undefined;
        if (outlinePointId && sermon.outline) {
          const sections = ['introduction', 'main', 'conclusion'] as const;
          
          for (const section of sections) {
            const point = sermon.outline[section]?.find((p: OutlinePoint) => p.id === outlinePointId);
            if (point) {
              outlinePoint = {
                text: point.text,
                section: '' // Don't show section in structure page
              };
              break;
            }
          }
        }
        
        // Create item for UI
        const newItem: Item = {
          id: addedThought.id,
          content: updatedText,
          customTagNames: updatedTags.map((tagName) => ({
            name: tagName,
            color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
          })),
          requiredTags: section ? [
            columnTitles[section as keyof typeof columnTitles] || ''
          ] : [],
          outlinePointId: outlinePointId,
          outlinePoint: outlinePoint
        };
        
        // Update sermon state
        setSermon((prevSermon: Sermon | null) => {
          if (!prevSermon) return null;
          return {
            ...prevSermon,
            thoughts: [...prevSermon.thoughts, addedThought]
          };
        });
        
        // Update containers
        if (section) {
          setContainers(prev => ({
            ...prev,
            [section]: [...prev[section], newItem]
          }));
          
          // Update structure in database
          const currentStructure = sermon.structure || {};
          const newStructure = typeof currentStructure === 'string' 
            ? JSON.parse(currentStructure) 
            : { ...currentStructure };
          
          if (!newStructure[section]) {
            newStructure[section] = [];
          }
          newStructure[section] = [...newStructure[section], newItem.id];
          
          await updateStructure(sermon.id, newStructure);
        }
      } catch (error) {
        console.error("Error adding thought:", error);
        toast.error(t('errors.failedToAddThought'));
      } finally {
        setEditingItem(null);
        setAddingThoughtToSection(null);
      }
    } else {
      // Existing code for updating thoughts
      if (!editingItem) return;

      const updatedItem: Thought = {
        ...sermon.thoughts.find((thought: Thought) => thought.id === editingItem.id)!,
        text: updatedText,
        tags: [...(editingItem.requiredTags || []), ...updatedTags],
        outlinePointId: outlinePointId
      };

      try {
        const updatedThought = await updateThought(sermon.id, updatedItem);
        const updatedThoughts = sermon.thoughts.map((thought: Thought) =>
          thought.id === updatedItem.id ? updatedThought : thought
        );
        setSermon((prevSermon: Sermon | null) => prevSermon ? { ...prevSermon, thoughts: updatedThoughts } : null);

        // Find outline point info if available
        let outlinePoint: { text: string; section: string } | undefined;
        if (outlinePointId && sermon.outline) {
          const sections = ['introduction', 'main', 'conclusion'] as const;
          
          for (const section of sections) {
            const point = sermon.outline[section]?.find((p: OutlinePoint) => p.id === outlinePointId);
            if (point) {
              outlinePoint = {
                text: point.text,
                section: '' // Don't show section in structure page
              };
              break;
            }
          }
        }

        const newContainers = Object.keys(containers).reduce(
          (acc, key) => {
            acc[key] = containers[key].map((item) =>
              item.id === updatedItem.id
                ? {
                    ...item,
                    content: updatedText,
                    customTagNames: updatedTags.map((tagName) => ({
                      name: tagName,
                      color:
                        allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
                    })),
                    outlinePointId: outlinePointId,
                    outlinePoint: outlinePoint
                  }
                : item
            );
            return acc;
          },
          {} as Record<string, Item[]>
        );

        setContainers(newContainers);
      } catch (error) {
        console.error("Error updating thought:", error);
      } finally {
        setEditingItem(null);
        setAddingThoughtToSection(null);
      }
    }
  };

  const handleCloseEdit = () => {
    setEditingItem(null);
  };

  // Move a thought from a concrete section to the ambiguous section
  const handleMoveToAmbiguous = (itemId: string, fromContainerId: string) => {
    if (!sermon) return;
    if (!['introduction', 'main', 'conclusion'].includes(fromContainerId)) return;

    // Find the item in the source container
    const sourceItems = containers[fromContainerId];
    const itemIndex = sourceItems.findIndex((it) => it.id === itemId);
    if (itemIndex === -1) return;

    const item = sourceItems[itemIndex];

    // Prepare updated containers
    const updatedSource = [...sourceItems.slice(0, itemIndex), ...sourceItems.slice(itemIndex + 1)];
    const movedItem = { ...item, outlinePointId: undefined, requiredTags: [] as string[] };
    const updatedAmbiguous = [...containers.ambiguous, movedItem];

    const updatedContainers = {
      ...containers,
      [fromContainerId]: updatedSource,
      ambiguous: updatedAmbiguous,
    };

    // Optimistically update UI
    setContainers(updatedContainers);
    containersRef.current = updatedContainers;

    // Persist thought update (clear outlinePointId and section tag)
    const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
    if (thought) {
      const updatedThought: Thought = {
        ...thought,
        tags: [
          ...(movedItem.requiredTags || []),
          ...(movedItem.customTagNames || []).map((tag) => tag.name),
        ],
        outlinePointId: undefined,
      };
      debouncedSaveThought(sermon.id, updatedThought);
    }

    // Persist structure
    const newStructure: Structure = {
      introduction: updatedContainers.introduction.map((it) => it.id),
      main: updatedContainers.main.map((it) => it.id),
      conclusion: updatedContainers.conclusion.map((it) => it.id),
      ambiguous: updatedContainers.ambiguous.map((it) => it.id),
    };
    debouncedSaveStructure(sermon.id, newStructure);
  };

  const getExportContentForFocusedColumn = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => {
    if (!focusedColumn || !sermon) {
      return '';
    }
    
    // Pass format and includeTags parameters to getExportContent
    return getExportContent(sermon, focusedColumn, { 
      format, 
      includeTags: options?.includeTags
    });
  };

  // REVISED HANDLER: Function to DELETE a thought and remove it from the structure
  const handleRemoveFromStructure = async (itemId: string, containerId: string) => {
    if (!sermonId || !sermon || containerId !== 'ambiguous') {
      toast.error(t('errors.removingError') || "Error removing item.");
      return;
    }

    // Find thought first to use its text in confirmation
    const thoughtToDelete = sermon.thoughts.find(t => t.id === itemId);
    if (!thoughtToDelete) {
      toast.error(t('errors.deletingError') || "Failed to find thought to delete.");
      return;
    }

    const confirmMessage = t('sermon.deleteThoughtConfirm', { 
      defaultValue: `Are you sure you want to permanently delete this thought: "${thoughtToDelete.text}"?`,
      text: thoughtToDelete.text
    });
    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Set deleting state BEFORE async call
    setDeletingItemId(itemId);

    try {
      await deleteThought(sermonId, thoughtToDelete); 
      
      // --- Update State on Successful Deletion ---
      // Capture previous state for potential rollback (though less critical here)
      const previousSermon = sermon; 
      const previousContainers = { ...containersRef.current }; 

      // 1. Update main sermon state (using a loop instead of filter)
      const updatedThoughts: Thought[] = [];
      for (const thought of previousSermon.thoughts) {
        if (thought.id !== itemId) {
          updatedThoughts.push(thought);
        }
      }
      const sermonWithDeletedThought = { ...previousSermon, thoughts: updatedThoughts };
      
      // 2. Update local containers state
      const updatedAmbiguous = previousContainers.ambiguous.filter((item: Item) => item.id !== itemId);
      const newContainers: Record<string, Item[]> = {
          ...previousContainers,
          ambiguous: updatedAmbiguous
      };

      // 3. Recalculate structure for DB update (based on updated containers)
      const newStructure: Structure = {
          introduction: (newContainers.introduction || []).map((item: Item) => item.id),
          main: (newContainers.main || []).map((item: Item) => item.id),
          conclusion: (newContainers.conclusion || []).map((item: Item) => item.id),
          ambiguous: (newContainers.ambiguous || []).map((item: Item) => item.id),
      };
      
      // 4. Update UI *after* successful deletion confirmation
      setSermon(sermonWithDeletedThought); // Update sermon state 
      setContainers(newContainers); // Update containers state
      containersRef.current = newContainers; // Keep ref in sync

      // 5. Update structure in DB (if changed)
      const structureDidChange = isStructureChanged(previousSermon.structure || {}, newStructure);
      if (structureDidChange) {
          try {
              await updateStructure(sermonId, newStructure);
          } catch {
              toast.error(t('errors.savingError') || "Error saving structure changes after deleting item.");
          }
      }

      toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");

    } catch {
      toast.error(t('errors.deletingError') || "Failed to delete thought.");
    } finally {
      // Clear deleting state AFTER operation (success or error)
      setDeletingItemId(null);
    }
  };

  // Function to handle outline updates from Column components
  const handleOutlineUpdate = (updatedOutline: Outline) => {
    setSermon((prevSermon: Sermon | null) => {
      if (!prevSermon) return null;
      
      // Merge the updated outline sections with existing ones
      const mergedOutline: Outline = {
        introduction: updatedOutline.introduction.length > 0 ? updatedOutline.introduction : (prevSermon.outline?.introduction || []),
        main: updatedOutline.main.length > 0 ? updatedOutline.main : (prevSermon.outline?.main || []),
        conclusion: updatedOutline.conclusion.length > 0 ? updatedOutline.conclusion : (prevSermon.outline?.conclusion || [])
      };
      
      return {
        ...prevSermon,
        outline: mergedOutline
      };
    });
  };

  const onDragEndWrapper = (event: DragEndEvent) => {
    const { active } = event;
    const activeKey = String(active?.id ?? "");
    if (activeKey && activeKey in highlightedItems) {
      setHighlightedItems((prev) => {
        const next = { ...prev } as typeof prev;
        delete next[activeKey];
        if (Object.keys(next).length === 0) {
          setIsDiffModeActive(false);
          setPreSortState(null);
        }
        return next;
      });
    }
    handleDragEnd(event);
  };

  // Add loading and error handling based on the hook's state
  if (loading) {
    // Fix hydration error by using consistent rendering between server and client
    return <div>{isClient ? t('common.loading') : "Loading"}...</div>;
  }

  if (error) {
    // Display error message from hook, potentially already handled by toast in hook
    return <div className="text-red-500">{isClient ? t('errors.fetchSermonStructureError') : "Error"}: {error}</div>;
  }

  if (!sermon) {
    return <div>{isClient ? t('structure.sermonNotFound') : "Sermon not found"}</div>; // Or handle case where sermonId is missing/invalid
  }

  return (
    <div className="p-4">
      <div className={`w-full`}>
        <div className="mb-4">
          <h1 className="text-4xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            {t('structure.title')} {sermon.title}
          </h1>
          <FocusNav
            sermon={sermon}
            sermonId={sermonId}
            focusedColumn={focusedColumn}
            onToggleFocusMode={handleToggleFocusMode}
            onNavigateToSection={navigateToSection}
          />
        </div>
        
        <DndContext
          data-testid="dnd-context"
          sensors={dndSensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStartHook}
          onDragOver={onDragOverHook}
          onDragEnd={onDragEndWrapper}
        >
          <AmbiguousSection
            items={containers.ambiguous}
            isVisible={isAmbiguousVisible}
            onToggleVisibility={() => setIsAmbiguousVisible(!isAmbiguousVisible)}
            onEdit={handleEdit}
            onDelete={handleRemoveFromStructure}
            deletingItemId={deletingItemId}
            activeId={dndActiveId}
            focusedColumn={focusedColumn}
            columnTitle={columnTitles["ambiguous"]}
          />
          
          <div className={`${!focusedColumn ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'flex flex-col'} w-full mt-8`}>
            {/* Introduction column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "introduction") && (
              <Column
                key="introduction"
                id="introduction"
                title={getSectionLabel(t, 'introduction')}
                items={containers.introduction || []}
                headerColor={requiredTagColors.introduction}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.introduction}
                showFocusButton={true}
                isFocusMode={focusedColumn === "introduction"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("introduction")}
                isLoading={isSorting && focusedColumn === "introduction"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("introduction")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
              />
            )}
            
            {/* Main column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "main") && (
              <Column
                key="main"
                id="main"
                title={getSectionLabel(t, 'main')}
                items={containers.main || []}
                headerColor={requiredTagColors.main}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.main}
                showFocusButton={true}
                isFocusMode={focusedColumn === "main"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("main")}
                isLoading={isSorting && focusedColumn === "main"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("main")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
              />
            )}
            
            {/* Conclusion column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "conclusion") && (
              <Column
                key="conclusion"
                id="conclusion"
                title={getSectionLabel(t, 'conclusion')}
                items={containers.conclusion || []}
                headerColor={requiredTagColors.conclusion}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.conclusion}
                showFocusButton={true}
                isFocusMode={focusedColumn === "conclusion"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("conclusion")}
                isLoading={isSorting && focusedColumn === "conclusion"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("conclusion")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
              />
            )}
          </div>
          <DragOverlay>
            {dndActiveId && (() => {
              const containerKey = Object.keys(containers).find(
                (key) => containers[key].some((item) => item.id === dndActiveId)
              );
              
              const activeItem = containerKey
                ? containers[containerKey].find((item) => item.id === dndActiveId)
                : null;
                
              return activeItem ? (
                <div 
                  className="flex items-start space-x-2 p-4 bg-white rounded-md border border-gray-300 shadow-lg opacity-90"
                  style={{ width: 'auto' }}
                >
                  <div className="flex-grow">
                    <CardContent item={activeItem} />
                  </div>
                  <div className="flex flex-col space-y-1 w-8 flex-shrink-0">
                  </div>
                </div>
              ) : null;
            })()}
          </DragOverlay>
        </DndContext>
        {editingItem && (
          <EditThoughtModal
            initialText={editingItem.content}
            initialTags={editingItem.customTagNames?.map((tag) => tag.name) || []}
            initialOutlinePointId={editingItem.outlinePointId}
            allowedTags={allowedTags}
            sermonOutline={sermon?.outline}
            containerSection={addingThoughtToSection || Object.keys(containers).find(key => 
              containers[key].some(item => item.id === editingItem.id)
            )}
            onSave={handleSaveEdit}
            onClose={handleCloseEdit}
          />
        )}
      </div>
    </div>
  );
}
