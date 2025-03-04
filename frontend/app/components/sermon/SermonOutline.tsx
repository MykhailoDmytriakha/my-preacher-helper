// External libraries
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

// Path alias imports
import type { Sermon, Outline, OutlinePoint } from '@/models/models';
import { ChevronIcon } from '@components/Icons';
import { getSermonOutline, updateSermonOutline } from '@/services/outline.service';

interface SermonOutlineProps {
  sermon: Sermon;
}

// Define valid section types
type SectionType = 'introduction' | 'mainPart' | 'conclusion';

const SermonOutline: React.FC<SermonOutlineProps> = ({ sermon }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [saveQueue, setSaveQueue] = useState<number>(0);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // State for outline data
  const [sectionPoints, setSectionPoints] = useState<Record<SectionType, OutlinePoint[]>>({
    introduction: [],
    mainPart: [],
    conclusion: [],
  });
  
  // Fetch outline data when the component mounts or sermon changes
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
        } else {
          // Initialize with empty arrays if no data is returned
          setSectionPoints({
            introduction: [],
            mainPart: [],
            conclusion: [],
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
  }, [sermon, t]);
  
  // Handlers for managing points
  const addPoint = async (section: SectionType) => {
    if (!newPointTexts[section].trim()) return;
    
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
  const directlySaveOutlineChanges = (pointsToSave: Record<SectionType, OutlinePoint[]>) => {
    // Clear any existing timeout to debounce saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    // Increment save queue to track pending saves
    setSaveQueue(prev => prev + 1);
    
    // Ensure we have the latest state by delaying the save
    saveTimeoutRef.current = setTimeout(async () => {
      if (!sermon || !sermon.id) {
        console.error('Cannot save outline: sermon or sermon.id is undefined');
        setSaveQueue(prev => Math.max(0, prev - 1));
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
        const outlineToSave: Outline = {
          introduction: pointsToSave.introduction,
          main: pointsToSave.mainPart, // Map mainPart to main for API
          conclusion: pointsToSave.conclusion,
        };
        
        const result = await updateSermonOutline(sermon.id, outlineToSave);
      } catch (err) {
        console.error("Error saving sermon outline:", err);
        setError(t('errors.saveOutlineError'));
      } finally {
        setSaving(false);
        setSaveQueue(prev => Math.max(0, prev - 1));
      }
    }, 100); // Shorter timeout since we're using direct data
  };
  
  // Original save function now just passes current state
  const saveOutlineChanges = () => {
    directlySaveOutlineChanges(sectionPoints);
  };
  
  // Track expanded sections - all expanded by default
  const [expandedSections, setExpandedSections] = useState<Record<SectionType, boolean>>({
    introduction: true,
    mainPart: true,
    conclusion: true,
  });
  
  const toggleSection = (section: SectionType) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    });
  };
  
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  // Track which section is in "add new" mode
  const [addingNewToSection, setAddingNewToSection] = useState<SectionType | null>(null);
  
  const [newPointTexts, setNewPointTexts] = useState<Record<SectionType, string>>({
    introduction: '',
    mainPart: '',
    conclusion: '',
  });
  
  // Create a ref for the active add input field
  const addInputRef = useRef<HTMLDivElement>(null);
  
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
  
  const updatePoint = async (section: SectionType, pointId: string, newText: string) => {
    // Create updated points array for this section
    const updatedSectionArray = sectionPoints[section].map(point => 
      point.id === pointId ? { ...point, text: newText } : point
    );
    
    const updatedSectionPoints = {
      ...sectionPoints,
      [section]: updatedSectionArray,
    };
    
    // Update state and reset editing
    setSectionPoints(updatedSectionPoints);
    setEditingPointId(null);
    
    // Save changes directly with the updated data
    directlySaveOutlineChanges(updatedSectionPoints);
  };
  
  const deletePoint = async (section: SectionType, pointId: string) => {
    // Create updated points array for this section
    const updatedSectionArray = sectionPoints[section].filter(point => point.id !== pointId);
    
    const updatedSectionPoints = {
      ...sectionPoints,
      [section]: updatedSectionArray,
    };
    
    // Update state
    setSectionPoints(updatedSectionPoints);
    
    // Save changes directly with the updated data
    directlySaveOutlineChanges(updatedSectionPoints);
  };
  
  // Handle drag end event
  const handleDragEnd = (result: DropResult) => {
    const { destination, source } = result;
    
    // Return if dropped outside a droppable area or if dropped in the same position
    if (!destination || 
        (destination.droppableId === source.droppableId && 
         destination.index === source.index)) {
      return;
    }
    
    const sourceSection = source.droppableId as SectionType;
    const destinationSection = destination.droppableId as SectionType;
    
    // Create a copy of the current points
    const updatedSectionPoints = { ...sectionPoints };
    
    // Remove the item from the source section
    const [movedItem] = updatedSectionPoints[sourceSection].splice(source.index, 1);
    
    // Add the item to the destination section
    updatedSectionPoints[destinationSection].splice(destination.index, 0, movedItem);
    
    // Update state
    setSectionPoints(updatedSectionPoints);
    
    // Save changes
    directlySaveOutlineChanges(updatedSectionPoints);
  };
  
  const renderSection = (section: SectionType, title: string, icon: React.ReactNode) => (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Section header with toggle */}
      <div 
        className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 cursor-pointer"
        onClick={() => toggleSection(section)}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-medium text-lg">{title}</h3>
          <div className="flex items-center justify-center w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-300">
            {sectionPoints[section].length}
          </div>
        </div>
        <div className={`transform transition-transform duration-200 ${expandedSections[section] ? 'rotate-180' : ''}`}>
          <ChevronIcon className="text-gray-500 dark:text-gray-400" />
        </div>
      </div>
      
      {/* Section content - conditionally displayed */}
      {expandedSections[section] && (
        <div className="p-4">
          {loading ? (
            <div className="py-3 space-y-2 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-5/6"></div>
            </div>
          ) : sectionPoints[section].length > 0 ? (
            <Droppable droppableId={section}>
              {(provided) => (
                <ul 
                  className="space-y-2 mb-4"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  {sectionPoints[section].map((point, index) => (
                    <Draggable key={point.id} draggableId={point.id} index={index}>
                      {(provided, snapshot) => (
                        <li 
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          key={point.id} 
                          className={`group flex items-center gap-2 p-2 rounded transition-colors relative overflow-hidden
                                     ${snapshot.isDragging 
                                       ? 'bg-blue-50 dark:bg-blue-900 shadow-lg' 
                                       : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                        >
                          <div 
                            {...provided.dragHandleProps}
                            className="cursor-grab active:cursor-grabbing p-1 -ml-1 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            title={t('common.dragToReorder')}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                            </svg>
                          </div>

                          <span className="font-medium text-gray-600 dark:text-gray-300 shrink-0 flex items-center">{index + 1}.</span>
                          
                          {editingPointId === point.id ? (
                            <div className="flex-1">
                              <input 
                                type="text" 
                                value={point.text} 
                                onChange={(e) => {
                                  setSectionPoints({
                                    ...sectionPoints,
                                    [section]: sectionPoints[section].map(p => 
                                      p.id === point.id ? { ...p, text: e.target.value } : p
                                    ),
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    updatePoint(section, point.id, point.text);
                                  } else if (e.key === 'Escape') {
                                    setEditingPointId(null);
                                  }
                                }}
                                className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800"
                                autoFocus
                              />
                              <div className="flex space-x-2 mt-2">
                                <button 
                                  onClick={() => updatePoint(section, point.id, point.text)}
                                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  {saving ? t('common.saving') : t('buttons.save')}
                                </button>
                                <button 
                                  onClick={() => setEditingPointId(null)}
                                  className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-white rounded hover:bg-gray-400 dark:hover:bg-gray-500"
                                >
                                  {t('buttons.cancel')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="flex-1 text-gray-700 dark:text-gray-300 min-w-0 pr-2 flex items-center">{point.text}</p>
                              <div 
                                className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute right-2 top-1/2 transform -translate-y-1/2 rounded p-0.5"
                                style={{ backgroundColor: 'inherit' }}
                              >
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingPointId(point.id);
                                  }}
                                  className="p-1 text-blue-600 rounded"
                                  title={t('common.edit')}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                  </svg>
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePoint(section, point.id);
                                  }}
                                  className="p-1 text-red-600 rounded"
                                  title={t('common.delete')}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
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
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400 py-3 mb-4">
              {icon}
              <p className="text-sm">{t('structure.noEntries')}</p>
            </div>
          )}
          
          {/* Error message if saving/loading failed */}
          {error && (
            <div className="mb-4 p-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm rounded">
              {error}
            </div>
          )}
          
          {/* Minimalist approach for adding new points - now section-specific */}
          {addingNewToSection === section ? (
            <div className="mt-2" ref={addInputRef}>
              <input 
                type="text" 
                value={newPointTexts[section]}
                onChange={(e) => setNewPointTexts({
                  ...newPointTexts, 
                  [section]: e.target.value
                })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPointTexts[section].trim()) {
                    addPoint(section);
                  } else if (e.key === 'Escape') {
                    setAddingNewToSection(null);
                  }
                }}
                placeholder={t('common.addPoint')}
                className="w-full border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 text-sm"
                autoFocus
              />
              <div className="flex justify-end space-x-2 mt-2">
                <button 
                  onClick={() => setAddingNewToSection(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {t('buttons.cancel')}
                </button>
                <button 
                  onClick={() => {
                    if (newPointTexts[section].trim()) {
                      addPoint(section);
                    }
                  }}
                  disabled={!newPointTexts[section].trim() || saving}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:text-gray-400 disabled:dark:text-gray-600"
                >
                  {saving ? t('common.saving') : t('common.add')}
                </button>
              </div>
            </div>
          ) : (
            <div 
              onClick={() => setAddingNewToSection(section)}
              className="mt-3 border-t border-dashed border-gray-300 dark:border-gray-600 pt-2 flex justify-center cursor-pointer opacity-50 hover:opacity-100 transition-opacity group"
            >
              <span className="w-6 h-6 flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
  
  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold mb-4">{t('sermon.outline')}</h2>
        
        <div className="space-y-4">
          {/* Introduction Section */}
          {renderSection(
            'introduction', 
            t('tags.introduction'),
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          
          {/* Main Part Section */}
          {renderSection(
            'mainPart',
            t('tags.mainPart'),
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          )}
          
          {/* Conclusion Section */}
          {renderSection(
            'conclusion',
            t('tags.conclusion'),
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Global save status indicator - now displayed at the top level, only once */}
        {saveQueue > 0 && (
          <div className="mb-4 p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm rounded flex items-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {t('common.saving')} ({saveQueue})
          </div>
        )}
      </div>
    </DragDropContext>
  );
};

export default SermonOutline; 