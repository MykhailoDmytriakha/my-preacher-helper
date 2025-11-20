// External libraries
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';

// Path alias imports
import type { Sermon, SermonOutline, SermonPoint } from '@/models/models';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import { CheckIcon, XMarkIcon, PencilIcon, TrashIcon, Bars3Icon } from '@heroicons/react/24/outline';
import { getSermonOutline, updateSermonOutline } from '@/services/outline.service';
import { getSectionStyling } from '@/utils/themeColors';
import { getSectionLabel } from '@lib/sections';
import Link from 'next/link';
import { getFocusModeUrl } from '@/utils/urlUtils';

interface SermonOutlineProps {
  sermon: Sermon;
  thoughtsPerSermonPoint?: Record<string, number>;
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void;
}

// Define valid section types
type SectionType = 'introduction' | 'mainPart' | 'conclusion';

const SermonOutline: React.FC<SermonOutlineProps> = ({ sermon, thoughtsPerSermonPoint = {}, onOutlineUpdate }) => {
  const { t } = useTranslation();
  
  // --- All useState hooks at the top ---
  const [loading, setLoading] = useState<boolean>(true);
    const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionPoints, setSectionPoints] = useState<Record<SectionType, SermonPoint[]>>({
    introduction: [],
    mainPart: [],
    conclusion: [],
  });
  const [expandedSections, setExpandedSections] = useState<Record<SectionType, boolean>>({
    introduction: false,
    mainPart: false,
    conclusion: false,
  });
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [addingNewToSection, setAddingNewToSection] = useState<SectionType | null>(null);
  const [newPointTexts, setNewPointTexts] = useState<Record<SectionType, string>>({
    introduction: '',
    mainPart: '',
    conclusion: '',
  });

  // --- All useRef hooks after useState ---
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // --- All useEffect hooks after useState and useRef ---
  // Focus input when starting to add/edit
  useEffect(() => {
    if (addingNewToSection && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingNewToSection]);

  useEffect(() => {
    if (editingPointId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingPointId]);
  
  // Fetch outline data when the component mounts or sermon ID changes
  useEffect(() => {
    const fetchOutline = async () => {
      if (!sermon || !sermon.id) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const outlineData = await getSermonOutline(sermon.id);
        
        if (outlineData) {
          // Map the API response to our component state structure
          const mappedOutline = {
            introduction: outlineData.introduction || [],
            mainPart: outlineData.main || [], // Note the field name difference
            conclusion: outlineData.conclusion || [],
          };
          
          setSectionPoints(mappedOutline);
          
          // Auto-expand sections that have content
          setExpandedSections({
            introduction: mappedOutline.introduction.length > 0,
            mainPart: mappedOutline.mainPart.length > 0,
            conclusion: mappedOutline.conclusion.length > 0,
          });
        } else {
          // Initialize with empty arrays if no data is returned
          setSectionPoints({
            introduction: [],
            mainPart: [],
            conclusion: [],
          });
          
          // Keep all sections collapsed if empty
          setExpandedSections({
            introduction: false,
            mainPart: false,
            conclusion: false,
          });
        }
      } catch (err) {
        console.error("Error fetching sermon outline:", err);
        setError(t('errors.fetchOutlineError'));
      } finally {
        setLoading(false);
      }
    };
    
    fetchOutline();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sermon?.id]);
  
  // Handlers for managing points
  const addPoint = async (section: SectionType) => {
    if (!newPointTexts[section].trim()) {
      setAddingNewToSection(null); // Close if empty
      return;
    }
    
    const newPoint = {
      id: Date.now().toString(),
      text: newPointTexts[section].trim(),
    };
    
    // Create new points array for this section
    const updatedSectionArray = [...sectionPoints[section], newPoint];
    
    // Create a new object instead of modifying the existing one
    const updatedSectionPoints = {
      ...sectionPoints,
      [section]: updatedSectionArray,
    };
    
    // Clear input and reset adding state before state update
    setNewPointTexts({
      ...newPointTexts,
      [section]: '',
    });
    setAddingNewToSection(null);
    
    // Make sure section is expanded when adding a new point
    if (!expandedSections[section]) {
      setExpandedSections({
        ...expandedSections,
        [section]: true,
      });
    }
    
    // Update state
    setSectionPoints(updatedSectionPoints);
    
    // Directly pass the updated data to saveOutlineChanges
    directlySaveOutlineChanges(updatedSectionPoints);
  };
  
  // Direct save function that takes the updated points to save
  const directlySaveOutlineChanges = (pointsToSave: Record<SectionType, SermonPoint[]>) => {
    // Clear any existing timeout to debounce saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    // Ensure we have the latest state by delaying the save
    saveTimeoutRef.current = setTimeout(async () => {
      if (!sermon || !sermon.id) {
        console.error('Cannot save outline: sermon or sermon.id is undefined');
        return;
      }
      
      if (saving) {
        // Retry after the current save is done
        saveTimeoutRef.current = setTimeout(() => directlySaveOutlineChanges(pointsToSave), 500);
        return;
      }
      
      setSaving(true);
      setError(null);
      
      try {
        // Convert our component state structure to the API expected format
        // Important: Using the explicitly passed data, not relying on state
        const outlineToSave: SermonOutline = {
          introduction: pointsToSave.introduction,
          main: pointsToSave.mainPart, // Map mainPart to main for API
          conclusion: pointsToSave.conclusion,
        };
        
        await updateSermonOutline(sermon.id, outlineToSave);
        onOutlineUpdate?.(outlineToSave);
      } catch (err) {
        console.error("Error saving sermon outline:", err);
        setError(t('errors.saveOutlineError'));
      } finally {
        setSaving(false);
      }
    }, 100); // Shorter timeout since we're using direct data
  };
  

  
  const toggleSection = (section: SectionType) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    });
  };
  
  // Handle outside clicks to close the add point form
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (addInputRef.current && !addInputRef.current.contains(event.target as Node)) {
        setAddingNewToSection(null);
      }
    }
    
    // Only add the event listener if we're adding a new point
    if (addingNewToSection) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [addingNewToSection]);
  
  const handleStartEdit = (point: SermonPoint) => {
    setEditingPointId(point.id);
    setEditingText(point.text); // Set initial text for editing
    setAddingNewToSection(null); // Ensure add mode is off
  };

  const handleCancelEdit = () => {
    setEditingPointId(null);
    setEditingText(""); // Clear editing text
  };

  const handleSaveEdit = () => {
    if (!editingPointId || !editingText.trim()) {
      handleCancelEdit(); // Cancel if empty
      return;
    }

    const updatedPoints = Object.entries(sectionPoints).reduce((acc, [section, points]) => {
      acc[section as SectionType] = points.map(p => 
        p.id === editingPointId ? { ...p, text: editingText.trim() } : p
      );
      return acc;
    }, {} as Record<SectionType, SermonPoint[]>);

    setSectionPoints(updatedPoints);
    handleCancelEdit(); // Exit edit mode
    directlySaveOutlineChanges(updatedPoints);
  };

  const handleDeletePoint = (pointToDelete: SermonPoint) => {
    if (window.confirm(t('structure.deletePointConfirm', { text: pointToDelete.text }))) {
      const updatedPoints = Object.entries(sectionPoints).reduce((acc, [section, points]) => {
        acc[section as SectionType] = points.filter(p => p.id !== pointToDelete.id);
        return acc;
      }, {} as Record<SectionType, SermonPoint[]>);
      
      setSectionPoints(updatedPoints);
      directlySaveOutlineChanges(updatedPoints);
    }
  };

  const handleCancelAdd = (section: SectionType) => {
    setAddingNewToSection(null);
    setNewPointTexts({
      ...newPointTexts,
      [section]: '',
    });
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    // Dropped outside the list
    if (!destination) {
      return;
    }

    const sourceSection = source.droppableId as SectionType;
    const destSection = destination.droppableId as SectionType;

    const updatedPoints = { ...sectionPoints };

    if (sourceSection === destSection) {
      // Reordering within the same section
      const sectionItems = Array.from(updatedPoints[sourceSection]);
      const [removed] = sectionItems.splice(source.index, 1);
      sectionItems.splice(destination.index, 0, removed);
      updatedPoints[sourceSection] = sectionItems;
    } else {
      // Moving between sections
      const sourceItems = Array.from(updatedPoints[sourceSection]);
      const destItems = Array.from(updatedPoints[destSection]);
      const [removed] = sourceItems.splice(source.index, 1);
      destItems.splice(destination.index, 0, removed);
      updatedPoints[sourceSection] = sourceItems;
      updatedPoints[destSection] = destItems;
    }

    setSectionPoints(updatedPoints);
    directlySaveOutlineChanges(updatedPoints);
  };
  
  // Main component return
  if (loading) {
    return <div className="text-center p-4">{t('common.loading')}</div>;
  }

  if (error) {
    return <div className="text-center p-4 text-red-500">{error}</div>;
  }

  // Function to get count of thoughts for a point
  const getThoughtCount = (pointId: string) => thoughtsPerSermonPoint[pointId] || 0;

  // Mapping for section titles
  const sectionTitles: Record<SectionType, string> = {
    introduction: getSectionLabel(t, 'introduction'),
    mainPart: getSectionLabel(t, 'mainPart'),
    conclusion: getSectionLabel(t, 'conclusion'),
  };

  // Get total thoughts count per section
  const getTotalThoughtsForSection = (sectionType: SectionType) => {
    return sectionPoints[sectionType].reduce((total, point) => {
      return total + (thoughtsPerSermonPoint[point.id] || 0);
    }, 0);
  };

  // Use the new utility to define sectionColors
  const sectionColors: Record<SectionType, ReturnType<typeof getSectionStyling>> = {
    introduction: getSectionStyling('introduction'),
    mainPart: getSectionStyling('mainPart'),
    conclusion: getSectionStyling('conclusion'),
  };

  // Render each section
  const renderSection = (sectionType: SectionType) => {
    const points = sectionPoints[sectionType] || [];
    const isExpanded = expandedSections[sectionType];
    const colors = sectionColors[sectionType];
    const totalThoughts = getTotalThoughtsForSection(sectionType);

    return (
      <div key={sectionType} data-testid={`outline-section-${sectionType}`} className={`mb-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border ${colors.border}`}>
        {/* Section Header */}
        <div 
          className={`flex justify-between items-center w-full p-3 text-left font-semibold text-gray-700 dark:text-gray-200 ${colors.headerBg} rounded-t-lg ${colors.headerHover}`}
        >
          {/* Toggle (title + counters) */}
          <button
            onClick={() => toggleSection(sectionType)}
            className="flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            <span>{sectionTitles[sectionType]}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${colors.badge}`}>
              {points.length}
            </span>
            {totalThoughts > 0 && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {totalThoughts} {t('structure.entries')}
              </span>
            )}
            <ChevronDownIcon className={`ml-2 h-5 w-5 text-gray-500 dark:text-gray-400 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>

          {/* Actions: Focus mode link (same icon as ThoughtsBySection columns) */}
          <div className="flex items-center gap-2">
            <Link
              href={getFocusModeUrl(sectionType === 'mainPart' ? 'main' : sectionType, sermon.id)}
              title={t('structure.focusMode')}
              aria-label={t('structure.focusMode')}
              className="p-1 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 rounded-full transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Section Content (Collapsible) */}
        {isExpanded && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <Droppable 
              droppableId={sectionType} 
              key={sectionType}
              renderClone={(providedDraggable, snapshot, rubric) => {
                const point = points[rubric.source.index];
                return (
                  <li
                    ref={providedDraggable.innerRef}
                    {...providedDraggable.draggableProps}
                    {...providedDraggable.dragHandleProps}
                    className={`flex items-center group p-2 rounded ${colors.dragBg} shadow-lg border-2 ${colors.border}`}
                    style={providedDraggable.draggableProps.style}
                  >
                    <div className="cursor-grab mr-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                      <Bars3Icon className="h-5 w-5" />
                    </div>
                    <span className="text-sm text-gray-800 dark:text-gray-200 flex-grow mr-2">{point.text}</span>
                    {getThoughtCount(point.id) > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded-full mr-2">
                        {getThoughtCount(point.id)}
                      </span>
                    )}
                  </li>
                );
              }}
            >
              {(provided: DroppableProvided) => (
                <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                  {points.map((point, index) => (
                    <Draggable key={point.id} draggableId={point.id} index={index}>
                      {(providedDraggable: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                        <li
                          ref={providedDraggable.innerRef}
                          {...providedDraggable.draggableProps}
                          {...providedDraggable.dragHandleProps}
                          className={`flex items-center group p-2 rounded transition-colors ${snapshot.isDragging ? 'opacity-50' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          style={providedDraggable.draggableProps.style}
                        >
                          {/* Drag Handle */}
                          <div className="cursor-grab mr-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                            <Bars3Icon className="h-5 w-5" />
                          </div>
                          {/* Point Text or Edit Input */}
                          {editingPointId === point.id ? (
                            <div ref={editInputRef} className="flex-grow flex items-center space-x-1">
                              <input 
                                type="text"
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
                                className="flex-grow p-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder={t('structure.editPointPlaceholder')}
                                autoFocus
                              />
                              <button aria-label={t('common.save')} onClick={handleSaveEdit} className="p-1 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300">
                                <CheckIcon className="h-5 w-5" />
                              </button>
                              <button aria-label={t('common.cancel')} onClick={handleCancelEdit} className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">
                                <XMarkIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm text-gray-800 dark:text-gray-200 flex-grow mr-2">{point.text}</span>
                              {/* Action Buttons (Edit/Delete) - appear on hover */}
                              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button aria-label={t('common.edit')} onClick={() => handleStartEdit(point)} className="p-1 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400">
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button aria-label={t('common.delete')} onClick={() => handleDeletePoint(point)} className="p-1 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400">
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                              {/* Thought count badge */}
                              {getThoughtCount(point.id) > 0 && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded-full ml-2">
                                  {getThoughtCount(point.id)}
                                </span>
                              )}
                            </>
                          )}
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>

            {/* Add New Point Section */}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
               {addingNewToSection === sectionType ? (
                 <div ref={addInputRef} className="flex items-center space-x-1">
                  <input
                    type="text"
                    value={newPointTexts[sectionType]}
                    onChange={(e) => setNewPointTexts({...newPointTexts, [sectionType]: e.target.value})}
                    onKeyDown={(e) => { if (e.key === 'Enter') addPoint(sectionType); if (e.key === 'Escape') handleCancelAdd(sectionType); }}
                    placeholder={t('structure.addPointPlaceholder')}
                    className="flex-grow p-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                    autoFocus
                  />
                  <button aria-label={t('common.save')} onClick={() => addPoint(sectionType)} className="p-1 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300">
                    <CheckIcon className="h-5 w-5" />
                  </button>
                  <button aria-label={t('common.cancel')} onClick={() => handleCancelAdd(sectionType)} className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                  <button 
                    onClick={() => { setAddingNewToSection(sectionType); setEditingPointId(null); /* Close edit mode */ }}
                    aria-label={t('structure.addPointButton')}
                    className="flex items-center justify-center w-full p-2 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                  >
                    <PlusIcon className="h-4 w-4 mr-1" />
                    {t('structure.addPointButton')}
                  </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="mt-4">
        {renderSection('introduction')}
        {renderSection('mainPart')}
        {renderSection('conclusion')}
      </div>
    </DragDropContext>
  );
};

export default SermonOutline; 
