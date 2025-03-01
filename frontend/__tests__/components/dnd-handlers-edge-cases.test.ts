import { DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import { handleDragOver, handleDragEnd } from '../../app/utils/dnd-handlers';
import '@testing-library/jest-dom';
import React from 'react';

describe('Drag and Drop Handlers Edge Cases', () => {
  // Mock data
  const mockItems = {
    introduction: [
      { id: 'intro-1', content: 'Introduction Item 1' },
      { id: 'intro-2', content: 'Introduction Item 2' },
    ],
    ambiguous: [
      { id: 'amb-1', content: 'Ambiguous Item 1' },
      { id: 'amb-2', content: 'Ambiguous Item 2' },
    ],
    summary: [
      { id: 'sum-1', content: 'Summary Item 1' },
    ],
    empty: [],
    main: [],
    conclusion: [],
  };

  // Column titles
  const columnTitles = {
    introduction: 'Introduction',
    main: 'Main',
    conclusion: 'Conclusion',
    ambiguous: 'Ambiguous',
    empty: 'Empty',
  };

  // Initial state setup
  let items: Record<string, any[]>;
  let mockSetItems: jest.Mock;
  let containersRef: React.MutableRefObject<Record<string, any[]>>;

  beforeEach(() => {
    // Deep clone the mock items to avoid state persistence between tests
    items = JSON.parse(JSON.stringify(mockItems));
    
    // Create mock function for setItems
    mockSetItems = jest.fn((updater) => {
      if (typeof updater === 'function') {
        const newItems = updater(items);
        items = newItems;
        containersRef.current = newItems;
        return newItems;
      } else {
        items = updater;
        containersRef.current = updater;
        return updater;
      }
    });
    
    // Create containers ref
    containersRef = {
      current: items
    };
  });

  test('handleDragOver does nothing when active container is invalid', () => {
    // Create a drag event with an invalid container (not in the allowed list)
    const event = {
      active: { 
        id: 'amb-1',
        data: { current: { container: 'summary' } } // summary is not in the allowed list
      },
      over: { 
        id: 'intro-1',
        data: { current: { container: 'introduction' } }
      },
    } as unknown as DragOverEvent;

    // Deep clone the current items for comparison
    const itemsBefore = JSON.parse(JSON.stringify(items));
    
    // Execute the handler
    handleDragOver(event, items, mockSetItems, columnTitles, containersRef);
    
    // The function will be called but no changes will be made
    expect(items).toEqual(itemsBefore);
  });

  test('handleDragOver does nothing when over is null', () => {
    // Create a drag event with null over property
    const event = {
      active: { 
        id: 'amb-1',
        data: { current: { container: 'ambiguous' } }
      },
      over: null,
    } as unknown as DragOverEvent;

    // Deep clone the current items for comparison
    const itemsBefore = JSON.parse(JSON.stringify(items));
    
    // Execute the handler
    handleDragOver(event, items, mockSetItems, columnTitles, containersRef);
    
    // Verify items are unchanged
    expect(items).toEqual(itemsBefore);
  });

  test('handleDragEnd does nothing when active item is not found', () => {
    // Create a drag end event with a non-existent item
    const event = {
      active: { 
        id: 'non-existent',
        data: { current: { container: 'ambiguous' } }
      },
      over: { 
        id: 'intro-1',
        data: { current: { container: 'introduction' } }
      },
    } as unknown as DragEndEvent;

    // Deep clone the current items for comparison
    const itemsBefore = JSON.parse(JSON.stringify(items));
    
    // Execute the handler
    handleDragEnd(event, 'ambiguous', items, mockSetItems, containersRef);
    
    // Verify items are unchanged
    expect(items).toEqual(itemsBefore);
  });

  test('handleDragEnd does nothing when over is null', () => {
    // Create a drag end event with null over property
    const event = {
      active: { 
        id: 'amb-1',
        data: { current: { container: 'ambiguous' } }
      },
      over: null,
    } as unknown as DragEndEvent;

    // Deep clone the current items for comparison
    const itemsBefore = JSON.parse(JSON.stringify(items));
    
    // Execute the handler
    handleDragEnd(event, 'ambiguous', items, mockSetItems, containersRef);
    
    // Verify items are unchanged
    expect(items).toEqual(itemsBefore);
  });

  test('handleDragOver handles dragging to dummy-drop-zone', () => {
    // Create a drag event dragging to the dummy drop zone
    const event = {
      active: { 
        id: 'intro-1',
        data: { current: { container: 'introduction' } }
      },
      over: { 
        id: 'dummy-drop-zone',
        data: { current: { container: null } }
      },
    } as unknown as DragOverEvent;
    
    // Execute the handler
    handleDragOver(event, items, mockSetItems, columnTitles, containersRef);
    
    // Check the updated items
    expect(items.ambiguous).toContainEqual(expect.objectContaining({ id: 'intro-1' }));
    expect(items.introduction).toHaveLength(1);
    expect(items.introduction[0].id).toBe('intro-2');
  });

  test('handleDragOver with same active and over IDs does nothing', () => {
    // Create a drag event where active and over are the same ID
    const event = {
      active: { 
        id: 'amb-1',
        data: { current: { container: 'ambiguous' } }
      },
      over: { 
        id: 'amb-1',
        data: { current: { container: 'ambiguous' } }
      },
    } as unknown as DragOverEvent;
    
    // Deep clone the current items for comparison
    const itemsBefore = JSON.parse(JSON.stringify(items));
    
    // Execute the handler
    handleDragOver(event, items, mockSetItems, columnTitles, containersRef);
    
    // Verify items are unchanged
    expect(items).toEqual(itemsBefore);
  });

  test('handleDragOver handles dragging between valid containers', () => {
    // Create a drag event with active and over items in different containers
    const event = {
      active: { 
        id: 'amb-1',
        data: { current: { container: 'ambiguous' } }
      },
      over: { 
        id: 'introduction',
        data: { current: { container: 'introduction' } }
      },
    } as unknown as DragOverEvent;
    
    // Execute the handler
    handleDragOver(event, items, mockSetItems, columnTitles, containersRef);
    
    // Check that the item was moved to the introduction container
    expect(items.introduction).toHaveLength(3);
    expect(items.introduction).toContainEqual(expect.objectContaining({ 
      id: 'amb-1',
      requiredTags: ['Introduction']
    }));
    
    // Check that the item was removed from the ambiguous container
    expect(items.ambiguous).toHaveLength(1);
    expect(items.ambiguous[0].id).toBe('amb-2');
  });
}); 