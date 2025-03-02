"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import type { Sermon, Thought } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { getTags } from "@/services/tag.service";
import useSermon from "@/hooks/useSermon";
import ThoughtCard from "@components/ThoughtCard";
import AddThoughtManual from "@/components/AddThoughtManual";
import EditThoughtModal from "@/components/EditThoughtModal";
import SermonHeader from "@/components/sermon/SermonHeader";
import KnowledgeSection from "@/components/sermon/KnowledgeSection";
import StructureStats from "@/components/sermon/StructureStats";
import StructurePreview from "@/components/sermon/StructurePreview";
import SermonOutline from "@/components/sermon/SermonOutline";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getContrastColor } from "@utils/color";
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
  const { sermon, setSermon, loading, getSortedThoughts } = useSermon(id);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewFilter, setViewFilter] = useState('all');
  const [structureFilter, setStructureFilter] = useState('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [sortOrder, setSortOrder] = useState('date');

  // Create a ref for the filter dropdown
  const filterRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside the filter dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    
    // Add event listener
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      // Remove event listener on cleanup
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [filterRef]);

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
  
  // Check if any structure tags are present in thoughts
  const hasStructureTags = sermon?.thoughts ? (
    sermon.thoughts.some(thought => 
      thought.tags.includes("Вступление") || 
      thought.tags.includes("Основная часть") || 
      thought.tags.includes("Заключение") ||
      thought.tags.includes("Вступ") ||
      thought.tags.includes("Основна частина") ||
      thought.tags.includes("Висновок")
    )
  ) : false;

  // Filter thoughts based on selected filters
  const getFilteredThoughts = () => {
    const sortedThoughts = getSortedThoughts();
    
    const filteredThoughts = sortedThoughts.filter(thought => {
      // Get required tags - these match the constants used elsewhere in the app
      const requiredTags = ["Вступление", "Основная часть", "Заключение"];
      const hasRequiredTag = thought.tags.some(tag => requiredTags.includes(tag));
      
      // Check missing required tags filter - if this filter is active,
      // we only want to show thoughts that are missing required tags
      if (viewFilter === 'missingTags' && hasRequiredTag) {
        return false;
      }
      
      // If structure filter is active, check if it matches
      if (structureFilter !== 'all' && !thought.tags.includes(structureFilter)) {
        return false;
      }
      
      // If tag filters are active, check if any match
      // Only apply tag filters if they're set
      if (tagFilters.length > 0 && !tagFilters.some(tag => thought.tags.includes(tag))) {
        return false;
      }
      
      // If we got here, all active filters matched
      return true;
    });

    // Apply structure sorting if needed
    if (sortOrder === 'structure') {
      return filteredThoughts.sort((a, b) => {
        // Define structure order based on multiple languages (Russian and Ukrainian)
        const structureOrder = ["Вступление", "Основная часть", "Заключение", "Вступ", "Основна частина", "Висновок"];
        
        // Use sermon.structure if available for precise ordering
        if (sermon && sermon.structure) {
          // Get all thought IDs in order from the structure
          const structuredIds = [
            ...(sermon.structure.introduction || []),
            ...(sermon.structure.main || []),
            ...(sermon.structure.conclusion || [])
          ];
          
          // If both thoughts are in the structure, use that order
          const aIndex = structuredIds.indexOf(a.id);
          const bIndex = structuredIds.indexOf(b.id);
          
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          
          // If only one is in the structure, prioritize it
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
        }
        
        // Fall back to tag-based sorting if structure doesn't include these thoughts
        // Get the first structure tag for each thought
        const aStructureTag = a.tags.find(tag => structureOrder.includes(tag));
        const bStructureTag = b.tags.find(tag => structureOrder.includes(tag));
        
        // If both have structure tags
        if (aStructureTag && bStructureTag) {
          // Map to canonical order (intro = 0, main = 1, conclusion = 2)
          const getCanonicalIndex = (tag: string) => {
            if (tag === "Вступление" || tag === "Вступ") return 0;
            if (tag === "Основная часть" || tag === "Основна частина") return 1;
            if (tag === "Заключение" || tag === "Висновок") return 2;
            return -1;
          };
          
          const aCanonicalIndex = getCanonicalIndex(aStructureTag);
          const bCanonicalIndex = getCanonicalIndex(bStructureTag);
          
          if (aCanonicalIndex !== bCanonicalIndex) return aCanonicalIndex - bCanonicalIndex;
        }
        
        // If only one has a structure tag, prioritize it
        if (aStructureTag && !bStructureTag) return -1;
        if (!aStructureTag && bStructureTag) return 1;
        
        // If neither has a structure tag or they have the same structure tag,
        // maintain date sorting as a secondary sort
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
    }
    
    return filteredThoughts;
  };

  // Update active count whenever filters change
  useEffect(() => {
    if (sermon && sermon.thoughts) {
      setActiveCount(getFilteredThoughts().length);
    }
  }, [sermon, viewFilter, structureFilter, tagFilters]);

  // Reset structure filter and sort order when no structure tags are present
  useEffect(() => {
    if (!hasStructureTags) {
      if (structureFilter !== 'all') {
        setStructureFilter('all');
      }
      if (sortOrder === 'structure') {
        setSortOrder('date');
      }
    }
  }, [hasStructureTags, structureFilter, sortOrder]);

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
    "Вступление": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Вступление") ? 1 : 0),
      0
    ),
    "Основная часть": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Основная часть") ? 1 : 0),
      0
    ),
    "Заключение": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Заключение") ? 1 : 0),
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
          ? { ...prevSermon, thoughts: [newThought, ...prevSermon.thoughts] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert(t('errors.audioProcessing'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (indexToDelete: number, thoughtId: string) => {
    const sortedThoughts = getSortedThoughts();
    // Find the thought by ID rather than using the index directly
    const thoughtIndex = sortedThoughts.findIndex(t => t.id === thoughtId);
    if (thoughtIndex === -1) {
      console.error("Could not find thought with ID:", thoughtId);
      alert(t('errors.thoughtDeleteError'));
      return;
    }
    
    const thoughtToDelete = sortedThoughts[thoughtIndex];
    const confirmed = window.confirm(t('sermon.deleteThoughtConfirm', { text: thoughtToDelete.text }));
    if (!confirmed) return;
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon({
        ...sermon,
        thoughts: sortedThoughts.filter(t => t.id !== thoughtId),
      });
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert(t('errors.thoughtDeleteError'));
    }
  };

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[]) => {
    if (!editingModalData) return;
    const sortedThoughts = getSortedThoughts();
    const { thought: originalThought } = editingModalData;
    
    // Find the thought by ID instead of using index
    const thoughtIndex = sortedThoughts.findIndex(t => t.id === originalThought.id);
    if (thoughtIndex === -1) {
      console.error("Could not find thought with ID:", originalThought.id);
      alert(t('errors.thoughtUpdateError'));
      return;
    }
    
    const thoughtToUpdate = sortedThoughts[thoughtIndex];
    const updatedThought = { ...thoughtToUpdate, text: updatedText.trim(), tags: updatedTags };
    try {
      await updateThought(sermon.id, updatedThought);
      sortedThoughts[thoughtIndex] = updatedThought;
      setSermon({ ...sermon, thoughts: sortedThoughts });
      setEditingModalData(null);
    } catch (error) {
      console.error("Failed to update thought", error);
      alert(t('errors.thoughtUpdateError'));
    }
  };

  const handleNewManualThought = (newThought: Thought) => {
    setSermon({ ...sermon, thoughts: [newThought, ...sermon.thoughts] });
  };

  const toggleTagFilter = (tag: string) => {
    setTagFilters(prevFilters =>
      prevFilters.includes(tag)
        ? prevFilters.filter(t => t !== tag)
        : [...prevFilters, tag]
    );
  };

  const resetFilters = () => {
    setViewFilter('all');
    setStructureFilter('all');
    setTagFilters([]);
    setSortOrder('date');
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <GuestBanner />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <SermonHeader sermon={sermon} />
        
        <AudioRecorder onRecordingComplete={handleNewRecording} isProcessing={isProcessing} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {activeCount} / {totalThoughts}
                  </span>
                  
                  <div className="relative ml-3">
                    <button
                      onClick={() => setIsFilterOpen(!isFilterOpen)}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {t('filters.filter')}
                      {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                        <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                      )}
                      <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {isFilterOpen && (
                      <div 
                        ref={filterRef}
                        className="absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10"
                      >
                        <div className="py-1 divide-y divide-gray-200 dark:divide-gray-700">
                          {/* View options */}
                          <div className="px-4 py-2">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-sm font-medium">{t('filters.viewOptions')}</h3>
                              <button 
                                onClick={() => resetFilters()}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                              >
                                {t('filters.reset')}
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  name="viewFilter"
                                  value="all"
                                  checked={viewFilter === 'all'}
                                  onChange={() => setViewFilter('all')}
                                  className="h-4 w-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.all')}</span>
                              </label>
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  name="viewFilter"
                                  value="missingTags"
                                  checked={viewFilter === 'missingTags'}
                                  onChange={() => setViewFilter('missingTags')}
                                  className="h-4 w-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.missingTags')}</span>
                              </label>
                            </div>
                          </div>
                          
                          {/* Structure filter */}
                          <div className="px-4 py-2">
                            <h3 className="text-sm font-medium">
                              {t('filters.byStructure')}
                              {!hasStructureTags && (
                                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                                  ({t('filters.noStructureTagsPresent') || 'No structure tags present'})
                                </span>
                              )}
                            </h3>
                            <div className="mt-2 space-y-2">
                              <label className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <input
                                  type="radio"
                                  name="structureFilter"
                                  value="all"
                                  checked={structureFilter === 'all'}
                                  onChange={() => setStructureFilter('all')}
                                  className="h-4 w-4 text-blue-600"
                                  disabled={!hasStructureTags}
                                />
                                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.allStructure')}</span>
                              </label>
                              {["Вступление", "Основная часть", "Заключение"].map(tag => (
                                <label key={tag} className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                  <input
                                    type="radio"
                                    name="structureFilter"
                                    value={tag}
                                    checked={structureFilter === tag}
                                    onChange={() => setStructureFilter(tag)}
                                    className="h-4 w-4 text-blue-600"
                                    disabled={!hasStructureTags}
                                  />
                                  <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t(`tags.${tag.toLowerCase()}`)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          
                          {/* Sort order */}
                          <div className="px-4 py-2">
                            <h3 className="text-sm font-medium">{t('filters.sortOrder') || 'Sort Order'}</h3>
                            <div className="mt-2 space-y-2">
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  name="sortOrder"
                                  value="date"
                                  checked={sortOrder === 'date'}
                                  onChange={() => setSortOrder('date')}
                                  className="h-4 w-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.sortByDate') || 'By Date (Newest First)'}</span>
                              </label>
                              <label className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <input
                                  type="radio"
                                  name="sortOrder"
                                  value="structure"
                                  checked={sortOrder === 'structure'}
                                  onChange={() => setSortOrder('structure')}
                                  className="h-4 w-4 text-blue-600"
                                  disabled={!hasStructureTags}
                                />
                                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                                  {t('filters.sortByStructure') || 'By Structure (Intro → Main → Conclusion)'}
                                  {!hasStructureTags && (
                                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                                      ({t('filters.requiresStructureTags') || 'Requires structure tags'})
                                    </span>
                                  )}
                                </span>
                              </label>
                            </div>
                          </div>
                          
                          {/* Tag filter */}
                          <div className="px-4 py-2">
                            <h3 className="text-sm font-medium">{t('filters.byTags')}</h3>
                            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                              {allowedTags.map(tag => (
                                <label key={tag.name} className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={tagFilters.includes(tag.name)}
                                    onChange={() => toggleTagFilter(tag.name)}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <span className="ml-2 text-sm" style={{ color: tag.color }}>{tag.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-5">
                {/* Active filters indicator */}
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
                        {t(`tags.${structureFilter.toLowerCase()}`)}
                      </span>
                    )}
                    
                    {sortOrder === 'structure' && (
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                        {t('filters.sortByStructure') || 'Sorted by Structure'}
                      </span>
                    )}
                    
                    {tagFilters.map(tag => {
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
                      className="ml-auto px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md transition-colors"
                    >
                      {t('filters.clear')}
                    </button>
                  </div>
                )}
                
                {sermon.thoughts.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <p className="mt-2 text-gray-500 dark:text-gray-400">
                      {t('sermon.noThoughts')}
                    </p>
                  </div>
                ) : (
                  getFilteredThoughts().length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="mt-2 text-gray-500 dark:text-gray-400">
                        {t('filters.noMatchingThoughts')}
                      </p>
                      <button 
                        onClick={resetFilters}
                        className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        {t('filters.resetFilters')}
                      </button>
                    </div>
                  ) : (
                    getFilteredThoughts().map((thought, index) => {
                      const requiredTags = ["Вступление", "Основная часть", "Заключение"];
                      const hasRequiredTag = thought.tags.some((tag) =>
                        requiredTags.includes(tag)
                      );

                      return (
                        <ThoughtCard
                          key={index}
                          thought={thought}
                          index={index}
                          editingIndex={null}
                          editingText={""}
                          editingTags={[]}
                          hasRequiredTag={hasRequiredTag}
                          allowedTags={allowedTags}
                          currentTag={""}
                          onDelete={(indexToDelete) => handleDeleteThought(indexToDelete, thought.id)}
                          onEditStart={(thought, index) => setEditingModalData({ thought, index })}
                          onEditCancel={() => {}}
                          onEditSave={() => {}}
                          onTextChange={() => {}}
                          onRemoveTag={() => {}}
                          onAddTag={() => {}}
                          onTagSelectorChange={() => {}}
                          setCurrentTag={() => {}}
                        />
                      );
                    })
                  )
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <StructureStats sermon={sermon} tagCounts={tagCounts} totalThoughts={totalThoughts} />
            <KnowledgeSection sermon={sermon} />
            <SermonOutline sermon={sermon} />
            {sermon.structure && <StructurePreview sermon={sermon} />}
          </div>
        </div>
      </div>
      {editingModalData && (
        <EditThoughtModal
          thoughtId={editingModalData.thought.id}
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          allowedTags={allowedTags}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
    </div>
  );
}
