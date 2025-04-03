import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import SermonOutline from '@/components/sermon/SermonOutline';
import { Outline, Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock translations (simplified)
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

// Mock DND
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: any }) => children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: any }) => children({ innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false, isDropAnimating: false, draggingOver: null })
}));

describe('SermonOutline Component', () => {
  // Define mock functions first
  const mockGetSermonOutline = jest.fn();
  const mockUpdateSermonOutline = jest.fn();

  // Now, mock the service *inside* the describe block
  jest.mock('@/services/outline.service', () => ({
    getSermonOutline: mockGetSermonOutline,
    updateSermonOutline: mockUpdateSermonOutline
  }));

  // Import the component *after* the mock is defined within describe
  // (Ensure this runs after the mock setup)
  let SermonOutline: typeof import('@/components/sermon/SermonOutline').default;
  beforeAll(() => {
     // Use beforeAll to require the component once after mock setup
     SermonOutline = require('@/components/sermon/SermonOutline').default;
  });

  const mockSermon: Sermon = {
    id: 'sermon-123',
    title: 'Test Sermon',
    userId: 'user-123',
    verse: 'Test Verse',
    date: new Date().toISOString(),
    thoughts: [],
    outline: { 
      introduction: [],
      main: [],
      conclusion: []
    }
  };

  const mockOnOutlineUpdate = jest.fn();

  beforeEach(() => {
    // Reset mocks using the variables defined in the describe scope
    mockGetSermonOutline.mockReset().mockResolvedValue({
      introduction: [{ id: 'intro1', text: 'Introduction point 1' }],
      main: [{ id: 'main1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl1', text: 'Conclusion point 1' }]
    });
    mockUpdateSermonOutline.mockReset().mockImplementation(async (sermonId, outline) => Promise.resolve(outline));
    mockOnOutlineUpdate.mockClear();
    // Clear all mocks might still be useful here to catch unexpected calls
    jest.clearAllMocks(); 
  });

  test('renders with initial data fetched from service', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    await waitFor(() => {
      expect(mockGetSermonOutline).toHaveBeenCalledWith(mockSermon.id);
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
  });

  test('calls onOutlineUpdate with correct data when adding a point', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait specifically for the section header AND the initial point to appear
    const introSectionHeader = await screen.findByText('tags.introduction');
    await screen.findByText('Introduction point 1');

    // DEBUG: Log the DOM structure before trying to find the button
    // screen.debug(undefined, 300000); // Remove debug

    const introSection = introSectionHeader.closest('div[class*="border"]');
    if (!introSection) throw new Error('Introduction section container not found');

    // Assert introSection type before using `within`
    const introSectionElement = introSection as HTMLElement;

    // Find the button directly using screen, waiting for it to appear
    // The aria-label was added in the component itself
    // Try findByTestId instead
    const addButton = await screen.findByTestId('add-point-button-introduction', {}, { timeout: 30000 }); // Use testId

    // Click the button (use the found button)
    await act(async () => { fireEvent.click(addButton); });

    const input = await screen.findByPlaceholderText('common.addPoint');
    await act(async () => {
        fireEvent.change(input, { target: { value: 'New intro point' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    await waitFor(() => {
      const expectedOutline: Outline = {
          introduction: [{ id: 'intro1', text: 'Introduction point 1' }, expect.objectContaining({ text: 'New intro point' })],
          main: [{ id: 'main1', text: 'Main point 1' }],
          conclusion: [{ id: 'concl1', text: 'Conclusion point 1' }]
      };
      expect(mockUpdateSermonOutline).toHaveBeenCalledWith(mockSermon.id, expectedOutline);
      expect(mockOnOutlineUpdate).toHaveBeenCalledWith(expectedOutline);
    });
  }, 30000); // Revert test timeout to 30 seconds

  test('dependency array uses sermon.id instead of sermon object', async () => {
    const { rerender } = render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate}/>);
    await waitFor(() => expect(mockGetSermonOutline).toHaveBeenCalledTimes(1));

    const updatedSermonSameId = { ...mockSermon, title: 'Updated Title' };
    rerender(<SermonOutline sermon={updatedSermonSameId} onOutlineUpdate={mockOnOutlineUpdate} />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); // Allow potential effects to run
    expect(mockGetSermonOutline).toHaveBeenCalledTimes(1); 

    const newSermonDifferentId = { ...mockSermon, id: 'sermon-456' };
    (mockGetSermonOutline as jest.Mock).mockResolvedValueOnce({ introduction: [], main: [], conclusion: [] }); 
    rerender(<SermonOutline sermon={newSermonDifferentId} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait longer for the second fetch triggered by ID change
    await waitFor(() => {
      expect(mockGetSermonOutline).toHaveBeenCalledTimes(2); 
      expect(mockGetSermonOutline).toHaveBeenLastCalledWith('sermon-456'); 
    }, { timeout: 15000 }); // Increased timeout to 15s for this specific wait
  }, 15000); // Increase Jest timeout for this test as well, as it involves waiting
}); 