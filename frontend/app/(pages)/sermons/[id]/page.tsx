"use client";

import { useState, useEffect, useRef, useCallback } from "react"; // Import useCallback
import { useParams, useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import type { Sermon, Thought, Outline } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@/components/navigation/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { getTags } from "@/services/tag.service";
import useSermon from "@/hooks/useSermon";
import ThoughtCard from "@components/ThoughtCard";
import AddThoughtManual from "@components/AddThoughtManual";
import EditThoughtModal from "@components/EditThoughtModal";
import SermonHeader from "@/components/sermon/SermonHeader"; // Import the SermonHeader
import KnowledgeSection from "@/components/sermon/KnowledgeSection";
import StructureStats from "@/components/sermon/StructureStats";
import StructurePreview from "@/components/sermon/StructurePreview";
import SermonOutline from "@/components/sermon/SermonOutline";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getContrastColor } from "@utils/color";
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import ThoughtFilterControls from '@/components/sermon/ThoughtFilterControls';
import { STRUCTURE_TAGS } from '@lib/constants';
import ThoughtList from '@/components/sermon/ThoughtList'; // Import the new list component
export const dynamic = "force-dynamic";

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

export default function SermonPage() {
  const { id } = useParams<{ id: string }>();
  const { sermon, setSermon, loading, refreshSermon } = useSermon(id);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false); // Keep this state for dropdown visibility

  // Use the custom hook for filtering logic
  const { 
    filteredThoughts, 
    activeCount, 
    viewFilter, 
    setViewFilter, 
    structureFilter, 
    setStructureFilter, 
    tagFilters, 
    toggleTagFilter, 
    resetFilters, 
    sortOrder, 
    setSortOrder, 
    hasStructureTags 
  } = useThoughtFiltering({
    initialThoughts: sermon?.thoughts ?? [],
    sermonStructure: sermon?.structure // Pass structure to hook
  });
  
  // Ref for the filter toggle button (passed to controls)
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchAllowedTags = async () => {
      if (sermon) {
        try {
          const tagData = await getTags(sermon.userId);
          const combinedTags = [
            ...tagData.requiredTags.map((t: any) => ({ name: t.name, color: t.color })),
            ...tagData.customTags.map((t: any) => ({ name: t.name, color: t.color })),
          ];
          setAllowedTags(combinedTags);
        } catch (error) {
          console.error("Error fetching allowed tags:", error);
        }
      }
    };
    fetchAllowedTags();
  }, [sermon]);

  // Calculate the number of thoughts for each outline point
  const calculateThoughtsPerOutlinePoint = () => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return {};
    
    const counts: Record<string, number> = {};
    
    // Count thoughts for each outline point ID
    sermon.thoughts.forEach(thought => {
      if (thought.outlinePointId) {
        counts[thought.outlinePointId] = (counts[thought.outlinePointId] || 0) + 1;
      }
    });
    
    return counts;
  };

  const thoughtsPerOutlinePoint = calculateThoughtsPerOutlinePoint();

  // Проверяем, есть ли мысли с несогласованностью между тегами и назначенными пунктами плана
  const checkForInconsistentThoughts = (): boolean => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return false;
    
    // Соответствие между секциями и тегами
    const sectionTagMapping: Record<string, string> = {
      'introduction': STRUCTURE_TAGS.INTRODUCTION,
      'main': STRUCTURE_TAGS.MAIN_BODY,
      'conclusion': STRUCTURE_TAGS.CONCLUSION
    };
    
    // Список обязательных тегов для проверки
    const requiredTags = Object.values(sectionTagMapping);
    
    // Проверяем каждую мысль
    return sermon.thoughts.some(thought => {
      // 1. Проверка на несколько обязательных тегов у одной мысли
      const usedRequiredTags = thought.tags.filter(tag => requiredTags.includes(tag));
      if (usedRequiredTags.length > 1) {
        return true; // Несогласованность: несколько обязательных тегов
      }
      
      // 2. Проверка на несогласованность между тегом и назначенным пунктом плана
      if (!thought.outlinePointId) return false; // Если нет назначенного пункта плана, нет и проблемы
      
      // Определяем секцию пункта плана
      let outlinePointSection: string | undefined;
      
      if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'introduction';
      } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'main';
      } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'conclusion';
      }
      
      if (!outlinePointSection) return false; // Если не нашли секцию, считаем что проблемы нет
      
      // Получаем ожидаемый тег для текущей секции
      const expectedTag = sectionTagMapping[outlinePointSection];
      if (!expectedTag) return false; // Если неизвестная секция, считаем что все в порядке
      
      // Проверяем, имеет ли мысль тег соответствующей секции
      const hasExpectedTag = thought.tags.includes(expectedTag);
      
      // Проверяем, имеет ли мысль теги других секций
      const hasOtherSectionTags = Object.values(sectionTagMapping)
        .filter(tag => tag !== expectedTag)
        .some(tag => thought.tags.includes(tag));
      
      // Несогласованность, если нет ожидаемого тега или есть теги других секций
      return !(!hasOtherSectionTags || hasExpectedTag);
    });
  };
  
  // Проверяем наличие несогласованностей
  const hasInconsistentThoughts = checkForInconsistentThoughts();

  // Function to update only the outline part of the sermon state
  const handleOutlineUpdate = (updatedOutline: Outline) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        outline: updatedOutline,
      };
    });
  };

  // Callback function to update sermon state after title edit
  const handleSermonUpdate = useCallback((updatedSermon: Sermon) => {
    setSermon(updatedSermon);
  }, [setSermon]);

  if (loading || !sermon) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          {isMounted ? (
            <>
              <h2 className="text-xl font-semibold">{t('settings.loading')}</h2>
              <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
                {t('sermon.backToList')}
              </Link>
            </>
          ) : (
            <div className="animate-pulse">
              <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!sermon.thoughts) {
    sermon.thoughts = [];
  }
  const totalThoughts = sermon.thoughts.length;
  const tagCounts = {
    [STRUCTURE_TAGS.INTRODUCTION]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.INTRODUCTION) ? 1 : 0),
      0
    ),
    [STRUCTURE_TAGS.MAIN_BODY]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.MAIN_BODY) ? 1 : 0),
      0
    ),
    [STRUCTURE_TAGS.CONCLUSION]: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes(STRUCTURE_TAGS.CONCLUSION) ? 1 : 0),
      0
    ),
  };

  const handleNewRecording = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id);
      const newThought: Thought = { ...thoughtResponse };
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...(prevSermon.thoughts ?? [])] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert(t('errors.audioProcessing'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (thoughtId: string) => {
    const thoughtToDelete = sermon.thoughts.find(t => t.id === thoughtId);
    if (!thoughtToDelete) {
      console.error("Could not find thought with ID:", thoughtId);
      alert(t('errors.thoughtDeleteError'));
      return;
    }
    
    const confirmed = window.confirm(t('sermon.deleteThoughtConfirm', { text: thoughtToDelete.text }));
    if (!confirmed) return;
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon((prevSermon) => prevSermon ? {
        ...prevSermon,
        thoughts: prevSermon.thoughts.filter(t => t.id !== thoughtId),
      } : null);
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert(t('errors.thoughtDeleteError'));
    }
  };

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!editingModalData) return;
    const originalThoughtId = editingModalData.thought.id;

    const thoughtIndex = sermon.thoughts.findIndex(t => t.id === originalThoughtId);
    if (thoughtIndex === -1) {
      console.error("Could not find thought with ID:", originalThoughtId);
      alert(t('errors.thoughtUpdateError'));
      setEditingModalData(null);
      return;
    }
    
    const thoughtToUpdate = sermon.thoughts[thoughtIndex];
    const updatedThoughtData = { 
      ...thoughtToUpdate, 
      text: updatedText.trim(), 
      tags: updatedTags,
      outlinePointId
    };

    try {
      await updateThought(sermon.id, updatedThoughtData);
      setSermon((prevSermon) => {
        if (!prevSermon) return null;
        const newThoughts = [...prevSermon.thoughts];
        newThoughts[thoughtIndex] = updatedThoughtData;
        return { ...prevSermon, thoughts: newThoughts };
      });
      setEditingModalData(null);
    } catch (error) {
      console.error("Failed to update thought", error);
      alert(t('errors.thoughtUpdateError'));
    }
  };

  const handleNewManualThought = (newThought: Thought) => {
    setSermon((prevSermon) => prevSermon ? {
      ...prevSermon,
      thoughts: [newThought, ...(prevSermon.thoughts ?? [])],
    } : null);
  };

  const handleEditThoughtStart = (thought: Thought, index: number) => {
    setEditingModalData({ thought, index });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <GuestBanner />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">
        <SermonHeader sermon={sermon} onUpdate={handleSermonUpdate} />
        
        <AudioRecorder onRecordingComplete={handleNewRecording} isProcessing={isProcessing} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {activeCount} / {totalThoughts}
                  </span>
                  
                  <div className="relative ml-0 sm:ml-3">
                    <button
                      ref={filterButtonRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFilterOpen(!isFilterOpen);
                      }}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                      data-testid="thought-filter-button"
                    >
                      {t('filters.filter')}
                      {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                        <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                      )}
                      <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    <ThoughtFilterControls 
                      isOpen={isFilterOpen}
                      setIsOpen={setIsFilterOpen}
                      viewFilter={viewFilter}
                      setViewFilter={setViewFilter}
                      structureFilter={structureFilter}
                      setStructureFilter={setStructureFilter}
                      tagFilters={tagFilters}
                      toggleTagFilter={toggleTagFilter}
                      resetFilters={resetFilters}
                      sortOrder={sortOrder}
                      setSortOrder={setSortOrder}
                      allowedTags={allowedTags}
                      hasStructureTags={hasStructureTags}
                      buttonRef={filterButtonRef}
                    />
                  </div>
                </div>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-5">
                {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                  <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      {t('filters.activeFilters')}:
                    </span>
                    
                    {viewFilter === 'missingTags' && (
                      <span className="px-2 py-1 text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                        {t('filters.missingTags')}
                      </span>
                    )}
                    
                    {structureFilter !== 'all' && (
                      <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full">
                        {t(`tags.${structureFilter.toLowerCase().replace(/\s+/g, '_')}`)}
                      </span>
                    )}
                    
                    {sortOrder === 'structure' && (
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                        {t('filters.sortByStructure') || 'Sorted by Structure'}
                      </span>
                    )}
                    
                    {tagFilters.map((tag: string) => {
                      const tagInfo = allowedTags.find(t => t.name === tag);
                      return (
                        <span 
                          key={tag}
                          className="px-2 py-1 text-xs rounded-full"
                          style={{ 
                            backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0',
                            color: tagInfo ? getContrastColor(tagInfo.color) : '#000000' 
                          }}
                        >
                          {tag}
                        </span>
                      );
                    })}
                    
                    <button 
                      onClick={resetFilters}
                      className="ml-auto mt-2 sm:mt-0 px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md transition-colors"
                    >
                      {t('filters.clear')}
                    </button>
                  </div>
                )}
                
                <ThoughtList
                  filteredThoughts={filteredThoughts}
                  totalThoughtsCount={totalThoughts}
                  allowedTags={allowedTags}
                  sermonOutline={sermon?.outline}
                  onDelete={handleDeleteThought}
                  onEditStart={handleEditThoughtStart}
                  resetFilters={resetFilters}
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <StructureStats 
              sermon={sermon} 
              tagCounts={tagCounts} 
              totalThoughts={totalThoughts} 
              hasInconsistentThoughts={hasInconsistentThoughts} 
            />
            <KnowledgeSection sermon={sermon} updateSermon={handleSermonUpdate}/>
            <SermonOutline 
              sermon={sermon} 
              thoughtsPerOutlinePoint={thoughtsPerOutlinePoint} 
              onOutlineUpdate={handleOutlineUpdate}
            />
            {sermon.structure && <StructurePreview sermon={sermon} />}
          </div>
        </div>
      </div>
      {editingModalData && (
        <EditThoughtModal
          thoughtId={editingModalData.thought.id}
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          initialOutlinePointId={editingModalData.thought.outlinePointId}
          allowedTags={allowedTags}
          sermonOutline={sermon.outline}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
    </div>
  );
}