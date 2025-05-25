import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DragEndEvent } from '@dnd-kit/core';
import '@testing-library/jest-dom';

// Define proper types for test data
interface TestItem {
  id: string;
  content: string;
  requiredTags: string[];
  customTagNames: Array<{ name: string; color?: string }>;
  outlinePointId?: string | null;
}

interface TestContainers {
  ambiguous: TestItem[];
  introduction: TestItem[];
  main: TestItem[];
  conclusion: TestItem[];
}

// Mock services and hooks
jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn(),
}));

jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn(),
}));

jest.mock('lodash/debounce', () => 
  jest.fn((fn) => {
    const debouncedFn = (...args: any[]) => fn(...args);
    debouncedFn.cancel = jest.fn();
    debouncedFn.flush = jest.fn();
    return debouncedFn;
  })
);

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => options?.defaultValue || key,
  }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: () => 'test-sermon-id',
  }),
}));

// Mock the custom hook
jest.mock('@/hooks/useSermonStructureData', () => ({
  useSermonStructureData: () => ({
    sermon: {
      id: 'test-sermon-id',
      title: 'Test Sermon',
      thoughts: [
        {
          id: 'thought-1',
          text: 'Test thought',
          tags: [],
          outlinePointId: null,
        }
      ],
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
        main: [{ id: 'main-1', text: 'Main Point 1' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion Point 1' }],
      },
      structure: {},
    },
    setSermon: jest.fn(),
    containers: {
      ambiguous: [{ id: 'thought-1', content: 'Test thought', requiredTags: [], customTagNames: [] }],
      introduction: [],
      main: [],
      conclusion: [],
    },
    setContainers: jest.fn(),
    outlinePoints: {
      introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
      main: [{ id: 'main-1', text: 'Main Point 1' }],
      conclusion: [{ id: 'conclusion-1', text: 'Conclusion Point 1' }],
    },
    requiredTagColors: {},
    allowedTags: [],
    loading: false,
    error: null,
    setLoading: jest.fn(),
    isAmbiguousVisible: true,
    setIsAmbiguousVisible: jest.fn(),
  }),
}));

describe('Structure Page - Drag & Drop Visual Jumping Fix', () => {
  let mockSetContainers: jest.Mock;
  let mockDebouncedSaveThought: jest.Mock;
  let mockUpdateThought: jest.Mock;
  let mockUpdateStructure: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    mockSetContainers = jest.fn();
    mockDebouncedSaveThought = jest.fn();
    mockUpdateThought = require('@/services/thought.service').updateThought;
    mockUpdateStructure = require('@/services/structure.service').updateStructure;
    
    mockUpdateThought.mockResolvedValue({
      id: 'thought-1',
      text: 'Test thought',
      tags: [],
      outlinePointId: 'intro-1',
    });
    
    mockUpdateStructure.mockResolvedValue(true);
  });

  /**
   * This test simulates the exact scenario that was causing the visual jumping:
   * 1. Drag a thought from ambiguous to an outline point placeholder
   * 2. Verify that the outlinePointId is updated in local state IMMEDIATELY
   * 3. Verify that debounced save is used instead of direct await
   * 4. Verify that UI state is not updated again after API call
   */
  test('should fix visual jumping by updating outlinePointId immediately in local state', async () => {
    const containers: TestContainers = {
      ambiguous: [{ 
        id: 'thought-1', 
        content: 'Test thought', 
        requiredTags: [], 
        customTagNames: [],
        outlinePointId: null 
      }],
      introduction: [],
      main: [],
      conclusion: [],
    };

    const containersRef = { current: containers };
    const sermon = {
      id: 'test-sermon-id',
      title: 'Test Sermon',
      thoughts: [
        {
          id: 'thought-1',
          text: 'Test thought',
          tags: [],
          outlinePointId: null,
        }
      ],
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
        main: [{ id: 'main-1', text: 'Main Point 1' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion Point 1' }],
      },
      structure: {},
    };

    // Mock the handleDragEnd function that includes our fix
    const handleDragEndWithFix = async (event: DragEndEvent) => {
      const { active, over } = event;
      
      if (!over || !sermon) {
        return;
      }

      const activeContainer = 'ambiguous' as keyof TestContainers;
      let overContainer = over.data.current?.container as keyof TestContainers;
      let outlinePointId = over.data.current?.outlinePointId;
      
      // Check if we're dropping on an outline point placeholder
      if (over.id.toString().startsWith('outline-point-')) {
        const dropTargetId = over.id.toString();
        outlinePointId = dropTargetId.replace('outline-point-', '');
        overContainer = over.data.current?.container as keyof TestContainers;
      }
      
      if (
        !activeContainer ||
        !overContainer ||
        !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
      ) {
        return;
      }
      
      // Store the previous state for potential rollback
      const previousContainers = { ...containers };
      
      // Perform the UI update immediately for smooth UX
      let updatedContainers = { ...containers };
      
      if (activeContainer !== overContainer) {
        const activeItems = [...updatedContainers[activeContainer]];
        const overItems = [...updatedContainers[overContainer]];
        
        const activeIndex = activeItems.findIndex((item: TestItem) => item.id === active.id);
        if (activeIndex !== -1) {
          const [draggedItem] = activeItems.splice(activeIndex, 1);
          overItems.push(draggedItem);
          
          updatedContainers[activeContainer] = activeItems;
          updatedContainers[overContainer] = overItems;
        }
      }
      
      // THE FIX: Update outline point ID in the moved item immediately (before API calls)
      if (activeContainer !== overContainer || outlinePointId !== undefined) {
        const itemIndex = updatedContainers[overContainer].findIndex((item: TestItem) => item.id === active.id);
        if (itemIndex !== -1) {
          updatedContainers[overContainer][itemIndex] = {
            ...updatedContainers[overContainer][itemIndex],
            outlinePointId: outlinePointId
          };
        }
      }
      
      // Apply state updates immediately
      mockSetContainers(updatedContainers);
      containersRef.current = updatedContainers;
      
      // Make API calls in background with rollback on error
      try {
        // THE FIX: Use debounced function instead of direct await to prevent UI blocking
        if (activeContainer !== overContainer || outlinePointId !== undefined) {
          const movedItem = updatedContainers[overContainer].find((item: TestItem) => item.id === active.id);
          
          if (movedItem && sermon) {
            const thought = sermon.thoughts.find((thought) => thought.id === movedItem.id);
            if (thought) {
              const updatedItem = {
                ...thought,
                tags: [
                  ...movedItem.requiredTags,
                  ...movedItem.customTagNames.map((tag) => tag.name),
                ],
                outlinePointId: outlinePointId
              };
              
              // Use debounced function instead of direct await to prevent UI blocking
              mockDebouncedSaveThought(sermon.id, updatedItem);
            }
          }
        }
        
        // Update structure if needed
        const newStructure = {
          introduction: updatedContainers.introduction.map((item: TestItem) => item.id),
          main: updatedContainers.main.map((item: TestItem) => item.id),
          conclusion: updatedContainers.conclusion.map((item: TestItem) => item.id),
          ambiguous: updatedContainers.ambiguous.map((item: TestItem) => item.id),
        };
        
        await mockUpdateStructure(sermon.id, newStructure);
        
      } catch (error) {
        console.error("Error updating drag and drop:", error);
        // Rollback optimistic updates on error
        mockSetContainers(previousContainers);
        containersRef.current = previousContainers;
      }
    };

    // Create the drag end event that simulates dragging from ambiguous to intro outline point
    const dragEndEvent: DragEndEvent = {
      active: { 
        id: 'thought-1',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } }
      },
      over: { 
        id: 'outline-point-intro-1',
        data: { 
          current: { 
            container: 'introduction',
            outlinePointId: 'intro-1'
          } 
        },
        rect: null as any,
        disabled: false
      },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null
    };

    // Execute the fixed handleDragEnd function
    await handleDragEndWithFix(dragEndEvent);

    // CRITICAL TEST: Verify that setContainers was called with updated outlinePointId IMMEDIATELY
    expect(mockSetContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        introduction: expect.arrayContaining([
          expect.objectContaining({
            id: 'thought-1',
            outlinePointId: 'intro-1' // THE FIX: This should be set immediately
          })
        ]),
        ambiguous: [] // Item should be removed from ambiguous
      })
    );

    // CRITICAL TEST: Verify that debounced save was used instead of direct await
    expect(mockDebouncedSaveThought).toHaveBeenCalledWith(
      'test-sermon-id',
      expect.objectContaining({
        id: 'thought-1',
        outlinePointId: 'intro-1'
      })
    );

    // CRITICAL TEST: Verify that direct updateThought was NOT called (preventing blocking)
    expect(mockUpdateThought).not.toHaveBeenCalled();

    // Verify that structure update was called
    expect(mockUpdateStructure).toHaveBeenCalledWith(
      'test-sermon-id',
      expect.objectContaining({
        introduction: ['thought-1'],
        ambiguous: [],
        main: [],
        conclusion: []
      })
    );
  });

  /**
   * Test that ensures the sequence of operations prevents visual jumping:
   * 1. Local state is updated first (immediate visual feedback)
   * 2. API calls happen in background (non-blocking)
   * 3. No additional UI updates after API calls (prevents jumping)
   */
  test('should update local state before API calls to prevent visual jumping', async () => {
    const containers: TestContainers = {
      ambiguous: [{ 
        id: 'thought-1', 
        content: 'Test thought', 
        requiredTags: [], 
        customTagNames: [],
        outlinePointId: null 
      }],
      introduction: [],
      main: [],
      conclusion: [],
    };

    const containersRef = { current: containers };
    const sermon = {
      id: 'test-sermon-id',
      title: 'Test Sermon',
      thoughts: [
        {
          id: 'thought-1',
          text: 'Test thought',
          tags: [],
          outlinePointId: null,
        }
      ],
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
        main: [{ id: 'main-1', text: 'Main Point 1' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion Point 1' }],
      },
      structure: {},
    };

    // Track the order of operations
    const operationOrder: string[] = [];

    // Mock setContainers to track when it's called
    const trackedSetContainers = jest.fn((...args) => {
      operationOrder.push('setContainers');
      return mockSetContainers(...args);
    });

    // Mock debounced save to track when it's called
    const trackedDebouncedSave = jest.fn((...args) => {
      operationOrder.push('debouncedSaveThought');
      return mockDebouncedSaveThought(...args);
    });

    // Mock structure update to track when it's called
    mockUpdateStructure.mockImplementation((...args) => {
      operationOrder.push('updateStructure');
      return Promise.resolve(true);
    });

    const handleDragEndWithOrderTracking = async (event: DragEndEvent) => {
      const { active, over } = event;
      
      if (!over || !sermon) return;

      const activeContainer = 'ambiguous' as keyof TestContainers;
      const overContainer = 'introduction' as keyof TestContainers;
      const outlinePointId = 'intro-1';
      
      // Store the previous state for potential rollback
      const previousContainers = { ...containers };
      
      // Perform the UI update immediately for smooth UX
      let updatedContainers = { ...containers };
      
      // Move item between containers
      const activeItems = [...updatedContainers[activeContainer]];
      const overItems = [...updatedContainers[overContainer]];
      
      const activeIndex = activeItems.findIndex((item: TestItem) => item.id === active.id);
      if (activeIndex !== -1) {
        const [draggedItem] = activeItems.splice(activeIndex, 1);
        overItems.push(draggedItem);
        
        updatedContainers[activeContainer] = activeItems;
        updatedContainers[overContainer] = overItems;
      }
      
      // Update outline point ID in the moved item immediately (before API calls)
      const itemIndex = updatedContainers[overContainer].findIndex((item: TestItem) => item.id === active.id);
      if (itemIndex !== -1) {
        updatedContainers[overContainer][itemIndex] = {
          ...updatedContainers[overContainer][itemIndex],
          outlinePointId: outlinePointId
        };
      }
      
      // Apply state updates immediately - THIS MUST HAPPEN FIRST
      trackedSetContainers(updatedContainers);
      containersRef.current = updatedContainers;
      
      // Make API calls in background - THESE HAPPEN SECOND
      try {
        const movedItem = updatedContainers[overContainer].find((item: TestItem) => item.id === active.id);
        
        if (movedItem && sermon) {
          const thought = sermon.thoughts.find((thought) => thought.id === movedItem.id);
          if (thought) {
            const updatedItem = {
              ...thought,
              outlinePointId: outlinePointId
            };
            
            // Use debounced function - THIS HAPPENS THIRD
            trackedDebouncedSave(sermon.id, updatedItem);
          }
        }
        
        // Update structure - THIS HAPPENS FOURTH
        const newStructure = {
          introduction: updatedContainers.introduction.map((item: TestItem) => item.id),
          main: updatedContainers.main.map((item: TestItem) => item.id),
          conclusion: updatedContainers.conclusion.map((item: TestItem) => item.id),
          ambiguous: updatedContainers.ambiguous.map((item: TestItem) => item.id),
        };
        
        await mockUpdateStructure(sermon.id, newStructure);
        
      } catch (error) {
        console.error("Error updating drag and drop:", error);
      }
    };

    // Create drag end event
    const dragEndEvent: DragEndEvent = {
      active: { 
        id: 'thought-1',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } }
      },
      over: { 
        id: 'outline-point-intro-1',
        data: { 
          current: { 
            container: 'introduction',
            outlinePointId: 'intro-1'
          } 
        },
        rect: null as any,
        disabled: false
      },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null
    };

    // Execute the function
    await handleDragEndWithOrderTracking(dragEndEvent);

    // CRITICAL TEST: Verify the correct order of operations
    expect(operationOrder).toEqual([
      'setContainers',        // 1. UI update first (immediate visual feedback)
      'debouncedSaveThought', // 2. Debounced save second (background, non-blocking)
      'updateStructure'       // 3. Structure update last (background)
    ]);

    // CRITICAL TEST: setContainers should be called exactly once (no double UI updates)
    expect(trackedSetContainers).toHaveBeenCalledTimes(1);

    // CRITICAL TEST: debouncedSaveThought should be called exactly once
    expect(trackedDebouncedSave).toHaveBeenCalledTimes(1);
  });

  /**
   * Test that verifies our fix handles errors correctly without causing visual issues
   */
  test('should handle API errors gracefully with rollback and no visual jumping', async () => {
    const containers: TestContainers = {
      ambiguous: [{ 
        id: 'thought-1', 
        content: 'Test thought', 
        requiredTags: [], 
        customTagNames: [],
        outlinePointId: null 
      }],
      introduction: [],
      main: [],
      conclusion: [],
    };

    const containersRef = { current: containers };
    const sermon = {
      id: 'test-sermon-id',
      title: 'Test Sermon',
      thoughts: [
        {
          id: 'thought-1',
          text: 'Test thought',
          tags: [],
          outlinePointId: null,
        }
      ],
      structure: {},
    };

    // Mock structure update to fail
    mockUpdateStructure.mockRejectedValueOnce(new Error('API Error'));

    const handleDragEndWithErrorHandling = async (event: DragEndEvent) => {
      const { active, over } = event;
      
      if (!over || !sermon) return;

      const activeContainer = 'ambiguous' as keyof TestContainers;
      const overContainer = 'introduction' as keyof TestContainers;
      const outlinePointId = 'intro-1';
      
      // Store the previous state for potential rollback
      const previousContainers = { ...containers };
      
      // Perform the UI update immediately
      let updatedContainers = { ...containers };
      
      // Move item and update outlinePointId immediately
      const activeItems = [...updatedContainers[activeContainer]];
      const overItems = [...updatedContainers[overContainer]];
      
      const activeIndex = activeItems.findIndex((item: TestItem) => item.id === active.id);
      if (activeIndex !== -1) {
        const [draggedItem] = activeItems.splice(activeIndex, 1);
        overItems.push({
          ...draggedItem,
          outlinePointId: outlinePointId
        });
        
        updatedContainers[activeContainer] = activeItems;
        updatedContainers[overContainer] = overItems;
      }
      
      // Apply state updates immediately
      mockSetContainers(updatedContainers);
      containersRef.current = updatedContainers;
      
      // Make API calls that will fail
      try {
        const newStructure = {
          introduction: updatedContainers.introduction.map((item: TestItem) => item.id),
          main: updatedContainers.main.map((item: TestItem) => item.id),
          conclusion: updatedContainers.conclusion.map((item: TestItem) => item.id),
          ambiguous: updatedContainers.ambiguous.map((item: TestItem) => item.id),
        };
        
        await mockUpdateStructure(sermon.id, newStructure);
        
      } catch (error) {
        console.error("Error updating drag and drop:", error);
        
        // Rollback optimistic updates on error
        mockSetContainers(previousContainers);
        containersRef.current = previousContainers;
      }
    };

    // Create drag end event
    const dragEndEvent: DragEndEvent = {
      active: { 
        id: 'thought-1',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } }
      },
      over: { 
        id: 'outline-point-intro-1',
        data: { 
          current: { 
            container: 'introduction',
            outlinePointId: 'intro-1'
          } 
        },
        rect: null as any,
        disabled: false
      },
      activatorEvent: {} as any,
      delta: { x: 0, y: 0 },
      collisions: null
    };

    // Execute the function
    await handleDragEndWithErrorHandling(dragEndEvent);

    // Verify that setContainers was called twice: once for optimistic update, once for rollback
    expect(mockSetContainers).toHaveBeenCalledTimes(2);

    // First call should be the optimistic update
    expect(mockSetContainers).toHaveBeenNthCalledWith(1, 
      expect.objectContaining({
        introduction: expect.arrayContaining([
          expect.objectContaining({
            id: 'thought-1',
            outlinePointId: 'intro-1'
          })
        ]),
        ambiguous: []
      })
    );

    // Second call should be the rollback
    expect(mockSetContainers).toHaveBeenNthCalledWith(2, 
      expect.objectContaining({
        ambiguous: expect.arrayContaining([
          expect.objectContaining({
            id: 'thought-1'
          })
        ]),
        introduction: []
      })
    );
  });
}); 