import { handleDragOver, handleDragEnd } from '../../app/utils/dnd-handlers';
import '@testing-library/jest-dom';

describe('Drag and Drop Integration Tests', () => {
  // Test data setup
  const mockItems = {
    item1: { id: 'item1', content: 'Item 1', requiredTags: [] },
    item2: { id: 'item2', content: 'Item 2', requiredTags: [] },
    item3: { id: 'item3', content: 'Item 3', requiredTags: [] },
    item4: { id: 'item4', content: 'Item 4', requiredTags: [] },
  };

  const initialContainers = {
    ambiguous: [mockItems.item1, mockItems.item2],
    introduction: [mockItems.item3],
    main: [mockItems.item4],
    conclusion: [],
  };

  const mockColumnTitles = {
    introduction: 'Introduction',
    main: 'Main Part',
    conclusion: 'Conclusion',
    ambiguous: 'Under Consideration',
  };

  // Reset containers before each test
  let containers: typeof initialContainers;
  let containersRef: { current: typeof containers };
  let setContainersMock: jest.Mock;

  beforeEach(() => {
    containers = JSON.parse(JSON.stringify(initialContainers)); // Deep clone
    containersRef = { current: containers };
    setContainersMock = jest.fn((updater: any) => {
      if (typeof updater === 'function') {
        const newContainers = updater(containers);
        containers = newContainers;
        containersRef.current = newContainers;
        return newContainers;
      } else {
        containers = updater;
        containersRef.current = updater;
        return updater;
      }
    });
  });

  test('Integration: drag from ambiguous to introduction', () => {
    // Create mock drag over event
    const dragOverEvent = {
      active: { 
        id: 'item1', 
        data: { current: { container: 'ambiguous' } } 
      },
      over: { 
        id: 'introduction', 
        data: { current: { container: 'introduction' } } 
      },
    } as any;

    // Call the handler
    handleDragOver(
      dragOverEvent, 
      containers, 
      setContainersMock, 
      mockColumnTitles, 
      containersRef
    );

    // Create mock drag end event
    const dragEndEvent = {
      active: { 
        id: 'item1'
      },
      over: { 
        id: 'introduction', 
        data: { current: { container: 'introduction' } } 
      },
    } as any;

    const originalContainer = 'ambiguous';

    // Call the drag end handler
    handleDragEnd(
      dragEndEvent,
      originalContainer,
      containers,
      setContainersMock,
      containersRef
    );

    // Assert the item was removed from ambiguous
    expect(containers.ambiguous.length).toBe(1); 
    expect(containers.ambiguous[0].id).toBe('item2');

    // Assert the item was added to introduction
    expect(containers.introduction.length).toBe(2);
    expect(containers.introduction[1].id).toBe('item1');
    
    // Assert required tags were updated
    expect(containers.introduction[1].requiredTags).toEqual(['Introduction']);
  });

  test('Integration: drag over specific item', () => {
    // Create mock drag over event - dragging over a specific item
    const dragOverEvent = {
      active: { 
        id: 'item1', 
        data: { current: { container: 'ambiguous' } } 
      },
      over: { 
        id: 'item3', 
        data: { current: { container: 'introduction', sortable: true } } 
      },
    } as any;

    // Call the handler
    handleDragOver(
      dragOverEvent, 
      containers, 
      setContainersMock, 
      mockColumnTitles, 
      containersRef
    );

    // Create mock drag end event
    const dragEndEvent = {
      active: { 
        id: 'item1'
      },
      over: { 
        id: 'item3', 
        data: { current: { container: 'introduction', sortable: true } } 
      },
    } as any;

    const originalContainer = 'ambiguous';

    // Call the drag end handler
    handleDragEnd(
      dragEndEvent,
      originalContainer,
      containers,
      setContainersMock,
      containersRef
    );

    // Assert the item was removed from ambiguous
    expect(containers.ambiguous.length).toBe(1);

    // Assert the item was added to introduction before target item
    expect(containers.introduction.length).toBe(2);
    // Check for actual order after drag operations
    expect(containers.introduction[0].id).toBe('item3');
    expect(containers.introduction[1].id).toBe('item1');
  });
}); 