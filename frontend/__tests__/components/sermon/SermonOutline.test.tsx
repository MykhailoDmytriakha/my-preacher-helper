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
  Droppable: ({ children, renderClone }: { children: any; renderClone?: any }) => children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: any }) => children({ innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false, isDropAnimating: false, draggingOver: null })
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  getSectionStyling: (section: string) => {
    if (section === 'introduction') {
      return {
        headerBg: "bg-amber-50 dark:bg-amber-900/40",
        headerHover: "hover:bg-amber-100 dark:hover:bg-amber-900/40",
        border: "border-amber-200 dark:border-amber-800",
        dragBg: "bg-amber-200 dark:bg-amber-700",
        badge: "bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-200"
      };
    } else if (section === 'mainPart') {
      return {
        headerBg: "bg-blue-50 dark:bg-blue-900/20",
        headerHover: "hover:bg-blue-100 dark:hover:bg-blue-900/40",
        border: "border-blue-50 dark:border-blue-300",
        dragBg: "bg-blue-200 dark:bg-blue-700",
        badge: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200"
      };
    } else {
      return {
        headerBg: "bg-green-50 dark:bg-green-900/30",
        headerHover: "hover:bg-green-100 dark:hover:bg-green-900/40",
        border: "border-green-200 dark:border-green-800",
        dragBg: "bg-green-200 dark:bg-green-700",
        badge: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200"
      };
    }
  }
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

  test('displays correct outline point counts in section headers', async () => {
    // Setup a more extensive outline mock
    mockGetSermonOutline.mockResolvedValueOnce({
      introduction: [
        { id: 'intro1', text: 'Introduction point 1' },
        { id: 'intro2', text: 'Introduction point 2' }
      ],
      main: [
        { id: 'main1', text: 'Main point 1' },
        { id: 'main2', text: 'Main point 2' },
        { id: 'main3', text: 'Main point 3' }
      ],
      conclusion: [
        { id: 'concl1', text: 'Conclusion point 1' }
      ]
    });

    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
    
    // Check for the point count badges in each section header
    const introSection = screen.getByTestId('outline-section-introduction');
    const mainSection = screen.getByTestId('outline-section-mainPart');
    const conclSection = screen.getByTestId('outline-section-conclusion');
    
    // Find count badges and verify their values
    // Look within each section's header for the counts
    expect(within(introSection).getByText('2')).toBeInTheDocument();
    expect(within(mainSection).getByText('3')).toBeInTheDocument();
    expect(within(conclSection).getByText('1')).toBeInTheDocument();
  });

  test('displays thought counts when thoughtsPerOutlinePoint prop is provided', async () => {
    // Create mock thought counts for specific outline points
    const mockThoughtsPerPoint = {
      'intro1': 3,
      'main1': 5,
      'concl1': 2
    };

    render(
      <SermonOutline 
        sermon={mockSermon} 
        onOutlineUpdate={mockOnOutlineUpdate}
        thoughtsPerOutlinePoint={mockThoughtsPerPoint}
      />
    );
    
    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
    
    // Check for total thought count badges in section headers
    const introSection = screen.getByTestId('outline-section-introduction');
    const mainSection = screen.getByTestId('outline-section-mainPart');
    const conclSection = screen.getByTestId('outline-section-conclusion');
    
    // Check individual thought counts for each point
    expect(within(introSection).getByText('3')).toBeInTheDocument();
    expect(within(mainSection).getByText('5')).toBeInTheDocument();
    expect(within(conclSection).getByText('2')).toBeInTheDocument();
    
    // Check the total entries in section headers
    expect(within(introSection).getByText('3 structure.entries')).toBeInTheDocument();
    expect(within(mainSection).getByText('5 structure.entries')).toBeInTheDocument();
    expect(within(conclSection).getByText('2 structure.entries')).toBeInTheDocument();
  });

  test('does not display thought count badges when thoughts count is zero', async () => {
    // Empty thoughts counts
    const mockThoughtsPerPoint = {
      'other-id': 5 // Not matching any of our point IDs
    };

    render(
      <SermonOutline 
        sermon={mockSermon} 
        onOutlineUpdate={mockOnOutlineUpdate}
        thoughtsPerOutlinePoint={mockThoughtsPerPoint}
      />
    );
    
    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
    
    // Check that total thought counts don't appear in section headers
    const introSection = screen.getByTestId('outline-section-introduction');
    expect(within(introSection).queryByText('structure.entries')).not.toBeInTheDocument();
    
    // Find a specific outline point and verify no thought count is shown
    // Note: We can't use queryByText('0') as that might find other elements with "0"
    // Instead check that there's no badge with thought count near the point text
    const introPoint = within(introSection).getByText('Introduction point 1');
    const pointContainer = introPoint.closest('li');
    expect(pointContainer).toBeInTheDocument();
    
    // Check if thought count badge is not present within the point container
    const thoughtBadges = within(pointContainer!).queryAllByText(/^\d+$/);
    expect(thoughtBadges.length).toBe(0);
  });

  test('calls onOutlineUpdate with correct data when adding a point', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait specifically for the section header and initial point to appear
    const introSectionElement = await screen.findByTestId('outline-section-introduction');
    await screen.findByText('Introduction point 1');

    // Debug: Log element to inspect what's available
    // console.log(introSectionElement.outerHTML);

    // Find the add button using the aria-label that matches the new structure
    const addButton = within(introSectionElement).getByLabelText('structure.addPointButton');
    
    // Click the button to show the input field
    await act(async () => { fireEvent.click(addButton); });

    // Now look for the input field with the new placeholder text
    const input = await screen.findByPlaceholderText('structure.addPointPlaceholder');
    
    // Enter text and press Enter
    await act(async () => {
      fireEvent.change(input, { target: { value: 'New intro point' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    // Verify the API was called correctly
    await waitFor(() => {
      const expectedOutline: Outline = {
          introduction: [{ id: 'intro1', text: 'Introduction point 1' }, expect.objectContaining({ text: 'New intro point' })],
          main: [{ id: 'main1', text: 'Main point 1' }],
          conclusion: [{ id: 'concl1', text: 'Conclusion point 1' }]
      };
      expect(mockUpdateSermonOutline).toHaveBeenCalledWith(mockSermon.id, expectedOutline);
      expect(mockOnOutlineUpdate).toHaveBeenCalledWith(expectedOutline);
    });
  }, 40000); // Increased timeout to 40 seconds

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

  test('toggles section expansion when header is clicked', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
    
    // The sections should be expanded by default because they have content
    let introSection = screen.getByTestId('outline-section-introduction');
    let introPoints = within(introSection).queryByText('Introduction point 1');
    expect(introPoints).toBeInTheDocument();
    
    // Click the section header to collapse it
    const introHeader = within(introSection).getByText('structure.introduction');
    fireEvent.click(introHeader);
    
    // The points should now be hidden
    introPoints = within(introSection).queryByText('Introduction point 1');
    expect(introPoints).not.toBeInTheDocument();
    
    // Click again to expand
    fireEvent.click(introHeader);
    
    // The points should be visible again
    introPoints = within(introSection).queryByText('Introduction point 1');
    expect(introPoints).toBeInTheDocument();
  });

  test('deletes an outline point when delete button is clicked and confirmed', async () => {
    // Mock confirm to return true (simulating user clicking "OK")
    const originalConfirm = window.confirm;
    window.confirm = jest.fn().mockReturnValue(true);
    
    try {
      render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
      
      // Wait for the initial render
      await waitFor(() => {
        expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
      });
      
      // Find the intro section and point
      const introSection = screen.getByTestId('outline-section-introduction');
      const pointElement = within(introSection).getByText('Introduction point 1');
      
      // Get the parent li element
      const listItem = pointElement.closest('li');
      expect(listItem).toBeInTheDocument();
      
      // Hover to reveal delete button (simulated by finding by role)
      const deleteButton = within(listItem!).getByLabelText('common.delete');
      
      // Click the delete button
      fireEvent.click(deleteButton);
      
      // Confirm should have been called with the correct message
      expect(window.confirm).toHaveBeenCalledWith('structure.deletePointConfirm');
      
      // Check if updateSermonOutline was called with the updated outline
      await waitFor(() => {
        const expectedOutline: Outline = {
          introduction: [],
          main: [{ id: 'main1', text: 'Main point 1' }],
          conclusion: [{ id: 'concl1', text: 'Conclusion point 1' }]
        };
        expect(mockUpdateSermonOutline).toHaveBeenCalledWith(mockSermon.id, expectedOutline);
        expect(mockOnOutlineUpdate).toHaveBeenCalledWith(expectedOutline);
      });
    } finally {
      // Restore original window.confirm
      window.confirm = originalConfirm;
    }
  }, 15000);

  test('edits an outline point when edit button is clicked', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait for the initial render
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });
    
    // Find the intro section and point
    const introSection = screen.getByTestId('outline-section-introduction');
    const pointElement = within(introSection).getByText('Introduction point 1');
    
    // Get the parent li element
    const listItem = pointElement.closest('li');
    expect(listItem).toBeInTheDocument();
    
    // Find the edit button
    const editButton = within(listItem!).getByLabelText('common.edit');
    
    // Click the edit button
    fireEvent.click(editButton);
    
    // The input field should now be visible with the current text
    const editInput = within(introSection).getByPlaceholderText('structure.editPointPlaceholder');
    expect(editInput).toHaveValue('Introduction point 1');
    
    // Change the text and press Enter
    await act(async () => {
      fireEvent.change(editInput, { target: { value: 'Edited introduction point' } });
      fireEvent.keyDown(editInput, { key: 'Enter', code: 'Enter' });
    });
    
    // Check if updateSermonOutline was called with the updated outline
    await waitFor(() => {
      const expectedOutline: Outline = {
        introduction: [{ id: 'intro1', text: 'Edited introduction point' }],
        main: [{ id: 'main1', text: 'Main point 1' }],
        conclusion: [{ id: 'concl1', text: 'Conclusion point 1' }]
      };
      expect(mockUpdateSermonOutline).toHaveBeenCalledWith(mockSermon.id, expectedOutline);
      expect(mockOnOutlineUpdate).toHaveBeenCalledWith(expectedOutline);
    });
  }, 15000);

  test('handles error when fetching outline fails', async () => {
    // Mock the service to throw an error
    mockGetSermonOutline.mockRejectedValueOnce(new Error('Failed to fetch'));
    
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);
    
    // Wait for the error message to appear
    await waitFor(() => {
      expect(screen.getByText('errors.fetchOutlineError')).toBeInTheDocument();
    });
  });

  test('renders focus-mode link in each section header with correct URL', async () => {
    render(<SermonOutline sermon={mockSermon} onOutlineUpdate={mockOnOutlineUpdate} />);

    // Wait for outline to render
    await waitFor(() => {
      expect(screen.getByText('Introduction point 1')).toBeInTheDocument();
    });

    const introSection = screen.getByTestId('outline-section-introduction');
    const mainSection = screen.getByTestId('outline-section-mainPart');
    const conclSection = screen.getByTestId('outline-section-conclusion');

    // Helper to assert link
    const expectFocusLink = (container: HTMLElement, expectedHref: string) => {
      const link = within(container).getByLabelText('structure.focusMode');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('title', 'structure.focusMode');
      expect(link).toHaveAttribute('href', expectedHref);
    };

    expectFocusLink(introSection, `/structure?mode=focus&section=introduction&sermonId=${mockSermon.id}`);
    // mainPart maps to section=main in URL
    expectFocusLink(mainSection, `/structure?mode=focus&section=main&sermonId=${mockSermon.id}`);
    expectFocusLink(conclSection, `/structure?mode=focus&section=conclusion&sermonId=${mockSermon.id}`);
  });
});
